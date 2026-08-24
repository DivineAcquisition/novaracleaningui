// walkthrough-pipeline-sweep
//
// Hourly. Three jobs, all of them about a pipeline not moving on its own:
//
//   1. REMINDERS — a scheduled walkthrough reminds both the person conducting
//      it and the client contact providing access, ahead of the visit. A
//      walkthrough nobody can get into is a wasted trip and a delayed deal.
//   2. STALLS — findings captured but no firm price after the configured
//      number of business days. This is the failure mode the pipeline exists
//      to catch: the visit happened, everyone assumes it is handled, and a
//      large prospective deal sits still.
//   3. RE-WALKTHROUGH SIGNALS — sites whose real service time or crew size has
//      drifted from what their walkthrough assumed, read from the existing
//      duration-variance loop. Absorbing that gap forever is a decision nobody
//      made; this makes it one someone has to take.
//
// Everything is announced through the existing events → Discord bus, and each
// signal is raised once rather than every hour.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms } from "../_shared/sms.ts";

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
  console.log(`[walkthrough-pipeline-sweep] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

async function setting(admin: SB, key: string, fallback: number): Promise<number> {
  const { data } = await admin.from("app_settings").select("value")
    .eq("key", "walkthrough_pipeline_settings").maybeSingle();
  const n = Number((data?.value || {})[key]);
  return Number.isFinite(n) ? n : fallback;
}

function whenLabel(iso: string): string {
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    weekday: "short", month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const leadHours = await setting(admin, "reminder_hours_before", 24);
    const now = Date.now();
    let reminded = 0, stalled = 0, rewalks = 0;

    // ── 1. Reminders ─────────────────────────────────────────────────────
    const windowEnd = new Date(now + leadHours * 3600_000).toISOString();
    const { data: upcoming } = await admin
      .from("commercial_walkthroughs")
      .select("id, business_site_id, scheduled_at, conducted_by, conductor_phone, conductor_email, " +
              "access_contact_name, access_contact_phone, site_address, client_access_confirmed")
      .eq("status", "scheduled")
      .is("reminder_sent_at", null)
      .not("scheduled_at", "is", null)
      .lte("scheduled_at", windowEnd)
      .gte("scheduled_at", new Date(now).toISOString())
      .limit(100);

    for (const wt of upcoming || []) {
      const { data: site } = await admin.from("business_sites")
        .select("nickname, business_account_id").eq("id", wt.business_site_id).maybeSingle();
      const { data: account } = site?.business_account_id
        ? await admin.from("business_accounts").select("business_name")
          .eq("id", site.business_account_id).maybeSingle()
        : { data: null };

      const label = `${account?.business_name || "Commercial account"} — ${site?.nickname || "site"}`;
      const when = whenLabel(String(wt.scheduled_at));

      // The person walking the building.
      if (wt.conductor_phone) {
        await sendSms(admin, {
          toPhone: String(wt.conductor_phone),
          message:
            `Novara: walkthrough reminder — ${label}, ${when}. ${wt.site_address || ""}. ` +
            `Access contact: ${wt.access_contact_name || "not named"}` +
            `${wt.access_contact_phone ? ` ${wt.access_contact_phone}` : ""}. ` +
            `Bring the findings form — confirmed sqft, condition, counts, window, equipment, and photos are all required.`,
          type: "walkthrough_reminder",
        }).catch(() => false);
      }

      // The client contact who has to let them in.
      if (wt.access_contact_phone) {
        await sendSms(admin, {
          toPhone: String(wt.access_contact_phone),
          message:
            `Novara Cleaning: reminder that our walkthrough at ${site?.nickname || "your site"} is ${when}. ` +
            `${wt.conducted_by || "Our team"} will need access to the areas in scope. Reply here if the time no longer works.`,
          type: "walkthrough_reminder",
        }).catch(() => false);
      }

      await admin.from("commercial_walkthroughs")
        .update({ reminder_sent_at: new Date().toISOString() }).eq("id", wt.id);

      await admin.from("events").insert({
        event_type: "walkthrough.reminder",
        source: "walkthrough-pipeline-sweep",
        summary: `Walkthrough reminder sent — ${label}, ${when}, ${wt.conducted_by || "conductor not named"} conducting.` +
          (wt.client_access_confirmed ? "" : " Client access is NOT yet confirmed for this visit."),
        data: { walkthrough_id: wt.id, site_id: wt.business_site_id, scheduled_at: wt.scheduled_at },
      }).then(() => undefined, () => undefined);
      reminded++;
    }

    // ── 2. Stalled: findings captured, no price ──────────────────────────
    // The view computes business days pending, so weekends do not read as a
    // deal going cold.
    const { data: stalls } = await admin
      .from("walkthrough_pipeline_v1")
      .select("id, business_name, site_nickname, confirmed_sqft, formula_price_cents, business_days_pending_price, conducted_by, conducted_on")
      .eq("stalled", true)
      .limit(100);

    for (const row of stalls || []) {
      // Raise it once per walkthrough, not once per hour.
      const { count } = await admin.from("events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "walkthrough.stalled")
        .contains("data", { walkthrough_id: row.id });
      if ((count ?? 0) > 0) continue;

      const anchor = row.formula_price_cents
        ? ` The formula anchor is $${(Number(row.formula_price_cents) / 100).toFixed(2)} — pricing it is a decision, not a calculation.`
        : "";
      await admin.from("events").insert({
        event_type: "walkthrough.stalled",
        source: "walkthrough-pipeline-sweep",
        summary:
          `${row.business_name} — ${row.site_nickname}: walkthrough conducted ${row.conducted_on} by ${row.conducted_by || "unknown"}, ` +
          `${row.business_days_pending_price} business days ago, and still has no firm price. ` +
          `${Number(row.confirmed_sqft || 0).toLocaleString()} sq ft of prospective work is sitting still.${anchor}`,
        data: {
          walkthrough_id: row.id,
          site_nickname: row.site_nickname,
          business_days_pending_price: row.business_days_pending_price,
        },
      });
      stalled++;
    }

    // ── 3. Re-walkthrough signals ────────────────────────────────────────
    const { data: drifting } = await admin
      .from("commercial_site_variance_v1")
      .select("site_id, business_name, site_nickname, samples, avg_projected_hours, avg_actual_hours, avg_variance_pct, avg_crew_recommended, avg_crew_used, walkthrough_id")
      .eq("rewalkthrough_suggested", true)
      .limit(100);

    for (const row of drifting || []) {
      // Once per site per walkthrough: re-raising it every hour for a site
      // nobody has re-walked yet teaches people to ignore the channel.
      const { count } = await admin.from("events")
        .select("id", { count: "exact", head: true })
        .eq("event_type", "walkthrough.rewalk_suggested")
        .contains("data", { site_id: row.site_id, walkthrough_id: row.walkthrough_id });
      if ((count ?? 0) > 0) continue;

      // If someone has already opened a fresh pipeline here, the signal has
      // been acted on.
      const { count: openCount } = await admin.from("commercial_walkthroughs")
        .select("id", { count: "exact", head: true })
        .eq("business_site_id", row.site_id)
        .in("status", ["requested", "scheduled", "conducted"]);
      if ((openCount ?? 0) > 0) continue;

      const crewDrift = Number(row.avg_crew_used) > Number(row.avg_crew_recommended) + 0.5
        ? ` Crews are averaging ${row.avg_crew_used} against the ${row.avg_crew_recommended} the walkthrough recommended.`
        : "";
      await admin.from("events").insert({
        event_type: "walkthrough.rewalk_suggested",
        source: "walkthrough-pipeline-sweep",
        summary:
          `${row.business_name} — ${row.site_nickname}: over ${row.samples} visits the site is averaging ` +
          `${row.avg_actual_hours}h against ${row.avg_projected_hours}h projected (${row.avg_variance_pct}%).${crewDrift} ` +
          `The walkthrough's assumptions no longer match how this site actually services — re-walk it rather than absorbing the gap.`,
        data: {
          site_id: row.site_id,
          walkthrough_id: row.walkthrough_id,
          samples: row.samples,
          avg_variance_pct: row.avg_variance_pct,
          avg_crew_used: row.avg_crew_used,
          avg_crew_recommended: row.avg_crew_recommended,
        },
      });
      rewalks++;
    }

    log("done", { reminded, stalled, rewalks });
    return json({ ok: true, reminded, stalled, rewalkSuggested: rewalks });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
