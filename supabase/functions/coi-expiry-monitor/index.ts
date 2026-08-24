// coi-expiry-monitor
//
// Daily (13:00 UTC): walks every commercial/office account and works the
// escalation ladder toward each certificate's expiry date.
//
//    90 days  informational — the renewal cycle has started somewhere
//    30 days  action needed — ask the client for the renewal now
//    15 days  escalated — this is going to be a problem
//     7 days  urgent — repeats DAILY until resolved
//   expired   the block is already live; repeats daily until it isn't
//
// Two rules make the ladder useful rather than noise:
//
//   • Each rung fires once per certificate period. Renewing re-arms the whole
//     ladder for the new expiry date, because that is genuinely a new cycle.
//   • Every alert names the account, the sites it affects, and the days
//     remaining. "Something needs attention" is not an alert, it is a chore.
//
// Alerts go out on the existing events -> discord_routes bus, and are copied
// by email to the account's owner when one is recorded. Nothing here changes
// COI status or the block: status is computed from the expiry date, and the
// block follows from it. This function only tells people.
//
// Idempotent: commercial_coi_alerts records what has already been sent, so a
// re-run on the same day is silent.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveSecret } from "../_shared/app-secrets.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
const log = (m: string, d?: unknown) =>
  console.log(`[coi-expiry-monitor] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

interface Settings {
  alert_days: number[];
  daily_reminder_from_days: number;
  notify_assigned_va: boolean;
}

const DEFAULTS: Settings = {
  alert_days: [90, 30, 15, 7],
  daily_reminder_from_days: 7,
  notify_assigned_va: true,
};

async function loadSettings(admin: SB): Promise<Settings> {
  const { data } = await admin.from("app_settings").select("value")
    .eq("key", "coi_lifecycle_settings").maybeSingle();
  const v = (data?.value || {}) as Partial<Settings>;
  const days = Array.isArray(v.alert_days) && v.alert_days.length
    ? v.alert_days.map(Number).filter((n) => Number.isFinite(n) && n > 0)
    : DEFAULTS.alert_days;
  return {
    // Descending, so the first rung a certificate qualifies for is the most
    // urgent one — a certificate 5 days out should not be told it has 90.
    alert_days: [...days].sort((a, b) => b - a),
    daily_reminder_from_days: Number(v.daily_reminder_from_days) > 0
      ? Number(v.daily_reminder_from_days)
      : DEFAULTS.daily_reminder_from_days,
    notify_assigned_va: v.notify_assigned_va !== false,
  };
}

/**
 * Which rung of the ladder this certificate is on today, if any.
 *
 * Returns the tightest threshold the remaining days have crossed, so an
 * account that was not looked at for a month lands on the rung it actually
 * deserves rather than the one it passed first.
 */
function milestoneFor(daysRemaining: number, settings: Settings): string | null {
  if (daysRemaining < 0) return "expired";
  const crossed = settings.alert_days.filter((t) => daysRemaining <= t);
  return crossed.length ? String(Math.min(...crossed)) : null;
}

/** Urgent rungs repeat every day; the early ones say their piece once. */
function repeatsDaily(milestone: string, settings: Settings): boolean {
  if (milestone === "expired") return true;
  const n = Number(milestone);
  return Number.isFinite(n) && n <= settings.daily_reminder_from_days;
}

async function emailOwner(
  admin: SB,
  to: string,
  subject: string,
  body: string,
): Promise<boolean> {
  try {
    const key = (await resolveSecret(admin, "RESEND_API_KEY")).trim();
    if (!key) return false;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Novara Cleaning <ops@novaracleaning.com>",
        to: [to],
        subject,
        html: body.split("\n").map((l) => `<p>${l}</p>`).join(""),
      }),
    });
    return res.ok;
  } catch (e) {
    log("owner email failed (non-blocking)", { error: String(e) });
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const settings = await loadSettings(admin);
    const today = new Date().toISOString().slice(0, 10);

    // The view computes status, days remaining, site counts and override
    // state in one read — the same numbers the admin console shows.
    const { data: rows, error } = await admin
      .from("commercial_coi_status_v1")
      .select("*")
      .neq("account_status", "offboarded")
      .order("priority_rank", { ascending: true })
      .limit(1000);
    if (error) throw error;

    let sent = 0, skipped = 0;
    const summary: Array<Record<string, unknown>> = [];

    for (const row of rows || []) {
      const status = String(row.coi_status);

      // Nothing to escalate toward when there is no certificate at all: that
      // account is already blocked and shows at the top of the console. An
      // alert every morning about a state nobody has changed in six months is
      // how people learn to ignore the channel.
      if (status === "not_on_file") { skipped++; continue; }

      const days = row.days_remaining == null ? null : Number(row.days_remaining);
      if (days == null) { skipped++; continue; }

      const milestone = milestoneFor(days, settings);
      if (!milestone) { skipped++; continue; }

      // Already said today (daily rungs), or already said at all (one-shot
      // rungs) for this certificate period.
      const alertQuery = admin.from("commercial_coi_alerts")
        .select("id", { count: "exact", head: true })
        .eq("business_account_id", row.account_id)
        .eq("milestone", milestone);
      const { count } = repeatsDaily(milestone, settings)
        ? await alertQuery.eq("expiration_date", row.coi_expires_at).eq("sent_on", today)
        : await alertQuery.eq("expiration_date", row.coi_expires_at);
      if ((count ?? 0) > 0) { skipped++; continue; }

      // Name the sites. "Which of my locations does this stop" is the first
      // question anyone reading the alert will have.
      const { data: sites } = await admin.from("business_sites")
        .select("nickname").eq("business_account_id", row.account_id).eq("active", true).limit(12);
      const siteNames = (sites || []).map((s: { nickname: string }) => s.nickname);
      const siteLabel = siteNames.length
        ? `${siteNames.length} site${siteNames.length === 1 ? "" : "s"} — ${siteNames.join(", ")}`
        : "no active sites";

      const expiresOn = String(row.coi_expires_at).slice(0, 10);
      const overridden = row.active_override != null;

      const headline = milestone === "expired"
        ? `COI EXPIRED — ${row.business_name}: certificate lapsed ${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago (${expiresOn}).`
        : `COI expires in ${days} day${days === 1 ? "" : "s"} — ${row.business_name} (${expiresOn}).`;
      const consequence = milestone === "expired"
        ? overridden
          ? " Bookings and dispatch are running on a temporary admin override, not on cover."
          : " Bookings, recurring generation, and dispatch are BLOCKED for every site under this account."
        : Number(milestone) <= 15
        ? " Renew now — at expiry, every site under this account stops booking and dispatching."
        : Number(milestone) <= 30
        ? " Request the renewal from the client's contact now."
        : " Informational — the renewal window has opened.";

      const detail = `${headline} Affects ${siteLabel}.${consequence}`;

      await admin.from("events").insert({
        event_type: milestone === "expired" ? "coi.expired" : "coi.expiring",
        source: "coi-expiry-monitor",
        summary: detail,
        data: {
          account_id: row.account_id,
          business_name: row.business_name,
          milestone,
          days_remaining: days,
          expiration_date: row.coi_expires_at,
          coi_status: status,
          blocked: row.blocked === true,
          overridden,
          sites: siteNames,
          contact_email: row.email,
        },
      });

      let channel = "events";
      if (settings.notify_assigned_va && row.assigned_va_email) {
        const ok = await emailOwner(
          admin,
          String(row.assigned_va_email),
          milestone === "expired"
            ? `COI expired — ${row.business_name} is blocked`
            : `COI renewal needed — ${row.business_name} (${days} days)`,
          `${detail}\n\nUpload the renewed certificate in the admin console under Partnerships → Compliance. A valid expiry date lifts the block immediately.`,
        );
        if (ok) channel = "events+email";
      }

      await admin.from("commercial_coi_alerts").insert({
        business_account_id: row.account_id,
        milestone,
        expiration_date: row.coi_expires_at,
        days_remaining: days,
        sent_on: today,
        channel,
        detail,
      });

      sent++;
      summary.push({ account: row.business_name, milestone, days });
    }

    // Documents that could not be read are a different kind of stuck: nobody
    // is chasing the client, they are waiting on us.
    const { data: review } = await admin
      .from("commercial_coi_status_v1")
      .select("account_id, business_name, documents_in_review")
      .gt("documents_in_review", 0)
      .limit(50);
    for (const row of review || []) {
      const { count } = await admin.from("commercial_coi_alerts")
        .select("id", { count: "exact", head: true })
        .eq("business_account_id", row.account_id)
        .eq("milestone", "needs_review")
        .eq("sent_on", today);
      if ((count ?? 0) > 0) continue;
      await admin.from("events").insert({
        event_type: "coi.needs_review",
        source: "coi-expiry-monitor",
        summary: `${row.business_name} — ${row.documents_in_review} uploaded certificate(s) have no readable expiry date and are not counting as cover.`,
        data: { account_id: row.account_id, documents_in_review: row.documents_in_review },
      });
      await admin.from("commercial_coi_alerts").insert({
        business_account_id: row.account_id,
        milestone: "needs_review",
        sent_on: today,
        channel: "events",
        detail: `${row.documents_in_review} certificate(s) awaiting manual review.`,
      });
      sent++;
    }

    log("done", { scanned: (rows || []).length, sent, skipped });
    return json({ ok: true, scanned: (rows || []).length, sent, skipped, alerts: summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
