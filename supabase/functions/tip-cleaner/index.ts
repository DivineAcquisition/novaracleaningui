// tip-cleaner
//
// Customer tips — 100% pass-through to the cleaner(s), walled off from
// scores, tier progression, and job-value math.
//
//   { action:"checkout", bookingId, amountCents, directedCleanerId? }
//     Creates a Stripe Checkout session for the tip. Metadata carries the
//     booking + optional customer-directed cleaner ("this is for Maria").
//     Returns the payment URL.
//
//   { action:"confirm", sessionId }
//     Called from the success page. Verifies the session PAID with Stripe,
//     then (idempotently, keyed on session id):
//       • splits the tip equally across the job's ACTUAL crew record
//         (job_assignments for the booking's job; fallback booking.cleaner_id)
//         unless customer-directed — then 100% to that cleaner
//       • writes cleaner_tips rows (each share, full pass-through)
//       • bumps bookings.tip_cents by the total
//       • notifies each cleaner by SMS (best-effort)
//     Scores, tiers, payroll job-pay math are never touched.
//
//   { action:"crew", bookingId }
//     Public helper for the tip UI: the crew names on the job (first names
//     only) so the customer can direct a tip.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}
const log = (m: string, d?: unknown) =>
  console.log(`[tip-cleaner] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

async function resolveSecret(supabase: SB, key: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return ((data?.value as string) || Deno.env.get(key) || "").trim();
  } catch {
    return (Deno.env.get(key) || "").trim();
  }
}

async function stripeCall(key: string, method: "GET" | "POST", path: string, params?: Record<string, string>): Promise<Record<string, any>> {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${key}` } };
  if (params && method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else if (params) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(params).toString();
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
}

/** The job's actual crew: confirmed/accepted/completed assignments, else the booking's cleaner. */
async function crewForBooking(supabase: SB, booking: { job_id: string | null; cleaner_id: string | null }): Promise<Array<{ id: string; first_name: string | null; last_name: string | null; phone: string | null }>> {
  const ids = new Set<string>();
  if (booking.job_id) {
    const { data: assigns } = await supabase
      .from("job_assignments")
      .select("cleaner_id, status")
      .eq("job_id", booking.job_id);
    for (const a of assigns || []) {
      const s = String(a.status || "").toLowerCase();
      if (a.cleaner_id && ["confirmed", "accepted", "completed", "in progress"].includes(s)) ids.add(a.cleaner_id);
    }
  }
  if (ids.size === 0 && booking.cleaner_id) ids.add(booking.cleaner_id);
  if (ids.size === 0) return [];
  const { data: cleaners } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, phone")
    .in("id", [...ids]);
  return cleaners || [];
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    if (action === "crew") {
      const bookingId = String(body?.bookingId || "");
      if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);
      const { data: booking } = await supabase
        .from("bookings").select("id, job_id, cleaner_id, status").eq("id", bookingId).maybeSingle();
      if (!booking) return json({ ok: false, error: "Booking not found" }, 404);
      const crew = await crewForBooking(supabase, booking);
      return json({
        ok: true,
        crew: crew.map((c) => ({ id: c.id, name: `${c.first_name || ""} ${(c.last_name || "").slice(0, 1)}`.trim() })),
      });
    }

    if (action === "checkout") {
      const bookingId = String(body?.bookingId || "");
      const amountCents = Math.round(Number(body?.amountCents) || 0);
      const directedCleanerId = body?.directedCleanerId ? String(body.directedCleanerId) : "";
      if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);
      if (amountCents < 100 || amountCents > 50000) return json({ ok: false, error: "Tip must be between $1 and $500." }, 400);

      const { data: booking } = await supabase
        .from("bookings")
        .select("id, booking_number, job_id, cleaner_id, first_name, email, status")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking) return json({ ok: false, error: "Booking not found" }, 404);
      const crew = await crewForBooking(supabase, booking);
      if (crew.length === 0) return json({ ok: false, error: "No cleaner on record for this job yet." }, 400);
      if (directedCleanerId && !crew.some((c) => c.id === directedCleanerId)) {
        return json({ ok: false, error: "That cleaner wasn't on this job." }, 400);
      }

      const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
      if (!stripeKey) return json({ ok: false, error: "Payments not configured." }, 500);

      const origin = req.headers.get("origin") || "https://app.novaracleaning.com";
      const ref = booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : bookingId.slice(0, 8);
      // Callers (e.g. the tokenized feedback page) may supply their own
      // return URLs so the customer lands back where they started. The
      // success URL must carry the Stripe session placeholder so the
      // confirm step can verify payment.
      const successUrl = typeof body?.successUrl === "string" && body.successUrl.includes("{CHECKOUT_SESSION_ID}")
        ? String(body.successUrl)
        : `${origin}/tip/success?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = typeof body?.cancelUrl === "string" && body.cancelUrl.startsWith("http")
        ? String(body.cancelUrl)
        : `${origin}/account`;
      const session = await stripeCall(stripeKey, "POST", "checkout/sessions", {
        mode: "payment",
        "line_items[0][price_data][currency]": "usd",
        "line_items[0][price_data][unit_amount]": String(amountCents),
        "line_items[0][price_data][product_data][name]": `Tip for your cleaning crew — ${ref}`,
        "line_items[0][quantity]": "1",
        ...(booking.email ? { customer_email: booking.email } : {}),
        success_url: successUrl,
        cancel_url: cancelUrl,
        "metadata[kind]": "cleaner_tip",
        "metadata[booking_id]": bookingId,
        "metadata[directed_cleaner_id]": directedCleanerId,
        "payment_intent_data[description]": `Cleaner tip — ${ref} (100% pass-through)`,
      });
      return json({ ok: true, url: session.url, sessionId: session.id });
    }

    if (action === "confirm") {
      const sessionId = String(body?.sessionId || "");
      if (!sessionId) return json({ ok: false, error: "sessionId required" }, 400);

      // Idempotency: already recorded?
      const { data: existing } = await supabase
        .from("cleaner_tips").select("id").eq("stripe_session_id", sessionId).limit(1);
      if (existing && existing.length > 0) return json({ ok: true, already: true });

      const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
      const session = await stripeCall(stripeKey, "GET", `checkout/sessions/${encodeURIComponent(sessionId)}`);
      if (session?.metadata?.kind !== "cleaner_tip") return json({ ok: false, error: "Not a tip session." }, 400);
      if (session.payment_status !== "paid") return json({ ok: false, error: "Payment not completed yet." }, 400);

      const bookingId = String(session.metadata.booking_id || "");
      const directedCleanerId = String(session.metadata.directed_cleaner_id || "");
      const totalCents = Number(session.amount_total) || 0;
      const piId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id || null;

      const { data: booking } = await supabase
        .from("bookings")
        .select("id, booking_number, job_id, cleaner_id, tip_cents, first_name")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking) return json({ ok: false, error: "Booking not found" }, 404);

      const crew = await crewForBooking(supabase, booking);
      const recipients = directedCleanerId
        ? crew.filter((c) => c.id === directedCleanerId)
        : crew;
      if (recipients.length === 0) return json({ ok: false, error: "No crew on record." }, 400);

      // Equal split; remainder cents go to the first cleaner so shares sum
      // exactly to the customer's tip (100% pass-through, company takes 0).
      const base = Math.floor(totalCents / recipients.length);
      const remainder = totalCents - base * recipients.length;
      const rows = recipients.map((c, i) => ({
        booking_id: bookingId,
        cleaner_id: c.id,
        amount_cents: base + (i === 0 ? remainder : 0),
        allocation: directedCleanerId ? "directed" : "split",
        crew_size: recipients.length,
        total_tip_cents: totalCents,
        stripe_session_id: sessionId,
        stripe_payment_intent_id: piId,
        status: "received",
      }));
      const { error: insErr } = await supabase.from("cleaner_tips").insert(rows);
      if (insErr) {
        // Unique index on (session, cleaner) makes double-confirms harmless.
        if (String(insErr.message).includes("duplicate")) return json({ ok: true, already: true });
        throw insErr;
      }

      await supabase.from("bookings").update({
        tip_cents: (Number(booking.tip_cents) || 0) + totalCents,
      }).eq("id", bookingId);

      const ref = booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : bookingId.slice(0, 8);
      await supabase.from("events").insert({
        event_type: "cleaner.tip_received",
        booking_id: bookingId,
        source: "tip-cleaner",
        summary: `💜 $${(totalCents / 100).toFixed(2)} tip on ${ref} — ${directedCleanerId ? `directed to ${recipients[0].first_name}` : `split ${recipients.length} way${recipients.length === 1 ? "" : "s"}`} (100% pass-through).`,
        data: { total_cents: totalCents, crew: recipients.map((c) => c.id), directed: Boolean(directedCleanerId) },
      }).then(() => undefined, () => undefined);

      // Tell the crew (best-effort).
      for (const [i, c] of recipients.entries()) {
        if (!c.phone) continue;
        const share = rows[i].amount_cents;
        await supabase.functions.invoke("send-ghl-sms", {
          body: {
            phone: c.phone,
            message: `Novara: You received a $${(share / 100).toFixed(2)} tip from your ${ref} customer${recipients.length > 1 ? ` (split of a $${(totalCents / 100).toFixed(2)} crew tip)` : ""}. 100% goes to you — it will be included with your next payout. 💜`,
          },
        }).catch(() => undefined);
      }

      return json({ ok: true, totalCents, shares: rows.map((r) => ({ cleanerId: r.cleaner_id, amountCents: r.amount_cents })) });
    }

    return json({ ok: false, error: `Unknown action '${action}'` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
