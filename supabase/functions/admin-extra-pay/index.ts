// admin-extra-pay
//
// Per-job EXTRA pay for contractors — supply reimbursement, mileage, surge
// pay, and overtime — paid out immediately via an exact-amount Stripe
// transfer (the same Custom Payout rail as pay-cleaner-transfer). Each
// payment is recorded per (booking, cleaner) in public.job_extra_pay so the
// money always ties back to a specific job.
//
// Body:
//   { action: "list", cleanerId? , bookingId?, limit? }
//       → recent extra-pay rows (newest first), enriched with booking ref
//   { action: "pay", cleanerId, bookingId?, jobId?,
//     supplyCents?, mileageMiles?, mileageRateCents?,   // default 70¢/mi
//     surgeCents?, overtimeHours?, overtimeRateCents?,
//     note? }
//       → records the row and fires the transfer. Total must be > 0.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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

const MAX_TOTAL_CENTS = 500_000; // $5k fat-finger cap per extra payment

// deno-lint-ignore no-explicit-any
type DB = any;

async function ensureAdminOrVa(admin: DB, jwt: string): Promise<string> {
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

const usd = (c: number) => `$${(c / 100).toFixed(2)}`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const actor = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list").toLowerCase();

    // ─── LIST ────────────────────────────────────────────────────────────
    if (action === "list") {
      const limit = Math.min(Math.max(Number(body?.limit) || 50, 1), 200);
      let q = admin
        .from("job_extra_pay")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (body?.cleanerId) q = q.eq("cleaner_id", String(body.cleanerId));
      if (body?.bookingId) q = q.eq("booking_id", String(body.bookingId));
      const { data: rows, error } = await q;
      if (error) throw error;

      // Enrich with booking ref + cleaner name.
      const bookingIds = Array.from(new Set((rows || []).map((r: Record<string, unknown>) => r.booking_id).filter(Boolean)));
      const cleanerIds = Array.from(new Set((rows || []).map((r: Record<string, unknown>) => r.cleaner_id).filter(Boolean)));
      const bookingById = new Map<string, Record<string, unknown>>();
      const cleanerById = new Map<string, Record<string, unknown>>();
      if (bookingIds.length > 0) {
        const { data: bks } = await admin
          .from("bookings")
          .select("id, booking_number, first_name, last_name, service_date")
          .in("id", bookingIds);
        for (const b of bks || []) bookingById.set(String(b.id), b);
      }
      if (cleanerIds.length > 0) {
        const { data: cs } = await admin.from("cleaners").select("id, first_name, last_name").in("id", cleanerIds);
        for (const c of cs || []) cleanerById.set(String(c.id), c);
      }

      const payments = (rows || []).map((r: Record<string, unknown>) => {
        const b = r.booking_id ? bookingById.get(String(r.booking_id)) : null;
        const c = cleanerById.get(String(r.cleaner_id));
        return {
          ...r,
          booking_ref: b?.booking_number ? `NOV-${String(b.booking_number).padStart(5, "0")}` : null,
          customer: b ? `${b.first_name || ""} ${b.last_name || ""}`.trim() : null,
          service_date: b?.service_date ?? null,
          cleaner_name: c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : null,
        };
      });
      return json({ ok: true, payments });
    }

    // ─── PAY ─────────────────────────────────────────────────────────────
    if (action === "pay") {
      const cleanerId = String(body?.cleanerId || "");
      if (!cleanerId) return json({ error: "cleanerId required" }, 400);
      const bookingId = body?.bookingId ? String(body.bookingId) : null;
      let jobId = body?.jobId ? String(body.jobId) : null;

      const supplyCents = Math.max(0, Math.round(Number(body?.supplyCents) || 0));
      const mileageMiles = Math.max(0, Number(body?.mileageMiles) || 0);
      const mileageRateCents = Math.max(0, Math.round(Number(body?.mileageRateCents ?? 70)));
      const mileageCents = Math.round(mileageMiles * mileageRateCents);
      const surgeCents = Math.max(0, Math.round(Number(body?.surgeCents) || 0));
      const overtimeHours = Math.max(0, Number(body?.overtimeHours) || 0);
      const overtimeRateCents = Math.max(0, Math.round(Number(body?.overtimeRateCents) || 0));
      const overtimeCents = Math.round(overtimeHours * overtimeRateCents);
      const totalCents = supplyCents + mileageCents + surgeCents + overtimeCents;
      const note = String(body?.note || "").slice(0, 500) || null;

      if (totalCents <= 0) return json({ error: "Enter at least one amount — total must be greater than $0." }, 400);
      if (totalCents > MAX_TOTAL_CENTS) {
        return json({ error: `Total ${usd(totalCents)} exceeds the ${usd(MAX_TOTAL_CENTS)} per-payment cap.` }, 400);
      }

      // Resolve booking (for the job ref + jobId) — optional but preferred.
      let bookingRef = "off-platform job";
      if (bookingId) {
        const { data: b } = await admin
          .from("bookings")
          .select("id, booking_number, job_id, first_name")
          .eq("id", bookingId)
          .maybeSingle();
        if (!b) return json({ error: "Booking not found" }, 404);
        if (!jobId && b.job_id) jobId = String(b.job_id);
        bookingRef = b.booking_number ? `NOV-${String(b.booking_number).padStart(5, "0")}` : `BK-${bookingId.slice(0, 8)}`;
      }

      // Record first (stable idempotency key), then transfer.
      const { data: row, error: insErr } = await admin.from("job_extra_pay").insert({
        booking_id: bookingId,
        job_id: jobId,
        cleaner_id: cleanerId,
        supply_cents: supplyCents,
        mileage_miles: mileageMiles,
        mileage_rate_cents: mileageRateCents,
        mileage_cents: mileageCents,
        surge_cents: surgeCents,
        overtime_hours: overtimeHours,
        overtime_rate_cents: overtimeRateCents,
        overtime_cents: overtimeCents,
        total_cents: totalCents,
        note,
        status: "pending",
        created_by: actor,
      }).select("id").single();
      if (insErr) throw insErr;

      const parts: string[] = [];
      if (supplyCents > 0) parts.push(`supplies ${usd(supplyCents)}`);
      if (mileageCents > 0) parts.push(`mileage ${mileageMiles}mi ${usd(mileageCents)}`);
      if (surgeCents > 0) parts.push(`surge ${usd(surgeCents)}`);
      if (overtimeCents > 0) parts.push(`overtime ${overtimeHours}h ${usd(overtimeCents)}`);
      const label = `Novara extra pay (${parts.join(", ")}) — ${bookingRef}`;

      // Exact-amount transfer via the proven Custom Payout rail. Idempotency
      // is keyed on OUR row id so a retry never double-pays.
      const { data: payRes, error: payErr } = await admin.functions.invoke("pay-cleaner-transfer", {
        body: {
          cleanerId,
          amountCents: totalCents,
          bookingId,
          label,
          idempotencyKey: `extra_pay_${row.id}`,
        },
      });
      const payload = (payRes || {}) as Record<string, unknown>;
      if (payErr || payload.error) {
        const reason = String(payload.error || payErr?.message || "Transfer failed");
        await admin.from("job_extra_pay").update({ status: "failed", failure_reason: reason }).eq("id", row.id);
        return json({ error: reason, extraPayId: row.id, status: "failed" }, 502);
      }

      await admin.from("job_extra_pay").update({
        status: "paid",
        stripe_transfer_id: (payload.transferId as string) || null,
        paid_at: new Date().toISOString(),
        failure_reason: null,
      }).eq("id", row.id);

      await admin.from("events").insert({
        event_type: "cleaner.extra_pay",
        booking_id: bookingId,
        job_id: jobId,
        cleaner_id: cleanerId,
        source: "admin-extra-pay",
        summary: `${bookingRef} — extra pay ${usd(totalCents)} (${parts.join(", ")}) sent to ${payload.cleanerName || "cleaner"}${note ? ` — "${note}"` : ""}`,
        data: { extra_pay_id: row.id, transfer_id: payload.transferId, by: actor, supply_cents: supplyCents, mileage_cents: mileageCents, surge_cents: surgeCents, overtime_cents: overtimeCents },
      }).then(() => undefined, () => undefined);

      return json({
        ok: true,
        extraPayId: row.id,
        status: "paid",
        totalCents,
        transferId: payload.transferId ?? null,
        breakdown: { supplyCents, mileageCents, surgeCents, overtimeCents },
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-extra-pay]", msg);
    return json({ error: msg }, msg.includes("signed in") || msg.includes("only") ? 401 : 500);
  }
});
