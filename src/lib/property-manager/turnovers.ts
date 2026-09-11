// ─── Booking a turnover ────────────────────────────────────────────────────
//
// Event-driven, not calendar-driven. A tenant moves out, the property manager
// picks the unit, picks Move-Out / Move-In / Standard, states the date the
// unit has to be ready by, and the booking confirms. There is no quote step
// and no walkthrough, because the unit's rate was set once at registration
// and has been sitting on the unit ever since.
//
// The needed-by date is the whole scheduling contract. It is usually a lease
// date — "must be complete before the 1st" — so it goes onto the booking as
// `hard_deadline_at`, the same immovable-finish field an STR guest check-in
// uses. Dispatch, coverage sourcing, and the at-risk surfaces already read
// that field; nothing new had to learn about property managers.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  PM_SERVICE_LABELS,
  PM_SERVICE_TYPES,
  formatRate,
  payBasisCents,
  unitDisplayName,
  type PmServiceType,
} from "./pricing";
import { UNIT_COLS, clip, listRateFor, standingRateFor } from "./registry";

type Admin = ReturnType<typeof getAdminSupabase>;
type Row = Record<string, unknown>;

export const TURNOVER_COLS = `
  id, pm_account_id, unit_id, service_type, needed_by_date, needed_by_time,
  scheduled_date, window_start, window_end, price_cents, list_price_cents,
  discount_percent, final_price_cents, scope_adjustment_cents, pay_basis_cents,
  status, booking_id, notes, cancelled_at, cancel_reason, completed_at,
  invoice_id, invoiced_at, booked_by_name, booked_via, created_at
`;

const DEFAULT_DEADLINE_TIME = "17:00";

export function isPmServiceType(value: unknown): value is PmServiceType {
  return PM_SERVICE_TYPES.includes(String(value) as PmServiceType);
}

function isoDate(value: unknown): string | null {
  const s = String(value || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function isoTime(value: unknown): string | null {
  const s = String(value || "").trim();
  return /^\d{2}:\d{2}(:\d{2})?$/.test(s) ? s.slice(0, 5) : null;
}

function todayIso(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * The moment the unit has to be finished by, as a timestamp dispatch can
 * compare against. A lease deadline with no stated time means the end of that
 * business day — a unit "ready before the 1st" is not ready at 11pm on the
 * 31st in any way that helps the incoming tenant.
 */
export function deadlineAt(
  neededByDate: string,
  neededByTime: string | null,
  defaultTime = DEFAULT_DEADLINE_TIME,
): string {
  const time = isoTime(neededByTime) || defaultTime;
  // America/New_York is the business calendar everywhere else in this system.
  const [y, m, d] = neededByDate.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const offsetMinutes = newYorkOffsetMinutes(new Date(utcGuess));
  return new Date(utcGuess + offsetMinutes * 60_000).toISOString();
}

function newYorkOffsetMinutes(at: Date): number {
  // Difference between UTC and America/New_York for this instant, in minutes
  // to ADD to a naive local time to reach UTC (240 in EDT, 300 in EST).
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    timeZoneName: "shortOffset",
  }).formatToParts(at);
  const raw = formatted.find((p) => p.type === "timeZoneName")?.value || "GMT-5";
  const match = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  if (!match) return 300;
  const sign = match[1] === "-" ? 1 : -1;
  return sign * (Number(match[2]) * 60 + Number(match[3] || 0));
}

export function deadlineLabel(neededByDate: string, neededByTime: string | null): string {
  const day = new Date(`${neededByDate}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = isoTime(neededByTime);
  return time ? `${day} by ${time}` : `${day} (end of day)`;
}

// ─── Portal shape ──────────────────────────────────────────────────────────

export function publicTurnover(turnover: Row, unit?: Row | null) {
  const priceCents = Number(turnover.price_cents || 0);
  const finalCents = turnover.final_price_cents == null ? null : Number(turnover.final_price_cents);
  return {
    id: String(turnover.id),
    unitId: String(turnover.unit_id),
    unitLabel: unit
      ? unitDisplayName(unit as { unit_label?: string | null; address?: string | null })
      : null,
    serviceType: String(turnover.service_type) as PmServiceType,
    serviceLabel: PM_SERVICE_LABELS[String(turnover.service_type) as PmServiceType] || String(turnover.service_type),
    neededByDate: String(turnover.needed_by_date),
    neededByTime: (turnover.needed_by_time as string) || null,
    deadlineLabel: deadlineLabel(String(turnover.needed_by_date), (turnover.needed_by_time as string) || null),
    scheduledDate: (turnover.scheduled_date as string) || null,
    status: String(turnover.status),
    statusLabel: turnoverStatusLabel(String(turnover.status)),
    priceCents,
    finalPriceCents: finalCents,
    scopeAdjustmentCents: Number(turnover.scope_adjustment_cents || 0),
    chargedCents: finalCents ?? priceCents,
    notes: (turnover.notes as string) || null,
    completedAt: (turnover.completed_at as string) || null,
    invoiceId: (turnover.invoice_id as string) || null,
    createdAt: (turnover.created_at as string) || null,
  };
}

export function turnoverStatusLabel(status: string): string {
  switch (status) {
    case "scheduled":
      return "Booked";
    case "assigned":
      return "Scheduled";
    case "confirmed":
      return "Confirmed";
    case "in_progress":
      return "In progress";
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    default:
      return status.replace(/_/g, " ");
  }
}

// ─── Booking ───────────────────────────────────────────────────────────────

export interface BookTurnoverInput {
  pmAccountId: string;
  unitId: string;
  serviceType: PmServiceType;
  neededByDate: string;
  neededByTime?: string | null;
  notes?: string | null;
  bookedByName?: string | null;
  bookedVia: "portal" | "admin";
}

export interface BookTurnoverResult {
  ok: boolean;
  status: number;
  message: string;
  turnoverId?: string;
  bookingId?: string | null;
  priceCents?: number;
  turnover?: ReturnType<typeof publicTurnover>;
}

/**
 * Book one turnover at the unit's stored standing rate.
 *
 * Nothing here consults a pricing engine. If the unit has a standing rate it
 * is bookable at that rate; if it does not, it is still with our team and the
 * property manager is told so rather than being dropped into a quote flow.
 */
export async function bookTurnover(
  supabase: Admin,
  input: BookTurnoverInput,
): Promise<BookTurnoverResult> {
  if (!isPmServiceType(input.serviceType)) {
    return { ok: false, status: 400, message: "Pick Move-Out, Move-In, or Standard." };
  }
  const neededBy = isoDate(input.neededByDate);
  if (!neededBy) {
    return { ok: false, status: 400, message: "Set the date this unit needs to be ready by." };
  }
  if (neededBy < todayIso()) {
    return { ok: false, status: 400, message: "The needed-by date is in the past." };
  }

  const { data: unit } = await supabase
    .from("property_manager_units")
    .select(UNIT_COLS)
    .eq("id", input.unitId)
    .maybeSingle();
  if (!unit || String((unit as Row).pm_account_id) !== input.pmAccountId) {
    return { ok: false, status: 404, message: "That unit isn't in your portfolio." };
  }
  const unitRow = unit as Row;
  if (String(unitRow.status) !== "active") {
    return {
      ok: false,
      status: 409,
      message: "This unit is still with our team for pricing. We'll let you know as soon as it's bookable.",
    };
  }

  const priceCents = standingRateFor(unitRow, input.serviceType);
  const listCents = listRateFor(unitRow, input.serviceType) ?? priceCents;
  if (!priceCents || !listCents) {
    return {
      ok: false,
      status: 409,
      message: `This unit has no standing ${PM_SERVICE_LABELS[input.serviceType]} rate yet. Our team sets it — you'll never be asked to.`,
    };
  }

  const { data: account } = await supabase
    .from("property_manager_accounts")
    .select("id, company_name, email, billing_method, volume_discount_percent")
    .eq("id", input.pmAccountId)
    .maybeSingle();
  if (!account) return { ok: false, status: 404, message: "Property manager account not found." };

  const { data: inserted, error } = await supabase
    .from("property_manager_turnovers")
    .insert({
      pm_account_id: input.pmAccountId,
      unit_id: input.unitId,
      service_type: input.serviceType,
      needed_by_date: neededBy,
      needed_by_time: isoTime(input.neededByTime),
      price_cents: priceCents,
      list_price_cents: listCents,
      discount_percent: Number(unitRow.discount_percent_applied || 0),
      status: "scheduled",
      notes: clip(input.notes, 2000) || null,
      booked_by_name: clip(input.bookedByName, 120) || null,
      booked_via: input.bookedVia,
    })
    .select(TURNOVER_COLS)
    .single();
  if (error || !inserted) {
    return { ok: false, status: 400, message: error?.message || "Could not book that turnover." };
  }
  const turnover = inserted as Row;

  const dispatch = await createTurnoverBooking(supabase, {
    turnover,
    unit: unitRow,
    account: account as Row,
  });

  await supabase.from("events").insert({
    event_type: "property_manager.turnover.booked",
    source: "property-manager",
    summary:
      `${PM_SERVICE_LABELS[input.serviceType]} booked on "${unitDisplayName(unitRow as { unit_label?: string | null; address?: string | null })}" ` +
      `at the standing rate ${formatRate(priceCents)} — needed by ${neededBy}.`,
    data: {
      pm_account_id: input.pmAccountId,
      unit_id: input.unitId,
      turnover_id: turnover.id,
      booking_id: dispatch.bookingId,
      service_type: input.serviceType,
      needed_by_date: neededBy,
      price_cents: priceCents,
      list_price_cents: listCents,
      pay_basis_cents: payBasisCents({ listPriceCents: listCents }),
      quoted: false,
    },
  });

  return {
    ok: true,
    status: 200,
    turnoverId: String(turnover.id),
    bookingId: dispatch.bookingId,
    priceCents,
    turnover: publicTurnover(turnover, unitRow),
    message: `Confirmed at your standing rate of ${formatRate(priceCents)}. We'll have it done before ${deadlineLabel(neededBy, isoTime(input.neededByTime))}.`,
  };
}

/**
 * Create the dispatch/QC job for a turnover.
 *
 * The booking is the row every downstream system already understands:
 * assignment, the cleaner's checklist, before/after photos, the QC
 * documentation record, and the scope-adjustment flow. Access detail stored
 * once on the unit is composed onto it here, behind the same `ACCESS:` prefix
 * that keeps codes time-scoped in the contractor portal.
 */
async function createTurnoverBooking(
  supabase: Admin,
  input: { turnover: Row; unit: Row; account: Row },
): Promise<{ bookingId: string | null; error?: string }> {
  const { turnover, unit, account } = input;
  const service = String(turnover.service_type) as PmServiceType;
  const neededBy = String(turnover.needed_by_date);
  const neededTime = (turnover.needed_by_time as string) || null;

  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "property_manager_settings")
    .maybeSingle();
  const defaultTime =
    isoTime((setting?.value as Row | null)?.default_deadline_time) || DEFAULT_DEADLINE_TIME;

  const priceCents = Number(turnover.price_cents || 0);
  const listCents = Number(turnover.list_price_cents || priceCents);
  const basisCents = payBasisCents({ listPriceCents: listCents });

  const payPct = await foundationPayPercent(supabase);
  // Pay is locked at booking off the FULL pre-discount value. The portfolio
  // discount is a margin decision between us and the property manager; it is
  // not a pay cut for the crew.
  const cleanerPayoutCents = Math.floor((basisCents * payPct) / 100);

  const label = unitDisplayName(unit as { unit_label?: string | null; address?: string | null });
  const deadlineText = deadlineLabel(neededBy, neededTime);
  const accessParts = [
    unit.access_method
      ? `ACCESS: ${clip(unit.access_method, 120)}${unit.access_code ? ` — code: ${clip(unit.access_code, 120)}` : ""}`
      : null,
    unit.access_notes ? clip(unit.access_notes, 2000) : null,
    unit.parking_notes ? `Parking: ${clip(unit.parking_notes, 1000)}` : null,
  ].filter(Boolean);
  const teamParts = [
    `⏰ LEASE DEADLINE (HARD): must be complete by ${deadlineText}.`,
    `SCOPE: ${PM_SERVICE_LABELS[service]} on a vacant rental unit.`,
    service === "move_out"
      ? "Tenant has vacated. Photograph anything left behind or damaged before you start — it protects the property manager and it is how a heavier-than-normal turnover gets approved."
      : null,
    service === "move_in"
      ? "New tenant takes possession after this. Finish move-in ready."
      : null,
    service === "standard"
      ? "Vacant unit refresh between showings."
      : null,
    turnover.notes ? `FROM THE PROPERTY MANAGER: ${clip(turnover.notes, 2000)}` : null,
    unit.special_notes ? `UNIT NOTES: ${clip(unit.special_notes, 2000)}` : null,
  ].filter(Boolean);

  const { data: booking, error } = await supabase
    .from("bookings")
    .insert({
      // Residential work priced by the residential engine — the client type
      // this resolves to is 'residential', which is what it is.
      booking_type: "residential",
      business_name: clip(account.company_name, 120) || null,
      first_name: clip(account.company_name, 80) || "Property manager",
      last_name: "",
      email: clip(account.email, 200) || "",
      // Client contact stays off the job: contractors see logistics.
      phone: "",
      address: clip(unit.address, 300),
      city: clip(unit.city, 120) || "",
      state: clip(unit.state, 40) || "",
      zip_code: clip(unit.zip_code, 10) || "",
      home_size_id: clip(unit.home_size_id, 40) || "",
      service_type: service === "standard" ? "standard" : "moveInOut",
      add_ons: [],
      // Until dispatch schedules it earlier, the job sits on the deadline day
      // — the last date at which it can still be on time.
      service_date: (turnover.scheduled_date as string) || neededBy,
      time_slot: `Before ${deadlineText}`,
      arrival_window: null,
      hard_deadline: deadlineText,
      hard_deadline_at: deadlineAt(neededBy, neededTime, defaultTime),
      access_method: clip(unit.access_method, 120) || null,
      access_notes: accessParts.join("\n") || null,
      team_notes: teamParts.join("\n"),
      dispatch_notes: `⏰ LEASE DEADLINE (HARD): ${deadlineText} — ${label}`,
      condition_level: "normal",
      partner_details: {
        booking_type: "property_manager_turnover",
        pm_account_id: String(turnover.pm_account_id),
        pm_unit_id: String(turnover.unit_id),
        pm_turnover_id: String(turnover.id),
        pm_service_type: service,
        needed_by_date: neededBy,
        needed_by_time: neededTime,
        // Recorded on the job so any later pay question is answerable from
        // the booking alone.
        list_price_cents: listCents,
        charged_price_cents: priceCents,
        volume_discount_percent: Number(turnover.discount_percent || 0),
        pay_basis_cents: basisCents,
        pay_basis: "full_pre_discount_value",
        pay_pct_locked: payPct,
        payment_status: String(account.billing_method) === "auto_pay" ? "card_on_file" : "invoice",
      },
      base_price_cents: priceCents,
      total_estimate_cents: priceCents,
      final_charge_cents: priceCents,
      // The manager is charged the discounted rate; the crew is paid off the
      // full pre-discount value. Every pay path reads this column, so the
      // discount is invisible to a payout by construction rather than by
      // remembering to special-case it.
      pay_basis_cents: basisCents,
      deposit_cents: 0,
      cleaner_payout_cents: cleanerPayoutCents,
      platform_fee_cents: Math.max(0, priceCents - cleanerPayoutCents),
      payout_status: "pending",
      num_cleaners_assigned: 1,
      payment_option: String(account.billing_method) === "auto_pay" ? "preauth" : "deposit",
      payment_method: String(account.billing_method) === "auto_pay" ? "Card on file" : "Invoice",
      status: "confirmed",
      confirmed_at: new Date().toISOString(),
      booking_channel: "admin_partner",
      booker_source:
        String(turnover.booked_via) === "admin" ? "property_manager_admin" : "property_manager_portal",
    })
    .select("id")
    .single();

  if (error || !booking) {
    // The turnover is real and confirmed even if the dispatch job failed to
    // create; it surfaces as undispatched in the deadline queue rather than
    // being silently lost.
    await supabase.from("events").insert({
      event_type: "property_manager.turnover.dispatch_failed",
      source: "property-manager",
      summary: `Turnover on "${label}" confirmed but no dispatch job was created.`,
      data: { turnover_id: turnover.id, error: error?.message || null },
    });
    return { bookingId: null, error: error?.message };
  }

  await supabase
    .from("property_manager_turnovers")
    .update({ booking_id: booking.id })
    .eq("id", turnover.id as string);

  return { bookingId: String(booking.id) };
}

async function foundationPayPercent(supabase: Admin): Promise<number> {
  const { data } = await supabase
    .from("cleaner_pay_rates")
    .select("rate_percent, min_crew_size, max_crew_size")
    .eq("pay_tier", "foundation")
    .lte("min_crew_size", 1)
    .limit(1)
    .maybeSingle();
  const pct = Number(data?.rate_percent);
  return Number.isFinite(pct) && pct > 0 ? pct : 35;
}

// ─── Cancellation ──────────────────────────────────────────────────────────

export async function cancelTurnover(
  supabase: Admin,
  input: { pmAccountId: string; turnoverId: string; reason?: string | null; actorName?: string | null },
): Promise<{ ok: boolean; status: number; message: string }> {
  const { data: turnover } = await supabase
    .from("property_manager_turnovers")
    .select(TURNOVER_COLS)
    .eq("id", input.turnoverId)
    .maybeSingle();
  if (!turnover || String((turnover as Row).pm_account_id) !== input.pmAccountId) {
    return { ok: false, status: 404, message: "Turnover not found." };
  }
  const row = turnover as Row;
  if (["completed", "cancelled"].includes(String(row.status))) {
    return { ok: false, status: 409, message: "That turnover is already closed." };
  }

  const now = new Date().toISOString();
  await supabase
    .from("property_manager_turnovers")
    .update({ status: "cancelled", cancelled_at: now, cancel_reason: clip(input.reason, 500) || null })
    .eq("id", input.turnoverId);

  if (row.booking_id) {
    await supabase
      .from("bookings")
      .update({ status: "cancelled", cancelled_at: now })
      .eq("id", row.booking_id as string);
  }

  await supabase.from("events").insert({
    event_type: "property_manager.turnover.cancelled",
    source: "property-manager",
    summary: `Turnover cancelled by ${clip(input.actorName, 120) || "the property manager"}.`,
    data: { pm_account_id: input.pmAccountId, turnover_id: input.turnoverId, booking_id: row.booking_id },
  });
  return { ok: true, status: 200, message: "Cancelled." };
}

// ─── Keeping the turnover in step with its job ─────────────────────────────

/**
 * Pull the job's current state back onto the turnover: schedule, status, and
 * — the important one — any approved scope adjustment.
 *
 * A heavy-condition move-out runs through the existing scope-adjustment flow
 * on the booking (photo evidence, a defined reason, admin approval, customer
 * notification). What lands here is the outcome: this turnover's final value
 * moved. The UNIT's standing rate is deliberately untouched — one bad tenant
 * does not re-price the apartment.
 */
export async function syncTurnoverFromBooking(
  supabase: Admin,
  turnoverId: string,
): Promise<{ ok: boolean; changed: boolean }> {
  const { data: turnover } = await supabase
    .from("property_manager_turnovers")
    .select(TURNOVER_COLS)
    .eq("id", turnoverId)
    .maybeSingle();
  if (!turnover) return { ok: false, changed: false };
  const row = turnover as Row;
  if (!row.booking_id) return { ok: true, changed: false };

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, status, service_date, final_charge_cents, total_estimate_cents, completed_at")
    .eq("id", row.booking_id as string)
    .maybeSingle();
  if (!booking) return { ok: true, changed: false };

  return applyBookingState(supabase, row, booking as Row);
}

/**
 * Bring every open turnover on an account into step with its job in one pass.
 *
 * This is pull-based on purpose. A scope adjustment is approved deep inside
 * the existing booking flow, which knows nothing about property managers;
 * rather than teaching that flow a new callback, the portal and the invoice
 * run reconcile before they read. Both are idempotent, so reconciling twice
 * costs nothing and missing a webhook costs nothing either.
 */
export async function syncOpenTurnovers(
  supabase: Admin,
  pmAccountId: string,
): Promise<{ ok: boolean; changed: number }> {
  const { data: turnovers } = await supabase
    .from("property_manager_turnovers")
    .select(TURNOVER_COLS)
    .eq("pm_account_id", pmAccountId)
    .not("booking_id", "is", null)
    .not("status", "in", "(cancelled)")
    .is("invoice_id", null)
    .limit(500);

  const rows = (turnovers || []) as Row[];
  if (rows.length === 0) return { ok: true, changed: 0 };

  const { data: bookings } = await supabase
    .from("bookings")
    .select("id, status, service_date, final_charge_cents, total_estimate_cents, completed_at, pay_basis_cents")
    .in(
      "id",
      rows.map((r) => String(r.booking_id)),
    );
  const byId = new Map(((bookings || []) as Row[]).map((b) => [String(b.id), b]));

  let changed = 0;
  for (const row of rows) {
    const booking = byId.get(String(row.booking_id));
    if (!booking) continue;
    const result = await applyBookingState(supabase, row, booking);
    if (result.changed) changed++;
  }
  return { ok: true, changed };
}

async function applyBookingState(
  supabase: Admin,
  row: Row,
  bookingRow: Row,
): Promise<{ ok: boolean; changed: boolean }> {
  const bookedCents = Number(row.price_cents || 0);
  const finalCents = Math.round(
    Number(bookingRow.final_charge_cents) || Number(bookingRow.total_estimate_cents) || bookedCents,
  );
  const delta = finalCents - bookedCents;

  const patch: Row = {};
  const scheduled = isoDate(bookingRow.service_date);
  if (scheduled && scheduled !== row.scheduled_date) patch.scheduled_date = scheduled;
  if (finalCents !== Number(row.final_price_cents ?? -1)) patch.final_price_cents = finalCents;
  if (delta !== Number(row.scope_adjustment_cents || 0)) patch.scope_adjustment_cents = delta;

  const mapped = mapBookingStatus(String(bookingRow.status || ""));
  if (mapped && mapped !== row.status) patch.status = mapped;
  if (bookingRow.completed_at && !row.completed_at) patch.completed_at = bookingRow.completed_at;

  // An approved scope adjustment raises what the crew is owed, so the job's
  // pay basis has to move with it. The discount stays out of it either way:
  // the basis is the full pre-discount value plus the approved delta, never
  // the discounted charge.
  const listCents = Number(row.list_price_cents || bookedCents);
  const nextBasis = payBasisCents({ listPriceCents: listCents, scopeAdjustmentCents: delta });
  const basisChanged = nextBasis !== Math.round(Number(bookingRow.pay_basis_cents) || 0);
  if (basisChanged) {
    await supabase
      .from("bookings")
      .update({ pay_basis_cents: nextBasis })
      .eq("id", bookingRow.id as string);
  }

  if (Object.keys(patch).length === 0) return { ok: true, changed: basisChanged };
  await supabase.from("property_manager_turnovers").update(patch).eq("id", row.id as string);
  return { ok: true, changed: true };
}

function mapBookingStatus(status: string): string | null {
  switch (status) {
    case "assigned":
      return "assigned";
    case "cleaner_confirmed":
    case "confirmed":
      return "confirmed";
    case "in_progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
    default:
      return null;
  }
}
