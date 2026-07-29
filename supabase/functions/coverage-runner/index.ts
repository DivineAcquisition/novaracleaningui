// ─── coverage-runner ─────────────────────────────────────────────────────────
//
// The hands for the coverage brain that lives in Postgres.
//
// Postgres owns the decisions — it holds the clock, the thresholds, the ranking
// and the state machine (run_coverage_cycle / sweep_schedule_risk). It cannot
// reach Twilio, so it QUEUES what needs saying into coverage_notifications and
// this function delivers it through the SMS/push/Discord paths that already
// exist. Queue-then-deliver means a transient carrier failure is a retry rather
// than a nudge that silently never happened.
//
// Every minute on pg_cron, because a 10-minute accept window measured by a
// five-minute job loses a fifth of itself.
//
// Cycle:
//   1. run_coverage_cycle()  — expire stale offers, roll to the next
//                              candidate, mark a dry search uncovered.
//   2. drain the queue       — cleaner nudges and offers by SMS + push, VA and
//                              admin alerts to Discord.
//   3. substitute the links  — {{ACCEPT_URL}} / {{DECLINE_URL}} / {{ETA_URL}}
//                              become real tokenized one-tap links.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms } from "../_shared/sms.ts";
import { notifyDiscord } from "../_shared/discord.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const MAX_ATTEMPTS = 3;
const BATCH = 60;

const log = (s: string, d?: unknown) =>
  console.log(`[coverage-runner] ${s}${d ? ` ${JSON.stringify(d)}` : ""}`);

interface QueuedNotification {
  id: string;
  booking_id: string | null;
  coverage_request_id: string | null;
  coverage_offer_id: string | null;
  delay_event_id: string | null;
  cleaner_id: string | null;
  audience: "cleaner" | "va" | "admin";
  kind: string;
  channels: string[];
  to_phone: string | null;
  title: string | null;
  body: string;
  attempts: number;
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/**
 * Turn the placeholders Postgres left in the body into real one-tap links.
 * The tokens are the credential, so they are only ever resolved here — the
 * message text in the queue never carries a URL somebody could guess from.
 */
async function resolveLinks(
  // deno-lint-ignore no-explicit-any
  admin: any,
  n: QueuedNotification,
  base: string,
): Promise<string> {
  let body = n.body;

  if (body.includes("{{ACCEPT_URL}}") || body.includes("{{DECLINE_URL}}")) {
    let token = "";
    if (n.coverage_offer_id) {
      const { data } = await admin
        .from("coverage_offers")
        .select("response_token")
        .eq("id", n.coverage_offer_id)
        .maybeSingle();
      token = String(data?.response_token || "");
    }
    const link = (a: string) => `${base}/functions/v1/coverage-respond?t=${token}&a=${a}`;
    body = token
      ? body.replaceAll("{{ACCEPT_URL}}", link("accept")).replaceAll("{{DECLINE_URL}}", link("decline"))
      // No token means no safe link. Point them at the portal rather than
      // sending a broken URL — a dead link reads as a scam and gets ignored.
      : body
        .replaceAll("{{ACCEPT_URL}}", "https://contractor.novaracleaning.com/cleaner/mobile-dashboard")
        .replaceAll("{{DECLINE_URL}}", "https://contractor.novaracleaning.com/cleaner/mobile-dashboard");
  }

  if (body.includes("{{ETA_URL}}")) {
    let token = "";
    if (n.delay_event_id) {
      const { data } = await admin
        .from("schedule_delay_events")
        .select("response_token")
        .eq("id", n.delay_event_id)
        .maybeSingle();
      token = String(data?.response_token || "");
    }
    body = body.replaceAll(
      "{{ETA_URL}}",
      token
        ? `${base}/functions/v1/coverage-respond?e=${token}`
        : "https://contractor.novaracleaning.com/cleaner/mobile-dashboard",
    );
  }

  return body;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const auth = req.headers.get("Authorization") || "";
  if (serviceKey && auth !== `Bearer ${serviceKey}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);
  const base = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const skipCycle = body?.skipCycle === true;

    // ── 1. Turn the cycle ──────────────────────────────────────────────────
    let cycle: unknown = null;
    if (!skipCycle) {
      const { data, error } = await admin.rpc("run_coverage_cycle");
      if (error) {
        // A cycle failure must not stop the queue from draining: the nudge
        // already sitting in it is more time-critical than the next roll.
        log("run_coverage_cycle failed", error.message);
      } else {
        cycle = data;
      }
    }

    // ── 2. Drain the queue ─────────────────────────────────────────────────
    const { data: queued, error: qErr } = await admin
      .from("coverage_notifications")
      .select(
        "id, booking_id, coverage_request_id, coverage_offer_id, delay_event_id, cleaner_id, " +
          "audience, kind, channels, to_phone, title, body, attempts",
      )
      .eq("status", "pending")
      .lt("attempts", MAX_ATTEMPTS)
      .order("created_at", { ascending: true })
      .limit(BATCH);
    if (qErr) throw qErr;

    const notifications = (queued || []) as QueuedNotification[];
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const n of notifications) {
      const channels = Array.isArray(n.channels) ? n.channels : ["sms"];
      const via: string[] = [];
      const errors: string[] = [];
      const text = await resolveLinks(admin, n, base);

      // Internal audiences go to Discord, the same place every other
      // dispatch decision surfaces.
      if (n.audience !== "cleaner") {
        try {
          const ok = await notifyDiscord(admin, {
            title:
              n.kind === "uncovered_alert"
                ? "🆘 UNCOVERED JOB — nobody can cover this"
                : n.kind === "cancellation_alert"
                ? "🔁 Cleaner cancelled — coverage sourcing"
                : "🕒 Cleaner late and unreachable",
            description: text,
            color: n.kind === "uncovered_alert" ? 15158332 : 15844367,
          });
          if (ok) via.push("discord");
          else errors.push("discord webhook not configured");
        } catch (e) {
          errors.push(`discord: ${e instanceof Error ? e.message : String(e)}`);
        }
      } else {
        if (channels.includes("sms") && n.to_phone) {
          try {
            const ok = await sendSms(admin, {
              toPhone: n.to_phone,
              message: text.slice(0, 480),
              type: n.kind === "coverage_offer" ? "job_offer" : "reminder",
            });
            if (ok) via.push("sms");
            else errors.push("sms send failed");
          } catch (e) {
            errors.push(`sms: ${e instanceof Error ? e.message : String(e)}`);
          }
        }

        // Push is a bonus channel, never the only one we rely on: a cleaner
        // without the app installed still has to get the nudge.
        if (channels.includes("push") && n.cleaner_id) {
          try {
            const { error } = await admin.functions.invoke("send-push", {
              body: {
                cleanerId: n.cleaner_id,
                title: n.title || "Novara",
                body: text.slice(0, 220),
                data: {
                  kind: n.kind,
                  bookingId: n.booking_id,
                  coverageOfferId: n.coverage_offer_id,
                },
              },
            });
            if (!error) via.push("push");
          } catch {
            /* push is best-effort */
          }
        }
      }

      if (via.length > 0) {
        sent += 1;
        await admin
          .from("coverage_notifications")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            sent_via: via,
            attempts: n.attempts + 1,
            error: errors.length ? errors.join("; ").slice(0, 500) : null,
          })
          .eq("id", n.id);

        if (n.coverage_offer_id && n.kind === "coverage_offer") {
          await admin
            .from("coverage_offers")
            .update({ notified_via: via })
            .eq("id", n.coverage_offer_id);
        }
        continue;
      }

      // Nothing reached them. Retry until MAX_ATTEMPTS, then stop pretending.
      const attempts = n.attempts + 1;
      const dead = attempts >= MAX_ATTEMPTS;
      if (dead) failed += 1;
      else skipped += 1;

      await admin
        .from("coverage_notifications")
        .update({
          status: dead ? "failed" : "pending",
          attempts,
          error: (errors.join("; ") || "no reachable channel").slice(0, 500),
        })
        .eq("id", n.id);

      // A coverage offer nobody could be told about is not an offer. Withdraw
      // it so the cycle rolls on instead of waiting out a window the cleaner
      // never knew existed.
      if (dead && n.coverage_offer_id && n.kind === "coverage_offer") {
        await admin
          .from("coverage_offers")
          .update({
            status: "failed",
            responded_at: new Date().toISOString(),
            notify_error: (errors.join("; ") || "unreachable").slice(0, 500),
          })
          .eq("id", n.coverage_offer_id)
          .eq("status", "offered");
        log("offer withdrawn — cleaner unreachable", { offerId: n.coverage_offer_id });
      }
    }

    const result = { ok: true, cycle, queue: { total: notifications.length, sent, failed, retrying: skipped } };
    if (notifications.length > 0 || sent > 0) log("done", result);
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", msg);
    return json({ error: msg }, 500);
  }
});
