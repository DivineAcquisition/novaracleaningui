// payroll-operations
//
// Read API that connects the Payroll portal to LIVE operations. It derives
// payroll jobs directly from real bookings + job_assignments + cleaners (the
// tables the rest of the app already writes to), so every completed/scheduled
// job shows up in payroll automatically — no manual re-entry, no dependency
// on the manual payroll_* tables.
//
// For each booking it resolves the assigned cleaner(s) and each cleaner's
// locked pay (job_assignments.estimated_pay_cents snapshot, falling back to a
// computed revenue-share split). Pay % is the snapshot taken at assignment
// time so promotions never recompute historical pay.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import {
  calculateCleanerPoolCents,
  maxPayPercentage,
  normalizePayTier,
  payPercentageForTier,
} from "../_shared/payout-utils.ts";

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

// deno-lint-ignore no-explicit-any
type DB = any;

function pad(n: number) { return String(n).padStart(2, "0"); }
function ymd(d: Date) { return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
function monday(dateInput: string): string {
  const datePart = String(dateInput).slice(0, 10);
  const d = new Date(`${datePart}T12:00:00Z`);
  const dow = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (dow === 0 ? -6 : 1 - dow));
  return ymd(d);
}

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

const PAID_STATUSES = ["completed", "processing"];

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
    await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "list");
    const limit = Math.min(Math.max(Number(body?.limit) || 800, 1), 2000);

    // ─── Cleaner roster (service-role read so the portal never depends on
    //     client-side RLS for the cleaners table) ──────────────────────────
    if (action === "cleaners") {
      // NOTE: deliberately NOT selecting payment_method — that column only
      // exists after the manual-payroll migration. The operational payout
      // flow doesn't need it, so the roster loads with or without the migration.
      const { data: cs } = await admin
        .from("cleaners")
        .select("id, first_name, last_name, email, pay_tier, pay_percentage, stripe_account_id, payouts_enabled, status")
        .order("first_name", { ascending: true });
      return json({ success: true, cleaners: (cs || []).map((c: Record<string, unknown>) => ({ ...c, payment_method: "stripe_connect" })) });
    }

    // ─── Payout ledger (real Stripe transfers) for the Runs history ──────
    if (action === "payouts") {
      const { data: payouts } = await admin
        .from("payouts")
        .select("id, booking_id, cleaner_id, total_booking_amount_cents, platform_fee_cents, cleaner_payout_cents, stripe_transfer_id, status, processed_at, created_at")
        .order("created_at", { ascending: false })
        .limit(limit);
      const list = (payouts || []) as unknown as Record<string, unknown>[];
      const cIds = Array.from(new Set(list.map((p) => p.cleaner_id).filter(Boolean))) as string[];
      const bIds = Array.from(new Set(list.map((p) => p.booking_id).filter(Boolean))) as string[];
      const names = new Map<string, string>();
      const bookingNums = new Map<string, string>();
      if (cIds.length > 0) {
        const { data: cs } = await admin.from("cleaners").select("id, first_name, last_name").in("id", cIds);
        for (const c of cs || []) names.set(String(c.id), `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner");
      }
      if (bIds.length > 0) {
        const { data: bs } = await admin.from("bookings").select("id, booking_number, service_date").in("id", bIds);
        for (const b of bs || []) bookingNums.set(String(b.id), b.booking_number ? `NOV-${String(b.booking_number).padStart(5, "0")}` : "");
      }
      const ledger = list.map((p) => ({
        id: p.id,
        bookingId: p.booking_id,
        bookingNumber: p.booking_id ? (bookingNums.get(String(p.booking_id)) || null) : null,
        cleanerId: p.cleaner_id,
        cleanerName: p.cleaner_id ? (names.get(String(p.cleaner_id)) || "Cleaner") : "—",
        totalBookingCents: p.total_booking_amount_cents,
        platformFeeCents: p.platform_fee_cents,
        payoutCents: p.cleaner_payout_cents,
        stripeTransferId: p.stripe_transfer_id,
        status: p.status,
        processedAt: p.processed_at,
        createdAt: p.created_at,
      }));
      return json({ success: true, payouts: ledger });
    }

    // Window: default last 90 days → +21 days (covers past + live/upcoming).
    const today = new Date();
    const defFrom = new Date(today); defFrom.setDate(defFrom.getDate() - 90);
    const defTo = new Date(today); defTo.setDate(defTo.getDate() + 21);
    const fromDate = String(body?.fromDate || ymd(defFrom)).slice(0, 10);
    const toDate = String(body?.toDate || ymd(defTo)).slice(0, 10);

    // 1. Bookings in window that represent real jobs (exclude pre-payment +
    //    cancelled). These are the live + past jobs payroll is built from.
    const { data: bookings, error: bErr } = await admin
      .from("bookings")
      .select(
        "id, booking_number, status, service_type, service_date, completed_at, first_name, last_name, " +
        "total_estimate_cents, final_charge_cents, cleaner_payout_cents, payout_status, cleaner_id, " +
        "num_cleaners_assigned, job_id, created_at",
      )
      .gte("service_date", fromDate)
      .lte("service_date", toDate)
      .not("status", "in", "(pending_payment,cancelled,abandoned)")
      .order("service_date", { ascending: false })
      .limit(limit);
    if (bErr) throw bErr;

    const rows = (bookings || []) as unknown as Record<string, unknown>[];
    const jobIds = rows.map((b) => b.job_id).filter(Boolean) as string[];
    const directCleanerIds = rows.map((b) => b.cleaner_id).filter(Boolean) as string[];

    // 2. Assignments for the linked jobs (the real assigned team + locked pay).
    const assignmentsByJob = new Map<string, Array<Record<string, unknown>>>();
    if (jobIds.length > 0) {
      const { data: assigns } = await admin
        .from("job_assignments")
        .select("job_id, cleaner_id, status, estimated_pay_cents, pay_percentage_snapshot, role")
        .in("job_id", jobIds)
        .in("status", ["Confirmed", "Accepted", "accepted", "In Progress", "Completed"]);
      for (const a of assigns || []) {
        const jid = String(a.job_id);
        const list = assignmentsByJob.get(jid) || [];
        list.push(a);
        assignmentsByJob.set(jid, list);
      }
    }

    // 3. Cleaner names + tiers.
    const allCleanerIds = Array.from(new Set([
      ...directCleanerIds,
      ...Array.from(assignmentsByJob.values()).flat().map((a) => String(a.cleaner_id)).filter(Boolean),
    ]));
    const cleanerMap = new Map<string, { name: string; pct: number }>();
    if (allCleanerIds.length > 0) {
      const { data: cleaners } = await admin
        .from("cleaners")
        .select("id, first_name, last_name, pay_percentage, pay_tier")
        .in("id", allCleanerIds);
      for (const c of cleaners || []) {
        const pct = Number(c.pay_percentage) || payPercentageForTier(normalizePayTier(c.pay_tier));
        cleanerMap.set(String(c.id), {
          name: `${c.first_name || ""} ${c.last_name || ""}`.trim() || "Cleaner",
          pct,
        });
      }
    }

    // 4. Assemble per-job pay, deriving each cleaner's locked share.
    const jobs = rows.map((b) => {
      const revenueCents = Number(b.final_charge_cents || b.total_estimate_cents || 0);
      const jid = b.job_id ? String(b.job_id) : null;
      const assigns = jid ? (assignmentsByJob.get(jid) || []) : [];

      let cleaners: Array<{ id: string; name: string; payCents: number }> = [];
      if (assigns.length > 0) {
        // Mixed tiers → highest %; split evenly. Prefer the locked snapshot.
        const pcts = assigns.map((a) =>
          Number(a.pay_percentage_snapshot) || cleanerMap.get(String(a.cleaner_id))?.pct || 35
        );
        const tierPct = maxPayPercentage(pcts);
        const pool = calculateCleanerPoolCents(revenueCents, tierPct);
        const per = Math.floor(pool / Math.max(1, assigns.length));
        cleaners = assigns.map((a) => ({
          id: String(a.cleaner_id),
          name: cleanerMap.get(String(a.cleaner_id))?.name || "Cleaner",
          payCents: Number(a.estimated_pay_cents) || per,
        }));
      } else if (b.cleaner_id) {
        const c = cleanerMap.get(String(b.cleaner_id));
        const pool = calculateCleanerPoolCents(revenueCents, c?.pct || 35);
        cleaners = [{
          id: String(b.cleaner_id),
          name: c?.name || "Cleaner",
          payCents: Number(b.cleaner_payout_cents) || pool,
        }];
      }

      const dateBasis = (b.completed_at as string) || (b.service_date as string) || (b.created_at as string);
      const payoutStatus = String(b.payout_status || "");
      const isCompleted = String(b.status) === "completed";
      return {
        bookingId: b.id,
        bookingNumber: b.booking_number ? `NOV-${String(b.booking_number).padStart(5, "0")}` : null,
        status: b.status,
        serviceType: b.service_type,
        serviceDate: b.service_date,
        dateCompleted: b.completed_at || null,
        payPeriod: monday(String(dateBasis)),
        customer: `${b.first_name || ""} ${b.last_name || ""}`.trim(),
        customerPaidCents: revenueCents,
        payoutStatus: payoutStatus || null,
        // payable = completed + not already paid/in-flight
        payable: isCompleted && !PAID_STATUSES.includes(payoutStatus),
        paid: payoutStatus === "completed",
        cleaners,
      };
    });

    return json({ success: true, jobs, window: { fromDate, toDate } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[payroll-operations]", msg);
    return json({ error: msg }, 500);
  }
});
