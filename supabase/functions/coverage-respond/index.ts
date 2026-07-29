// ─── coverage-respond ────────────────────────────────────────────────────────
//
// The one-tap surface behind every text the schedule guard sends a cleaner.
// Tokenized, so answering costs a tap and no login — which is the entire point:
// a nudge that requires signing in gets ignored, and an ignored nudge is how a
// bad morning becomes a lost customer.
//
// Three things a cleaner can do here:
//
//   ?t=<offer token>&a=accept    take a coverage job. First accept wins; the
//                                other candidates are auto-withdrawn. The
//                                assignment runs through the canonical assign
//                                path so their portal receives the COMPLETE
//                                job — address and unit, access method, scope
//                                checklist, special instructions, deadline and
//                                their locked pay.
//   ?t=<offer token>&a=decline   pass. Recorded, rolled on to the next
//                                candidate, and explicitly NOT a reliability
//                                penalty.
//   ?e=<delay event token>       "I'm running late, here's my ETA." This is
//                                what turns an unreachable no-show into a
//                                communicated delay, so it is deliberately the
//                                lowest-friction thing on the page.
//
// Public by design (no JWT): the unguessable token IS the credential, exactly
// like the existing job-offer and checklist links.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PORTAL = "https://contractor.novaracleaning.com/cleaner/mobile-dashboard";

const log = (s: string, d?: unknown) =>
  console.log(`[coverage-respond] ${s}${d ? ` ${JSON.stringify(d)}` : ""}`);

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function page(title: string, bodyHtml: string, status = 200): Response {
  return new Response(
    `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
         margin: 0; padding: 24px 18px 48px; background: #f8fafc; color: #0f172a; }
  .wrap { max-width: 520px; margin: 0 auto; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; }
  h1 { font-size: 21px; margin: 0 0 10px; letter-spacing: -0.01em; }
  p { margin: 0 0 12px; line-height: 1.55; font-size: 15px; color: #334155; }
  .muted { color: #64748b; font-size: 13px; }
  .job { background: #f1f5f9; border-radius: 10px; padding: 14px; margin: 14px 0; font-size: 14px; }
  .job div { margin: 3px 0; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }
  a.btn, button.btn { display: block; flex: 1 1 140px; text-align: center; padding: 15px 16px;
    border-radius: 10px; font-size: 16px; font-weight: 600; text-decoration: none;
    border: 1px solid transparent; cursor: pointer; }
  .primary { background: #5C0FFE; color: #fff; }
  .ghost { background: #fff; color: #334155; border-color: #cbd5e1; }
  .ok { color: #047857; }
  .bad { color: #b91c1c; }
  .note { margin-top: 18px; font-size: 13px; color: #64748b; }
</style>
</head>
<body><div class="wrap"><div class="card">${bodyHtml}</div>
<p class="note">Novara Cleaning · <a href="${PORTAL}">open your portal</a></p></div></body>
</html>`,
    { status, headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" } },
  );
}

function timeLabel(iso: string | null | undefined, tz: string): string {
  if (!iso) return "TBD";
  try {
    return new Date(iso).toLocaleString("en-US", {
      timeZone: tz,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return String(iso);
  }
}

// deno-lint-ignore no-explicit-any
async function operatingTimezone(admin: any): Promise<string> {
  try {
    const { data } = await admin
      .from("app_settings")
      .select("value")
      .eq("key", "schedule_guard_settings")
      .maybeSingle();
    return String(data?.value?.timezone || "America/New_York");
  } catch {
    return "America/New_York";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const url = new URL(req.url);
    const offerToken = (url.searchParams.get("t") || "").trim();
    const etaToken = (url.searchParams.get("e") || "").trim();
    const tz = await operatingTimezone(admin);

    // ── The ETA reply: late with communication, not a no-show ──────────────
    if (etaToken) {
      const { data: event } = await admin
        .from("schedule_delay_events")
        .select("id, booking_id, cleaner_id, scheduled_start_at, cleaner_eta_at, resolved_at")
        .eq("response_token", etaToken)
        .maybeSingle();

      if (!event) return page("Link expired", `<h1>That link isn't valid</h1>
        <p>It may have already been used. Open your portal and update the job status there.</p>
        <div class="row"><a class="btn primary" href="${PORTAL}">Open portal</a></div>`, 404);

      const { data: booking } = await admin
        .from("bookings")
        .select("booking_number, first_name, address, city, service_date, time_slot")
        .eq("id", event.booking_id)
        .maybeSingle();
      const ref = booking?.booking_number
        ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
        : "your job";

      const minutes = Number(url.searchParams.get("in") || 0);
      const cannot = url.searchParams.get("cannot") === "1";

      // "I can't make it at all" is the honest answer we most want to make
      // easy: told-in-advance beats discovered-by-the-customer every time.
      if (cannot) {
        const { data: res } = await admin.rpc("record_cleaner_cancellation", {
          p_booking_id: event.booking_id,
          p_cleaner_id: event.cleaner_id,
          p_reason: "Reported through the cleaner's status link",
          p_via: "link",
          p_actor: null,
          p_actor_name: "Cleaner (status link)",
        });
        log("cleaner cannot make it", { bookingId: event.booking_id, res });
        return page("Thanks for telling us", `<h1 class="ok">Got it — thank you for telling us</h1>
          <p>We've taken ${esc(ref)} off your day and we're finding cover now. Telling us
          beats us finding out from the customer, and it's recorded that way.</p>
          <p class="muted">Nothing else is needed from you for this job.</p>
          <div class="row"><a class="btn primary" href="${PORTAL}">Open portal</a></div>`);
      }

      if (minutes > 0 && minutes <= 600) {
        const eta = new Date(Date.now() + minutes * 60_000).toISOString();
        const { data: res, error } = await admin.rpc("record_cleaner_eta", {
          p_booking_id: event.booking_id,
          p_eta: eta,
          p_note: `Cleaner reported ${minutes} minutes out via their status link`,
          p_via: "link",
          p_actor: null,
          p_actor_name: "Cleaner (status link)",
        });
        if (error) throw error;
        log("eta recorded", { bookingId: event.booking_id, minutes, res });

        return page("ETA sent", `<h1 class="ok">Thanks — we've told the customer</h1>
          <p>You're down as arriving around <strong>${esc(timeLabel(eta, tz))}</strong> for
          ${esc(ref)}. We've let ${esc(booking?.first_name || "the customer")} know so nobody is
          waiting in the dark.</p>
          <p class="muted">This job is logged as running late, not a no-show. Drive safe.</p>
          <div class="row"><a class="btn primary" href="${PORTAL}">Open portal</a></div>`);
      }

      const link = (qs: string) => `${url.origin}${url.pathname}?e=${encodeURIComponent(etaToken)}&${qs}`;
      return page("Are you on the way?", `<h1>Are you on the way?</h1>
        <p>Your window for ${esc(ref)} has opened and we haven't seen an update yet.
        Tap how far out you are — we'll tell the customer for you.</p>
        <div class="job">
          <div><strong>${esc(booking?.first_name || "Client")}</strong></div>
          <div>${esc(booking?.address || "")}${booking?.city ? `, ${esc(booking.city)}` : ""}</div>
          <div class="muted">${esc(booking?.service_date || "")} ${esc(booking?.time_slot || "")}</div>
        </div>
        <div class="row">
          <a class="btn primary" href="${link("in=10")}">10 min out</a>
          <a class="btn primary" href="${link("in=20")}">20 min out</a>
        </div>
        <div class="row">
          <a class="btn primary" href="${link("in=30")}">30 min out</a>
          <a class="btn primary" href="${link("in=45")}">45 min out</a>
        </div>
        <div class="row">
          <a class="btn ghost" href="${link("cannot=1")}">I can't make this job</a>
        </div>
        <p class="note">Telling us you're late is a service hiccup we can handle. Not answering
        at all is what costs the customer — so any answer here is the right one.</p>`);
    }

    // ── The coverage offer ─────────────────────────────────────────────────
    if (!offerToken) {
      return page("Nothing to do here", `<h1>That link isn't valid</h1>
        <p>Open your portal to see your jobs and any coverage offers.</p>
        <div class="row"><a class="btn primary" href="${PORTAL}">Open portal</a></div>`, 400);
    }

    const action = (url.searchParams.get("a") || "").toLowerCase();

    const { data: offer } = await admin
      .from("coverage_offers")
      .select("id, coverage_request_id, booking_id, cleaner_id, cleaner_name, status, expires_at, rank_reason")
      .eq("response_token", offerToken)
      .maybeSingle();

    if (!offer) {
      return page("Link expired", `<h1>That link isn't valid</h1>
        <p>It may have already been used or the job has been covered.</p>
        <div class="row"><a class="btn primary" href="${PORTAL}">Open portal</a></div>`, 404);
    }

    const { data: booking } = await admin
      .from("bookings")
      .select("id, booking_number, first_name, service_date, time_slot, service_type, city, zip_code")
      .eq("id", offer.booking_id)
      .maybeSingle();
    const ref = booking?.booking_number
      ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
      : "this job";

    const jobBlock = `<div class="job">
      <div><strong>${esc(ref)}</strong> · ${esc(String(booking?.service_type || "clean").replace(/_/g, " "))}</div>
      <div>${esc(booking?.service_date || "")} ${esc(booking?.time_slot || "")}</div>
      <div class="muted">${esc(booking?.city || "")} ${esc(booking?.zip_code || "")}</div>
    </div>`;

    if (action === "decline") {
      const { data: res, error } = await admin.rpc("decline_coverage_offer", {
        p_token: offerToken,
        p_reason: "Passed via the offer link",
      });
      if (error) throw error;
      log("declined", { offerId: offer.id, res });
      return page("Thanks for answering", `<h1>No problem — passed on</h1>
        <p>We're asking the next cleaner now.</p>
        <p class="muted"><strong>This does not affect your score.</strong> Passing on backup
        cover is exactly the honest answer we want; only accepting a job and then not showing
        up counts against you.</p>
        <div class="row"><a class="btn primary" href="${PORTAL}">Open portal</a></div>`);
    }

    if (action === "accept") {
      const { data: claim, error: claimErr } = await admin.rpc("claim_coverage_offer", {
        p_token: offerToken,
      });
      if (claimErr) throw claimErr;

      if (!claim?.ok) {
        const gone = String(claim?.code || "");
        return page("Already taken", `<h1>${gone === "expired" ? "That window closed" : "Already covered"}</h1>
          <p>${esc(claim?.error || "Somebody else picked this one up.")}</p>
          <p class="muted">Nothing lost — this doesn't affect your score.</p>
          <div class="row"><a class="btn primary" href="${PORTAL}">Open portal</a></div>`, 409);
      }

      if (claim.code === "already_yours") {
        return page("It's yours", `<h1 class="ok">This job is already yours</h1>
          ${jobBlock}
          <p>Everything you need is in your portal — address and access, the scope checklist,
          special instructions and your pay.</p>
          <div class="row"><a class="btn primary" href="${PORTAL}">Open the job</a></div>`);
      }

      // The canonical assign path: it withdraws the outgoing cleaner (revoking
      // their time-scoped access to this job), issues the checklist tokens, and
      // sends the full assignment notification. Nothing about the handoff is
      // reimplemented here, because a partially-informed replacement is how a
      // covered job still fails.
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
      let assignError: string | null = null;
      try {
        const res = await fetch(`${supabaseUrl}/functions/v1/admin-booking-assign`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceKey}`,
            apikey: serviceKey,
          },
          body: JSON.stringify({
            bookingId: offer.booking_id,
            cleanerIds: [offer.cleaner_id],
            mode: "replace",
            notify: true,
            allowUnpaid: true,
            actorName: `${offer.cleaner_name || "Cleaner"} (accepted coverage offer)`,
            // The cleaner accepting cover is not the person who should be
            // blocked by a buffer they didn't create; the shortfall is logged
            // as an override with that reason on the record.
            bufferOverrideReason:
              "Coverage offer accepted by the cleaner — the alternative was an uncovered job.",
          }),
        });
        const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
        if (!res.ok || json?.error) assignError = String(json?.error || `assign failed (${res.status})`);
      } catch (e) {
        assignError = e instanceof Error ? e.message : String(e);
      }

      if (assignError) {
        await admin.rpc("release_coverage_claim", { p_offer_id: offer.id, p_error: assignError });
        log("assign failed after claim", { offerId: offer.id, assignError });
        return page("We hit a snag", `<h1 class="bad">Something went wrong on our side</h1>
          <p>We couldn't put this job on your schedule. Our team has been alerted — please don't
          head out until someone confirms.</p>
          <div class="row"><a class="btn primary" href="${PORTAL}">Open portal</a></div>`, 500);
      }

      await admin.rpc("settle_coverage_request", {
        p_request_id: offer.coverage_request_id,
        p_cleaner_id: offer.cleaner_id,
        p_via: "offer_accepted",
        p_actor: null,
        p_actor_name: `${offer.cleaner_name || "Cleaner"} (offer accepted)`,
      });

      log("coverage accepted", { offerId: offer.id, bookingId: offer.booking_id });

      return page("You've got it", `<h1 class="ok">It's yours — thank you</h1>
        ${jobBlock}
        <p>The full job is in your portal now: address and unit, how to get in, the scope
        checklist and add-ons, any special instructions, the deadline, and your pay.</p>
        <p class="muted">Paid normally at your usual rate, like any other job.</p>
        <div class="row"><a class="btn primary" href="${PORTAL}">Open the job</a></div>`);
    }

    // No action: show the offer.
    if (offer.status !== "offered") {
      return page("Already answered", `<h1>You've already answered this one</h1>
        <p>Status: ${esc(offer.status)}.</p>
        <div class="row"><a class="btn primary" href="${PORTAL}">Open portal</a></div>`);
    }

    const act = (a: string) => `${url.origin}${url.pathname}?t=${encodeURIComponent(offerToken)}&a=${a}`;
    return page("Coverage job available", `<h1>Can you cover this job?</h1>
      ${jobBlock}
      <p>Someone has to step in and you're near the top of the list.
      ${offer.expires_at ? `This offer holds until <strong>${esc(timeLabel(offer.expires_at, tz))}</strong>.` : ""}</p>
      <div class="row">
        <a class="btn primary" href="${act("accept")}">Yes, I'll take it</a>
        <a class="btn ghost" href="${act("decline")}">Can't do it</a>
      </div>
      <p class="note">Paid normally at your usual rate. Passing on it doesn't affect your score —
      we'd much rather you say no than accept and not turn up.</p>`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("error", msg);
    return page("Something went wrong", `<h1 class="bad">Something went wrong</h1>
      <p>${esc(msg)}</p>
      <div class="row"><a class="btn primary" href="${PORTAL}">Open portal</a></div>`, 500);
  }
});
