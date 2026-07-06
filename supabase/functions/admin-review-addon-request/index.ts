// admin-review-addon-request
//
// Admin/VA: approve or reject a contractor-reported add-on from the
// Dispatch console. Approval is the ONLY path that charges the customer:
// it forwards to admin-add-booking-addons (same server-authoritative
// pricing + off-session charge / hosted-invoice fallback used everywhere
// else) with the caller's own JWT, then:
//   • marks the request approved with the charge outcome
//   • bumps estimated_pay_cents on the job's confirmed assignments so the
//     pay increase is visible to the crew immediately
//   • SMSes the requesting cleaner their pay bump
//   • emits job.addon.reviewed (internal dispatch Discord channel)
//
// Body: { requestId: string, action: 'approve' | 'reject', priceDollars?: number, note?: string }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, jwt: string): Promise<string> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
  return u.user.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const callerId = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const requestId = String(body?.requestId || "");
    const action = String(body?.action || "").toLowerCase();
    const reviewNote = body?.note ? String(body.note).slice(0, 500) : null;
    if (!requestId || (action !== "approve" && action !== "reject")) {
      return json({ error: "requestId and action ('approve'|'reject') required" }, 400);
    }

    const { data: request } = await admin
      .from("job_addon_requests")
      .select("*")
      .eq("id", requestId)
      .maybeSingle();
    if (!request) return json({ error: "Add-on request not found" }, 404);
    if (request.status !== "pending") {
      return json({ error: `Request already ${request.status}.` }, 409);
    }

    const nowIso = new Date().toISOString();
    const refFromBooking = (b: { booking_number?: number | null } | null, fallback: string) =>
      b?.booking_number ? `NOV-${String(b.booking_number).padStart(5, "0")}` : fallback;

    // ─── REJECT ──────────────────────────────────────────────────────────
    if (action === "reject") {
      await admin
        .from("job_addon_requests")
        .update({ status: "rejected", reviewed_by: callerId, reviewed_at: nowIso, review_note: reviewNote })
        .eq("id", requestId);

      await admin.from("events").insert({
        event_type: "job.addon.reviewed",
        job_id: request.job_id,
        booking_id: request.booking_id,
        cleaner_id: request.cleaner_id,
        source: "admin-review-addon-request",
        summary: `Add-on REJECTED: ${request.addon_label || request.addon_id} ($${(Number(request.amount_cents) / 100).toFixed(2)}) reported by ${request.cleaner_name || "cleaner"}${reviewNote ? ` — "${reviewNote}"` : ""}. No charge made.`,
        data: { request_id: requestId, action: "reject", by: callerId },
      }).catch(() => {});

      return json({ ok: true, status: "rejected" });
    }

    // ─── APPROVE ─────────────────────────────────────────────────────────
    if (!request.booking_id) {
      return json({ error: "Request has no linked booking to charge." }, 400);
    }
    const { data: booking } = await admin
      .from("bookings")
      .select("id, booking_number, add_ons, service_type")
      .eq("id", request.booking_id)
      .maybeSingle();
    if (!booking) return json({ error: "Linked booking not found" }, 404);

    const currentAddOns: string[] = Array.isArray(booking.add_ons) ? booking.add_ons.map(String) : [];
    if (currentAddOns.includes(request.addon_id)) {
      return json({ error: "That add-on is already on the booking — nothing to charge." }, 409);
    }
    const newAddOns = [...currentAddOns, request.addon_id];

    // Optional admin price override (dollars). Default: catalog price via
    // the charging function; we pass the request amount so the charge
    // matches what the contractor was shown unless overridden.
    const overrideDollars = Number(body?.priceDollars);
    const priceDollars = Number.isFinite(overrideDollars) && overrideDollars >= 0
      ? overrideDollars
      : Number(request.amount_cents) / 100;

    // Forward to the canonical add-on charge function with the CALLER's
    // JWT so its own admin/VA gate + audit trail stay intact.
    const chargeRes = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/admin-add-booking-addons`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${jwt}`,
          apikey: Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        },
        body: JSON.stringify({
          bookingId: request.booking_id,
          addOns: newAddOns,
          charge: true,
          addOnPrices: { [request.addon_id]: priceDollars },
        }),
      },
    );
    const chargePayload = await chargeRes.json().catch(() => ({}));
    if (!chargeRes.ok || chargePayload?.error) {
      return json({
        error: `Charge failed: ${chargePayload?.error || `HTTP ${chargeRes.status}`}`,
        chargeStatus: "failed",
      }, 502);
    }

    const chargeStatus = String(chargePayload?.status || (chargePayload?.charged ? "paid" : "invoiced"));
    const amountCents = Math.round(priceDollars * 100);

    await admin
      .from("job_addon_requests")
      .update({
        status: "approved",
        reviewed_by: callerId,
        reviewed_at: nowIso,
        review_note: reviewNote,
        amount_cents: amountCents,
        charge_status: chargeStatus,
      })
      .eq("id", requestId);

    // Visible pay bump: the payout engine already keys off booking revenue
    // (which just grew), so update the crew's estimated_pay_cents to match.
    let perCleanerBumpCents = 0;
    if (request.job_id) {
      const { data: confirmed } = await admin
        .from("job_assignments")
        .select("id, estimated_pay_cents, pay_percentage_snapshot, cleaner_id, cleaners(pay_percentage)")
        .eq("job_id", request.job_id)
        .or("status.ilike.confirmed,status.ilike.accepted");
      const team = confirmed || [];
      if (team.length > 0) {
        const teamPct = team.reduce((m: number, a: { pay_percentage_snapshot?: number | null; cleaners?: { pay_percentage?: number | null } | { pay_percentage?: number | null }[] }) => {
          const c = Array.isArray(a.cleaners) ? a.cleaners[0] : a.cleaners;
          const p = Number(a.pay_percentage_snapshot ?? c?.pay_percentage) || 35;
          return p > m ? p : m;
        }, 35);
        perCleanerBumpCents = Math.floor((amountCents * teamPct) / 100 / team.length);
        if (perCleanerBumpCents > 0) {
          for (const a of team) {
            await admin
              .from("job_assignments")
              .update({ estimated_pay_cents: Number(a.estimated_pay_cents || 0) + perCleanerBumpCents })
              .eq("id", a.id);
          }
        }
      }
    }

    // Tell the requesting cleaner their pay went up.
    if (request.cleaner_id && perCleanerBumpCents > 0) {
      try {
        const { data: c } = await admin
          .from("cleaners")
          .select("first_name, last_name, phone, email, sms_notifications_enabled")
          .eq("id", request.cleaner_id)
          .maybeSingle();
        if (c?.phone && c.sms_notifications_enabled !== false) {
          await admin.functions.invoke("send-ghl-sms", {
            body: {
              phone: c.phone,
              email: c.email || undefined,
              firstName: c.first_name || undefined,
              message: `Novara: your add-on "${request.addon_label || request.addon_id}" was approved. Your pay for this job increased by $${(perCleanerBumpCents / 100).toFixed(2)}.`,
              type: "addon_approved",
            },
          });
        }
      } catch (_) { /* non-blocking */ }
    }

    const ref = refFromBooking(booking, `Job ${String(request.job_id || "").slice(0, 8)}`);
    await admin.from("events").insert({
      event_type: "job.addon.reviewed",
      job_id: request.job_id,
      booking_id: request.booking_id,
      cleaner_id: request.cleaner_id,
      source: "admin-review-addon-request",
      summary: `${ref} — add-on APPROVED: ${request.addon_label || request.addon_id} ($${priceDollars.toFixed(2)}). Customer charge: ${chargeStatus}. Crew pay +$${(perCleanerBumpCents / 100).toFixed(2)} per cleaner.`,
      data: { request_id: requestId, action: "approve", by: callerId, charge_status: chargeStatus, amount_cents: amountCents },
    }).catch(() => {});

    return json({
      ok: true,
      status: "approved",
      chargeStatus,
      amountCents,
      perCleanerBumpCents,
      hostedInvoiceUrl: chargePayload?.hostedInvoiceUrl || null,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-review-addon-request]", msg);
    return json({ error: msg }, 500);
  }
});
