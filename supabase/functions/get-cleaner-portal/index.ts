// ─── get-cleaner-portal ─────────────────────────────────────────────────────
//
// Single source of truth for what a contractor sees in their portal /
// dashboard. Resolves a cleaner (by signed-in JWT, or by email / phone / id for
// the public lookup portal) and returns their bookings enriched with:
//
//   • the customer's NAME (portals used to show only the service type), plus
//     the customer-provided job details (home size, add-ons, pets, access
//     notes, etc.) and the office/internal details (pay breakdown, dispatch &
//     team notes, issue flags);
//   • the ACTUAL pay for THIS cleaner from public.manual_payouts — attributed
//     via the per-crew cleaner_breakdown first, then the row's cleaner_id — with
//     its paid / pending status, instead of the rough 35%-of-estimate figure the
//     portals used to display (the "huge disconnect" the operator reported);
//   • lifetime actual paid + still-pending totals so the header stats match the
//     money that actually moved.
//
// manual_payouts is RLS-locked to admin/VA, so neither the public portal (anon)
// nor the signed-in cleaner can read it directly — this service-role function
// is the only way to surface real pay to the contractor.
//
// Body: { cleanerId?: string, email?: string, phone?: string }
// (Authorization: Bearer <cleaner jwt> is used first when present.)

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { countsTowardQualityScore } from "../_shared/reclean.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CANCELLED_VISIBLE_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAY_PCT = 35;

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;

// This cleaner's cut of a payout row: prefer the per-crew breakdown entry,
// then fall back to the row-level cleaner_id / amount.
function attributeCents(payout: Row, cleanerId: string): number | null {
  const breakdown = Array.isArray(payout.cleaner_breakdown) ? payout.cleaner_breakdown : [];
  const mine = breakdown.find((e: Row) => String(e?.cleanerId || "") === cleanerId);
  if (mine && mine.amountCents != null) return Number(mine.amountCents) || 0;
  if (String(payout.cleaner_id || "") === cleanerId) return Number(payout.amount_cents) || 0;
  return null;
}

const BOOKING_SELECT =
  "id, booking_number, status, service_type, home_size_id, service_date, time_slot, arrival_window, " +
  "first_name, last_name, address, city, state, zip_code, " +
  "booking_type, facility_type, scope_level, square_footage, photo_zones, hard_deadline, " +
  "recommended_crew_size, service_window_hours, " +
  "bedrooms, bathrooms, sqft, dwelling_type, flooring_type, pets, add_ons, frequency, access_notes, " +
  "dispatch_notes, team_notes, issues_flag, issues_notes, " +
  "total_estimate_cents, cleaner_payout_cents, payout_status, job_id, check_in_time, " +
  "photo_upload_token, photo_view_token, before_photos, after_photos, cancelled_at, cleaner_id, " +
  "rescheduled_at, rescheduled_from_date, rescheduled_from_time_slot, " +
  "is_reclean, reclean_of_booking_id, reclean_scope, reclean_assessed_value_cents, reclean_qc_issue_id, booking_channel";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const wantCleanerId = String((body as Row)?.cleanerId || "");
    const email = String((body as Row)?.email || "").trim().toLowerCase();
    const phoneRaw = String((body as Row)?.phone || "");
    const phoneDigits = phoneRaw.replace(/\D/g, "").replace(/^1/, "");

    // ── Resolve the cleaner ──────────────────────────────────────────────
    let cleaner: Row | null = null;

    // 1) Signed-in cleaner (authenticated dashboard) — trust their JWT.
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (jwt) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: `Bearer ${jwt}` } } },
      );
      const { data: u } = await userClient.auth.getUser();
      const uid = u?.user?.id;
      if (uid) {
        const { data } = await admin
          .from("cleaners")
          .select("id, first_name, last_name, email, phone, pay_percentage")
          .eq("user_id", uid)
          .maybeSingle();
        if (data) cleaner = data;
      }
    }

    // 2) Public lookup by id / email / phone.
    if (!cleaner) {
      let q = admin.from("cleaners").select("id, first_name, last_name, email, phone, pay_percentage");
      if (wantCleanerId) q = q.eq("id", wantCleanerId);
      else if (email) q = q.ilike("email", email);
      else if (phoneDigits) q = q.ilike("phone", `%${phoneDigits.slice(-10)}%`);
      else return json({ ok: false, error: "Provide an email, phone, or cleanerId." }, 400);
      const { data } = await q.maybeSingle();
      if (data) cleaner = data;
    }

    if (!cleaner) return json({ ok: true, found: false, jobs: [], summary: { lifetimePaidCents: 0, pendingCents: 0, paidJobs: 0 } });

    const cleanerId = String(cleaner.id);
    const payPct = Number(cleaner.pay_percentage) > 0 ? Number(cleaner.pay_percentage) : DEFAULT_PAY_PCT;

    // ── This cleaner's bookings ──────────────────────────────────────────
    const { data: bookings } = await admin
      .from("bookings")
      // NB: customer phone/email are intentionally NOT selected — contractors
      // must never see customer contact info.
      .select(BOOKING_SELECT)
      .eq("cleaner_id", cleanerId)
      .order("service_date", { ascending: false })
      .limit(60);

    const bookingRows: Row[] = bookings || [];
    const primaryIds = new Set(bookingRows.map((b) => b.id));

    // Support-crew + re-clean assignments: bookings.cleaner_id is the lead,
    // so a second cleaner would otherwise miss upcoming jobs (and the
    // assign-time payout locked on their assignment row). Merge every live
    // assignment, not only re-cleans.
    try {
      const { data: liveAssigns } = await admin
        .from("job_assignments")
        .select("job_id, status, estimated_pay_cents, pay_percentage_snapshot, crew_size_snapshot, response_token")
        .eq("cleaner_id", cleanerId)
        .in("status", [
          "Offered", "Broadcast", "Confirmed", "Accepted", "accepted",
          "Assigned", "In Progress", "in_progress",
        ]);
      const assignedJobIds = [...new Set(
        (liveAssigns || []).map((a: Row) => a.job_id).filter(Boolean),
      )] as string[];
      if (assignedJobIds.length > 0) {
        const { data: assignedBookings } = await admin
          .from("bookings")
          .select(BOOKING_SELECT)
          .in("job_id", assignedJobIds)
          .order("service_date", { ascending: false })
          .limit(60);
        for (const rb of assignedBookings || []) {
          if (!primaryIds.has(String(rb.id))) {
            bookingRows.push(rb);
            primaryIds.add(String(rb.id));
          }
        }
      }
    } catch { /* assignment merge is additive */ }

    // ── Tips: 100% pass-through gifts, shown separately from job pay (they
    //    never touch scores, tiers, or the pay math). The full list feeds
    //    the portal's tips preview panel. ──
    const tipByBooking = new Map<string, number>();
    let lifetimeTipsCents = 0;
    const tipRows: Row[] = [];
    try {
      const { data: tips } = await admin
        .from("cleaner_tips")
        .select("booking_id, amount_cents, allocation, crew_size, total_tip_cents, created_at")
        .eq("cleaner_id", cleanerId)
        .order("created_at", { ascending: false })
        .limit(50);
      for (const t of tips || []) {
        lifetimeTipsCents += Number(t.amount_cents) || 0;
        if (t.booking_id) tipByBooking.set(String(t.booking_id), (tipByBooking.get(String(t.booking_id)) || 0) + (Number(t.amount_cents) || 0));
        tipRows.push(t);
      }
    } catch { /* table may not exist yet */ }

    // ── Per-job QC token + crew-pay snapshots for portal transparency ──
    const qcTokenByJob = new Map<string, string>();
    const paySnapByJob = new Map<string, {
      estimatedPayCents: number | null;
      ratePercent: number | null;
      crewSize: number | null;
      payTier: string | null;
    }>();
    const crewByJob = new Map<string, Array<{
      id: string;
      name: string;
      role: string;
      isYou: boolean;
    }>>();
    const jobIds = bookingRows.map((b) => b.job_id).filter(Boolean) as string[];
    if (jobIds.length > 0) {
      const { data: assigns } = await admin
        .from("job_assignments")
        .select("job_id, response_token, status, estimated_pay_cents, pay_percentage_snapshot, crew_size_snapshot")
        .eq("cleaner_id", cleanerId)
        .in("job_id", jobIds);
      for (const a of assigns || []) {
        const jid = String(a.job_id);
        if (a.response_token && ["confirmed", "accepted", "assigned", "in progress", "completed"].includes(String(a.status || "").toLowerCase())) {
          qcTokenByJob.set(jid, String(a.response_token));
        }
        paySnapByJob.set(jid, {
          estimatedPayCents: a.estimated_pay_cents != null ? Number(a.estimated_pay_cents) : null,
          ratePercent: a.pay_percentage_snapshot != null ? Number(a.pay_percentage_snapshot) : null,
          crewSize: a.crew_size_snapshot != null ? Number(a.crew_size_snapshot) : null,
          payTier: null,
        });
      }

      // Who else is on this job. A six-person commercial crew that doesn't
      // know it is a six-person crew will clean the same aisle twice and miss
      // the dock — so each member sees the roster and who leads.
      const { data: crewRows } = await admin
        .from("job_assignments")
        .select("job_id, role, status, cleaners(id, first_name, last_name)")
        .in("job_id", jobIds)
        .or("status.ilike.confirmed,status.ilike.accepted,status.ilike.in progress");
      for (const row of crewRows || []) {
        const jid = String(row.job_id);
        const c = Array.isArray(row.cleaners) ? row.cleaners[0] : row.cleaners;
        if (!c?.id) continue;
        const list = crewByJob.get(jid) || [];
        list.push({
          id: String(c.id),
          name: `${c.first_name || ""} ${String(c.last_name || "").charAt(0)}`.trim() || "Crew member",
          role: String(row.role || "Support"),
          isYou: String(c.id) === cleanerId,
        });
        crewByJob.set(jid, list);
      }
    }

    // ── Lifetime actual totals from the two pay ledgers (custom pay +
    //    extra pay), including crew splits via cleaner_breakdown ──
    let lifetimePaidCents = 0;
    let pendingCents = 0;
    let paidJobs = 0;
    const attributedBookingIds = new Set<string>();
    const seenPayoutIds = new Set<string>();
    const tallyPayout = (p: Row) => {
      const id = String(p.id ?? `${p.booking_id}-${p.cleaner_id}`);
      if (seenPayoutIds.has(id)) return;
      seenPayoutIds.add(id);
      const cents = attributeCents(p, cleanerId);
      if (cents == null) return;
      if (p.booking_id) attributedBookingIds.add(String(p.booking_id));
      if (p.status === "paid") { lifetimePaidCents += cents; paidJobs += 1; }
      else if (p.status === "pending") { pendingCents += cents; }
    };
    const { data: byCid } = await admin
      .from("manual_payouts")
      .select("id, booking_id, cleaner_id, amount_cents, status, cleaner_breakdown")
      .eq("cleaner_id", cleanerId)
      .neq("status", "cancelled");
    for (const p of byCid || []) tallyPayout(p);
    // NB: supabase-js .contains() serializes a JS array as a Postgres ARRAY
    // literal ({...}), which never matches a jsonb column. Passing a JSON
    // STRING yields the correct `@>` containment filter.
    const { data: byBreakdown } = await admin
      .from("manual_payouts")
      .select("id, booking_id, cleaner_id, amount_cents, status, cleaner_breakdown")
      .contains("cleaner_breakdown", JSON.stringify([{ cleanerId }]))
      .neq("status", "cancelled");
    for (const p of byBreakdown || []) tallyPayout(p);

    // ── Per-job EXTRA pay (supplies, mileage, surge, OT, job-value increase),
    //    paid immediately on top of the base payout. Folded into actual pay so
    //    the portal reflects the FULL amount the cleaner was paid per job. ──
    const extrasByBooking = new Map<string, { total: number; paid: number; pending: number }>();
    try {
      const { data: extras } = await admin
        .from("job_extra_pay")
        .select("booking_id, cleaner_id, total_cents, status")
        .eq("cleaner_id", cleanerId)
        .neq("status", "failed");
      for (const e of extras || []) {
        const cents = Number(e.total_cents) || 0;
        if (e.status === "paid") lifetimePaidCents += cents;
        else pendingCents += cents;
        if (e.booking_id) {
          attributedBookingIds.add(String(e.booking_id));
          const g = extrasByBooking.get(e.booking_id) || { total: 0, paid: 0, pending: 0 };
          g.total += cents;
          if (e.status === "paid") g.paid += cents; else g.pending += cents;
          extrasByBooking.set(e.booking_id, g);
        }
      }
    } catch (_) { /* job_extra_pay may not exist in some envs */ }

    // ── CREW jobs: bookings this cleaner was PAID on (via the custom-pay
    //    crew breakdown or extra pay) but where bookings.cleaner_id points at
    //    the crew lead. Without this, a second cleaner's job list was missing
    //    those jobs entirely while the lifetime totals included them — the
    //    "pay disconnect". Fetch and merge them so every paid job is visible. ──
    const crewIds = [...attributedBookingIds].filter((id) => !primaryIds.has(id));
    if (crewIds.length > 0) {
      const { data: crewBookings } = await admin
        .from("bookings")
        .select(BOOKING_SELECT)
        .in("id", crewIds);
      for (const cb of crewBookings || []) bookingRows.push(cb);
      bookingRows.sort((a, b) => String(b.service_date || "").localeCompare(String(a.service_date || "")));
    }

    // Drop OPEN jobs this cleaner is no longer assigned to (Withdrawn /
    // Declined / etc.). Completed / pending_review stay so pay history and
    // "jobs you finished" remain accurate. Primary lead rows (cleaner_id
    // match) are always kept.
    const openStatuses = new Set(["confirmed", "assigned", "in_progress", "in progress"]);
    const activeAssignStatuses = new Set([
      "confirmed", "accepted", "assigned", "in progress", "in_progress", "completed",
    ]);
    const recleanAssignStatuses = new Set([
      ...activeAssignStatuses, "offered", "broadcast",
    ]);
    const openJobIds = bookingRows
      .filter((b) => openStatuses.has(String(b.status || "").toLowerCase()) && b.job_id)
      .map((b) => String(b.job_id));
    const activeJobIds = new Set<string>();
    const recleanActiveJobIds = new Set<string>();
    if (openJobIds.length > 0) {
      const { data: liveAssigns } = await admin
        .from("job_assignments")
        .select("job_id, status")
        .eq("cleaner_id", cleanerId)
        .in("job_id", openJobIds);
      for (const a of liveAssigns || []) {
        const st = String(a.status || "").toLowerCase();
        if (activeAssignStatuses.has(st)) {
          activeJobIds.add(String(a.job_id));
        }
        if (recleanAssignStatuses.has(st)) {
          recleanActiveJobIds.add(String(a.job_id));
        }
      }
    }
    const filteredBookingRows = bookingRows.filter((b) => {
      if (!openStatuses.has(String(b.status || "").toLowerCase())) return true;
      if (String(b.cleaner_id || "") === cleanerId) return true;
      if (!b.job_id) return true; // no dispatch row — keep lead-less edge cases
      if (b.is_reclean) return recleanActiveJobIds.has(String(b.job_id));
      return activeJobIds.has(String(b.job_id));
    });

    // ── Active payout row per booking (full fields for display) ──
    const bookingIds = filteredBookingRows.map((b) => b.id);
    const payoutByBooking = new Map<string, Row>();
    if (bookingIds.length > 0) {
      const { data: payouts } = await admin
        .from("manual_payouts")
        .select("booking_id, cleaner_id, amount_cents, status, paid_at, pct_paid, revenue_cents, cleaner_breakdown, note")
        .in("booking_id", bookingIds)
        .neq("status", "cancelled");
      for (const p of payouts || []) {
        if (p.booking_id && !payoutByBooking.has(p.booking_id)) payoutByBooking.set(p.booking_id, p);
      }
    }

    // ── Shape each job ───────────────────────────────────────────────────
    const now = Date.now();
    const jobs = filteredBookingRows
      .filter((b) => {
        if (b.status !== "cancelled") return true;
        const ts = b.cancelled_at ? new Date(b.cancelled_at).getTime() : 0;
        return ts > 0 && now - ts < CANCELLED_VISIBLE_MS;
      })
      .map((b) => {
        const cancelled = b.status === "cancelled";
        const payout = payoutByBooking.get(b.id) || null;
        const baseCents = payout ? attributeCents(payout, cleanerId) : null;
        const snap = b.job_id ? paySnapByJob.get(String(b.job_id)) : null;
        const reclean = b.is_reclean === true;
        const recleanAssessed = reclean ? Number(b.reclean_assessed_value_cents) || 0 : 0;
        // Prefer the assignment's crew-size share over the booking lead's
        // cleaner_payout_cents (which is only the lead's cut) and over the
        // legacy flat payPct × estimate (which ignored crew brackets).
        // Re-cleans bill the customer $0 — pay is assessed_value × tier.
        const estimateCents = snap?.estimatedPayCents != null
          ? snap.estimatedPayCents
          : reclean && recleanAssessed > 0
            ? Math.floor(recleanAssessed * payPct / 100)
          : b.cleaner_payout_cents != null && String(b.cleaner_id || "") === cleanerId
            ? Number(b.cleaner_payout_cents)
            : b.total_estimate_cents != null
              ? Math.floor(Number(b.total_estimate_cents) * payPct / 100)
              : null;
        const extra = extrasByBooking.get(b.id) || null;
        const extrasCents = extra ? extra.total : 0;
        // Actual pay = base payout (when recorded) + any extras — all real money.
        const actualCents = baseCents != null || extrasCents > 0 ? (baseCents ?? 0) + extrasCents : null;
        const baseForDisplay = baseCents != null ? baseCents : estimateCents;
        const displayCents = baseForDisplay != null ? baseForDisplay + extrasCents : (extrasCents > 0 ? extrasCents : null);
        // Split the actual money into paid vs pending portions (a job can have
        // a PAID base payout and a PENDING extra at the same time — one status
        // for the whole chip misstated both sides).
        const basePaid = payout && payout.status === "paid" ? (baseCents ?? 0) : 0;
        const basePending = payout && payout.status === "pending" ? (baseCents ?? 0) : 0;
        const paidCents = basePaid + (extra ? extra.paid : 0);
        const pendingPartCents = basePending + (extra ? extra.pending : 0);
        const payStatus: string | null =
          paidCents > 0 && pendingPartCents > 0
            ? "partial"
            : paidCents > 0
              ? "paid"
              : pendingPartCents > 0
                ? "pending"
                : null;

        // Cancelled jobs expose NO client PII (mirrors the old client-side strip).
        const customerName = cancelled
          ? ""
          : `${b.first_name || ""} ${b.last_name || ""}`.trim();

        // Access details are TIME-SCOPED: codes/entry instructions unlock 48h
        // before the visit and stay through the day after — never indefinitely.
        // (Partner-hub bookings carry codes in access_notes; residential
        // bookings keep prior behavior unless a code marker is present.)
        let accessNotes: string | null = b.access_notes || null;
        if (accessNotes && b.service_date && /ACCESS:|code:/i.test(accessNotes)) {
          const svc = Date.parse(`${String(b.service_date).slice(0, 10)}T00:00:00`);
          const unlockAt = svc - 48 * 3600_000;
          const relockAt = svc + 48 * 3600_000;
          if (Number.isFinite(svc) && (Date.now() < unlockAt || Date.now() > relockAt)) {
            accessNotes = "🔒 Access details unlock 48 hours before the visit.";
          }
        }

        return {
          id: b.id,
          bookingId: b.id,
          jobId: b.job_id || null,
          bookingNumber: b.booking_number ?? null,
          status: b.status,
          serviceDate: b.service_date,
          timeSlot: b.time_slot || b.arrival_window || null,
          serviceType: b.service_type || "Cleaning",
          homeSizeId: b.home_size_id || null,
          isReclean: reclean,
          recleanScope: reclean ? (b.reclean_scope || null) : null,
          recleanAssessedValueCents: reclean && recleanAssessed > 0 ? recleanAssessed : null,
          customerName,
          address: cancelled ? "" : (b.address || ""),
          city: cancelled ? "" : (b.city || ""),
          state: cancelled ? "" : (b.state || ""),
          zip: cancelled ? "" : (b.zip_code || ""),
          checkInTime: b.check_in_time || null,
          cancelledAt: b.cancelled_at || null,
          // Reschedule signal: the portal used to just swap the date with no
          // cue — a cleaner who memorized the old day had no idea it moved.
          rescheduledAt: b.rescheduled_at || null,
          rescheduledFromDate: b.rescheduled_from_date || null,
          rescheduledFromTimeSlot: b.rescheduled_from_time_slot || null,
          qcToken: cancelled ? null : (b.job_id ? qcTokenByJob.get(String(b.job_id)) || null : null),
          tipCents: tipByBooking.get(String(b.id)) || 0,
          photoUploadToken: b.photo_upload_token || null,
          photoViewToken: b.photo_view_token || null,
          beforePhotos: b.before_photos || null,
          afterPhotos: b.after_photos || null,
          // Everyone on the job sees the crew, not just the lead.
          crew: cancelled ? [] : (b.job_id ? crewByJob.get(String(b.job_id)) || [] : []),
          // Commercial vitals: what kind of building, how deep the clean, how
          // long the crew has, and how the site must be documented. All of it
          // comes off the booking — the crew never re-enters or guesses it.
          commercial: cancelled || !["commercial", "office"].includes(String(b.booking_type || ""))
            ? null
            : {
              facilityType: b.facility_type || null,
              scopeLevel: b.scope_level || null,
              squareFootage: b.square_footage ?? null,
              hardDeadline: b.hard_deadline || null,
              serviceWindowHours: b.service_window_hours ?? null,
              photoZones: Array.isArray(b.photo_zones) ? b.photo_zones.map(String) : [],
              recommendedCrewSize: b.recommended_crew_size ?? null,
            },
          pay: {
            actualCents,
            baseCents,
            extrasCents,
            paidCents,
            pendingCents: pendingPartCents,
            estimateCents,
            displayCents,
            isActual: actualCents != null,
            status: payStatus, // 'paid' | 'partial' | 'pending' | null
            pctPaid: payout && payout.pct_paid != null ? Number(payout.pct_paid) : null,
            // Crew-size rate transparency — reconstructable from history.
            crewSize: snap?.crewSize ?? null,
            ratePercent: snap?.ratePercent ?? null,
          },
          customerDetails: cancelled ? null : {
            bedrooms: b.bedrooms ?? null,
            bathrooms: b.bathrooms ?? null,
            sqft: b.sqft ?? null,
            dwellingType: b.dwelling_type || null,
            flooringType: b.flooring_type || null,
            pets: b.pets || null,
            addOns: Array.isArray(b.add_ons) ? b.add_ons : [],
            frequency: b.frequency || null,
            accessNotes,
          },
          internalDetails: cancelled ? null : {
            jobValueCents: reclean && recleanAssessed > 0
              ? recleanAssessed
              : b.total_estimate_cents ?? null,
            estimateCents,
            baseCents,
            extrasCents,
            payoutStatus: payStatus || (b.payout_status || null),
            payoutNote: payout ? (payout.note || null) : null,
            dispatchNotes: b.dispatch_notes || null,
            teamNotes: b.team_notes || null,
            issuesFlag: !!b.issues_flag,
            issuesNotes: b.issues_notes || null,
            crewSize: snap?.crewSize ?? null,
            ratePercent: snap?.ratePercent ?? null,
          },
        };
      });

    // ── Pending job OFFERS ────────────────────────────────────────────────
    // The lookup portal never showed offers, so a missed SMS meant an
    // invisible expiry (which then dents the acceptance rate). Surface open
    // Offered/Broadcast assignments with the token for the accept page.
    // deno-lint-ignore no-explicit-any
    const offers: any[] = [];
    try {
      const { data: openAssigns } = await admin
        .from("job_assignments")
        .select("id, job_id, status, response_token, expires_at, estimated_pay_cents, role, assigned_at, reliability_neutral")
        .eq("cleaner_id", cleanerId)
        .in("status", ["Offered", "Broadcast"])
        .order("assigned_at", { ascending: false })
        .limit(10);
      const open = (openAssigns || []).filter((a: Row) =>
        a.response_token && (!a.expires_at || new Date(a.expires_at).getTime() > Date.now()));
      if (open.length > 0) {
        const offerJobIds = open.map((a: Row) => a.job_id).filter(Boolean);
        const { data: offerBookings } = await admin
          .from("bookings")
          .select("job_id, service_type, service_date, time_slot, arrival_window, city, state, total_estimate_cents, reclean_assessed_value_cents, is_reclean, reclean_scope, home_size_id, status")
          .in("job_id", offerJobIds);
        const byJob = new Map<string, Row>();
        for (const ob of offerBookings || []) {
          const st = String(ob.status || "").toLowerCase();
          // Never surface offers for jobs already finished / cancelled.
          if (["completed", "cancelled", "canceled", "pending_review"].includes(st)) continue;
          byJob.set(String(ob.job_id), ob);
        }
        for (const a of open) {
          const ob = byJob.get(String(a.job_id));
          if (!ob) continue;
          const isReclean = ob.is_reclean === true;
          const payBasis = isReclean
            ? Number(ob.reclean_assessed_value_cents) || 0
            : Number(ob.total_estimate_cents) || 0;
          const estPay = a.estimated_pay_cents != null
            ? Number(a.estimated_pay_cents)
            : payBasis > 0
              ? Math.floor(payBasis * payPct / 100)
              : null;
          offers.push({
            assignmentId: a.id,
            token: a.response_token,
            role: a.role || null,
            status: a.status,
            expiresAt: a.expires_at || null,
            serviceType: ob.service_type || "Cleaning",
            serviceDate: ob.service_date || null,
            timeSlot: ob.time_slot || ob.arrival_window || null,
            city: ob.city || null,
            state: ob.state || null,
            estimatedPayCents: estPay,
            isReclean,
            recleanScope: isReclean ? (ob.reclean_scope || null) : null,
            reliabilityNeutral: a.reliability_neutral === true || isReclean,
          });
        }
      }
    } catch { /* offers are additive — never break the portal */ }

    // ── Live COVERAGE offers ──────────────────────────────────────────────
    // Someone dropped a job and this cleaner is near the top of the ranked
    // list. It shows up here as well as by SMS because a coverage window is
    // short and a text can be missed — and an offer nobody saw is the same as
    // no bench at all. Never a penalty to pass: only accepting and then not
    // turning up counts against a cleaner.
    // deno-lint-ignore no-explicit-any
    const coverageOffers: any[] = [];
    try {
      const { data: openCoverage } = await admin
        .from("coverage_offers")
        .select("id, booking_id, status, response_token, expires_at, was_designated_backup, offered_at")
        .eq("cleaner_id", cleanerId)
        .eq("status", "offered")
        .gt("expires_at", new Date().toISOString())
        .order("offered_at", { ascending: false })
        .limit(5);
      const coverageBookingIds = (openCoverage || []).map((o: Row) => o.booking_id).filter(Boolean);
      if (coverageBookingIds.length > 0) {
        const { data: covBookings } = await admin
          .from("bookings")
          .select("id, service_type, service_date, time_slot, arrival_window, city, state, total_estimate_cents, final_charge_cents, status")
          .in("id", coverageBookingIds);
        const byBooking = new Map<string, Row>();
        for (const cb of covBookings || []) {
          const st = String(cb.status || "").toLowerCase();
          if (["completed", "cancelled", "canceled", "pending_review"].includes(st)) continue;
          byBooking.set(String(cb.id), cb);
        }
        for (const o of openCoverage || []) {
          const cb = byBooking.get(String(o.booking_id));
          if (!cb) continue;
          const revenue = Number(cb.final_charge_cents ?? cb.total_estimate_cents ?? 0);
          coverageOffers.push({
            offerId: o.id,
            token: o.response_token,
            expiresAt: o.expires_at || null,
            wasDesignatedBackup: !!o.was_designated_backup,
            serviceType: cb.service_type || "Cleaning",
            serviceDate: cb.service_date || null,
            timeSlot: cb.time_slot || cb.arrival_window || null,
            city: cb.city || null,
            state: cb.state || null,
            // Coverage is ordinary work at their ordinary tier. Being on call
            // is not paid and being activated changes nothing about the rate.
            estimatedPayCents: revenue > 0 ? Math.floor(revenue * payPct / 100) : null,
          });
        }
      }
    } catch { /* coverage offers are additive — never break the portal */ }

    // Transparency: a cleaner sees their OWN scores (never others'), plus a
    // summary of the QC cases feeding their Rating — so a score change is
    // never unexplainable. Counts only; no customer identities or details.
    let scores: { novara: number | null; quality: number | null; overall: number | null } | null = null;
    let qcSummary: { last90Days: number; bySeverity: Record<string, number> } | null = null;
    try {
      const { data: sc } = await admin
        .from("cleaners")
        .select("novara_score, quality_score, overall_score")
        .eq("id", cleanerId)
        .maybeSingle();
      if (sc) {
        scores = {
          novara: sc.novara_score != null ? Number(sc.novara_score) : null,
          quality: sc.quality_score != null ? Number(sc.quality_score) : null,
          overall: sc.overall_score != null ? Number(sc.overall_score) : null,
        };
      }
      const { data: qcRows } = await admin
        .from("qc_issues")
        .select("severity, issue_type, reclean_status, reclean_classification")
        .eq("cleaner_id", cleanerId)
        .gte("created_at", new Date(Date.now() - 90 * 86400_000).toISOString())
        .limit(200);
      const counted = (qcRows || []).filter((r: {
        issue_type?: string; reclean_status?: string; reclean_classification?: string;
      }) => countsTowardQualityScore(r));
      if (counted.length > 0) {
        const bySeverity: Record<string, number> = {};
        for (const r of counted) {
          const s = String(r.severity || "medium");
          bySeverity[s] = (bySeverity[s] || 0) + 1;
        }
        qcSummary = { last90Days: counted.length, bySeverity };
      }
    } catch { /* columns may not exist yet */ }

    // Tips preview: each tip with its job ref — the cleaner sees exactly
    // what came in, when, and how a crew tip was split.
    const refByBooking = new Map<string, string>();
    for (const b of bookingRows) {
      if (b.booking_number != null) refByBooking.set(String(b.id), `NVC-${String(b.booking_number).padStart(4, "0")}`);
    }
    const tips = tipRows.map((t) => ({
      bookingId: t.booking_id || null,
      bookingRef: t.booking_id ? refByBooking.get(String(t.booking_id)) || null : null,
      amountCents: Number(t.amount_cents) || 0,
      totalTipCents: Number(t.total_tip_cents) || 0,
      crewSize: Number(t.crew_size) || 1,
      allocation: t.allocation || "split",
      receivedAt: t.created_at || null,
    }));

    return json({
      ok: true,
      found: true,
      cleaner: {
        id: cleanerId,
        firstName: cleaner.first_name || "",
        lastName: cleaner.last_name || "",
        name: `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim(),
        payPercentage: payPct,
        scores,
        qcSummary,
      },
      summary: { lifetimePaidCents, pendingCents, paidJobs, lifetimeTipsCents },
      tips,
      offers,
      coverageOffers,
      jobs,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[get-cleaner-portal]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
