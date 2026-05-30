// ─── send-remaining-day-of ───────────────────────────────────────────────
//
// Runs every morning and sends the remaining-balance Stripe invoice for
// every confirmed deposit-paid booking whose service is happening today.
// This is the cadence change the operator asked for: at booking time
// only the deposit invoice goes out, the second invoice now waits until
// the morning of service instead of being sent immediately.
//
// Selection criteria (per booking):
//   * status IN ('confirmed', 'assigned', 'in_progress')
//   * payment_option = 'deposit'          (i.e. NOT 'full' and NOT 'preauth')
//   * service_date = today (UTC)
//   * stripe_invoice_id IS NULL           (no remaining invoice yet)
//   * total_estimate_cents > deposit_cents
//   * email IS NOT NULL                   (Stripe needs a customer)
//
// For each match we delegate to `send-remaining-balance-invoice` which
// already handles Stripe customer lookup, idempotency, and stamping
// stripe_invoice_id + hosted_invoice_url back onto the booking row.
//
// Pre-auth bookings (payment_option='preauth') are intentionally skipped
// — those are charged via `prepare-completion-hold` + capture on
// `complete-booking`, not via a hosted invoice.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface DayOfBody {
  /** Override target date (YYYY-MM-DD). Useful for backfill / ops dry-runs. */
  date?: string;
  /** When true, return the candidate list without invoicing. */
  dryRun?: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body: DayOfBody = req.method === "POST"
      ? await req.json().catch(() => ({} as DayOfBody))
      : {};
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const today = body.date || new Date().toISOString().slice(0, 10);

    const { data: bookings, error } = await supabase
      .from("bookings")
      .select(
        "id, booking_number, email, first_name, status, payment_option, service_date, total_estimate_cents, deposit_cents, stripe_invoice_id, hosted_invoice_url",
      )
      .eq("service_date", today)
      .eq("payment_option", "deposit")
      .in("status", ["confirmed", "assigned", "in_progress"])
      .is("stripe_invoice_id", null);
    if (error) throw error;

    const candidates = (bookings || []).filter((b) => {
      const total = Number(b.total_estimate_cents || 0);
      const dep = Number(b.deposit_cents || 0);
      return total > dep && !!b.email;
    });

    if (body.dryRun) {
      return new Response(
        JSON.stringify({ ok: true, today, candidates: candidates.length, ids: candidates.map((b) => b.id) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const results: Array<{ bookingId: string; ok: boolean; invoiceId?: string | null; error?: string }> = [];
    for (const b of candidates) {
      try {
        const { data, error: invErr } = await supabase.functions.invoke(
          "send-remaining-balance-invoice",
          { body: { bookingId: b.id } },
        );
        if (invErr) {
          results.push({ bookingId: b.id, ok: false, error: String((invErr as Error).message || invErr) });
        } else {
          // deno-lint-ignore no-explicit-any
          const json = data as any;
          results.push({
            bookingId: b.id,
            ok: !!json?.success,
            invoiceId: json?.invoiceId || null,
            error: json?.error || undefined,
          });
        }
      } catch (e) {
        results.push({ bookingId: b.id, ok: false, error: e instanceof Error ? e.message : String(e) });
      }
    }

    return new Response(
      JSON.stringify({ ok: true, today, processed: results.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
