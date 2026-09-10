// ─── The unit registry ─────────────────────────────────────────────────────
//
// Registering a unit is the only moment pricing happens for a property
// manager. Everything after it — booking a turnover, adding a unit two months
// later, crossing a volume threshold — reads or re-derives from here.
//
// The rule that shapes this file: a property manager running twenty units
// cannot tolerate a quote cycle every time a tenant moves out. So a typical
// unit auto-prices with no human in the loop, and only the genuinely unusual
// ones route for review.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import {
  PM_SERVICE_LABELS,
  PM_SERVICE_TYPES,
  formatRate,
  resolveVolumeDiscount,
  reviewReasonMessage,
  unitDisplayName,
  type PmServiceType,
} from "./pricing";
import {
  computeStandingRates,
  loadPmPricingContext,
  ratesToColumns,
  zipFromAddress,
  type PmPricingContext,
} from "./pricing-server";

type Admin = ReturnType<typeof getAdminSupabase>;
type Row = Record<string, unknown>;

export const UNIT_COLS = `
  id, pm_account_id, unit_label, address, city, state, zip_code, sqft, bedrooms, bathrooms,
  zone_code, zone_multiplier, home_size_id,
  list_move_out_cents, list_move_in_cents, list_standard_cents,
  standing_move_out_cents, standing_move_in_cents, standing_standard_cents,
  discount_percent_applied, rates_computed_at,
  access_method, access_code, access_notes, parking_notes, special_notes,
  status, review_reason, review_note, flagged_non_standard, source, created_at
`;

export const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function toInt(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function toNum(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Units that count toward the portfolio volume tier: priced and live. */
export async function countRegisteredUnits(supabase: Admin, pmAccountId: string): Promise<number> {
  const { count } = await supabase
    .from("property_manager_units")
    .select("id", { count: "exact", head: true })
    .eq("pm_account_id", pmAccountId)
    .eq("status", "active");
  return typeof count === "number" ? count : 0;
}

export function standingRateFor(unit: Row, service: PmServiceType): number | null {
  const key = `standing_${service}_cents`;
  const n = Number(unit[key]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function listRateFor(unit: Row, service: PmServiceType): number | null {
  const key = `list_${service}_cents`;
  const n = Number(unit[key]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Portal- and onboarding-facing shape of a unit. Rates are always read-only
 * here: `rateEditable` is a literal false, not a computed permission, because
 * there is no path on which a property manager sets their own price.
 */
export function publicUnit(unit: Row) {
  const rates = PM_SERVICE_TYPES.map((service) => ({
    service,
    label: PM_SERVICE_LABELS[service],
    standingCents: standingRateFor(unit, service),
    listCents: listRateFor(unit, service),
  }));
  return {
    id: String(unit.id),
    label: unitDisplayName(unit as { unit_label?: string | null; address?: string | null }),
    unitLabel: (unit.unit_label as string) || null,
    address: (unit.address as string) || null,
    city: (unit.city as string) || null,
    state: (unit.state as string) || null,
    zipCode: (unit.zip_code as string) || null,
    sqft: unit.sqft == null ? null : Number(unit.sqft),
    bedrooms: unit.bedrooms == null ? null : Number(unit.bedrooms),
    bathrooms: unit.bathrooms == null ? null : Number(unit.bathrooms),
    zoneCode: (unit.zone_code as string) || null,
    rates,
    discountPercent: Number(unit.discount_percent_applied || 0),
    ratesComputedAt: (unit.rates_computed_at as string) || null,
    status: String(unit.status || "active"),
    reviewReason: (unit.review_reason as string) || null,
    reviewMessage: reviewReasonMessage(unit.review_reason as string | null),
    bookable: String(unit.status) === "active" && standingRateFor(unit, "move_out") != null,
    accessOnFile: Boolean(unit.access_method || unit.access_code || unit.access_notes),
    accessMethod: (unit.access_method as string) || null,
    accessNotes: (unit.access_notes as string) || null,
    parkingNotes: (unit.parking_notes as string) || null,
    notes: (unit.special_notes as string) || null,
    rateEditable: false as const,
  };
}

export type PublicUnit = ReturnType<typeof publicUnit>;

// ─── Registering ───────────────────────────────────────────────────────────

export interface RegisterUnitInput {
  pmAccountId: string;
  unitLabel?: string | null;
  address: string;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  sqft?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  accessMethod?: string | null;
  accessCode?: string | null;
  accessNotes?: string | null;
  parkingNotes?: string | null;
  notes?: string | null;
  flaggedNonStandard?: boolean;
  source: "admin" | "onboarding" | "portal";
  actorName?: string | null;
}

export interface RegisterUnitResult {
  ok: boolean;
  status: number;
  message: string;
  unitId?: string;
  unit?: PublicUnit;
  /** True when the unit priced itself with no admin involvement. */
  autoPriced?: boolean;
  routedForReview?: boolean;
  reviewReason?: string | null;
}

/**
 * Register one unit and, when it is typical, compute and store its standing
 * Move-Out / Move-In / Standard rates from the residential engine.
 *
 * A unit that routes for review is still created — the property manager sees
 * it in their registry as "with our team" rather than losing the entry — it
 * simply has no rates and cannot be booked until an admin prices it.
 */
export async function registerUnit(
  supabase: Admin,
  input: RegisterUnitInput,
  ctx?: PmPricingContext | null,
): Promise<RegisterUnitResult> {
  const address = clip(input.address, 300);
  if (address.length < 5) {
    return { ok: false, status: 400, message: "Add the unit's street address." };
  }

  const { data: account } = await supabase
    .from("property_manager_accounts")
    .select("id, company_name, email")
    .eq("id", input.pmAccountId)
    .maybeSingle();
  if (!account) return { ok: false, status: 404, message: "Property manager account not found." };

  const zip = clip(input.zipCode, 10) || zipFromAddress(address) || null;
  const pricingCtx = ctx ?? (await loadPmPricingContext(supabase));

  const base: Row = {
    pm_account_id: input.pmAccountId,
    unit_label: clip(input.unitLabel, 120) || null,
    address,
    city: clip(input.city, 120) || null,
    state: clip(input.state, 40) || null,
    zip_code: zip,
    sqft: toInt(input.sqft),
    bedrooms: toNum(input.bedrooms),
    bathrooms: toNum(input.bathrooms),
    access_method: clip(input.accessMethod, 120) || null,
    access_code: clip(input.accessCode, 120) || null,
    access_notes: clip(input.accessNotes, 2000) || null,
    parking_notes: clip(input.parkingNotes, 1000) || null,
    special_notes: clip(input.notes, 2000) || null,
    flagged_non_standard: !!input.flaggedNonStandard,
    source: input.source,
    created_by_name: clip(input.actorName, 120) || null,
  };

  // The tier this unit is priced at includes itself: registering the fifth
  // unit is what puts the portfolio in the 5+ band.
  const existingCount = await countRegisteredUnits(supabase, input.pmAccountId);
  const computed = pricingCtx
    ? await computeStandingRates(supabase, pricingCtx, {
        address,
        zipCode: zip,
        sqft: toInt(input.sqft),
        bedrooms: toNum(input.bedrooms),
        bathrooms: toNum(input.bathrooms),
        flaggedNonStandard: !!input.flaggedNonStandard,
        unitCount: existingCount + 1,
      })
    : ({
        ok: false as const,
        reason: "pricing_unavailable" as const,
        message: "We couldn't reach the pricing tables. Our team will set this unit's rates.",
      });

  const patch: Row = computed.ok
    ? { ...base, ...ratesToColumns(computed.rates), status: "active", review_reason: null }
    : { ...base, status: "pending_review", review_reason: computed.reason };

  const { data: inserted, error } = await supabase
    .from("property_manager_units")
    .insert(patch)
    .select(UNIT_COLS)
    .single();
  if (error || !inserted) {
    return { ok: false, status: 400, message: error?.message || "Could not register that unit." };
  }

  const unitRow = inserted as Row;
  const label = unitDisplayName(unitRow as { unit_label?: string | null; address?: string | null });

  if (!computed.ok) {
    await notifyPmAdmin(supabase, {
      subject: `Unit needs pricing — ${String(account.company_name)}`,
      html: [
        `<p>A unit was added to <strong>${escapeHtml(String(account.company_name))}</strong>'s registry and did not auto-price.</p>`,
        `<p><strong>${escapeHtml(label)}</strong><br/>${escapeHtml(address)}</p>`,
        `<p>Reason: <strong>${escapeHtml(computed.reason)}</strong> — ${escapeHtml(computed.message)}</p>`,
        `<p>Set its Move-Out / Move-In / Standard rates in Partnerships → Property Managers. It is not bookable until then.</p>`,
      ].join(""),
      eventType: "property_manager.unit.review_required",
      summary: `Unit "${label}" routed for review (${computed.reason}).`,
      data: {
        pm_account_id: input.pmAccountId,
        unit_id: unitRow.id,
        reason: computed.reason,
        source: input.source,
      },
    });
    return {
      ok: true,
      status: 200,
      unitId: String(unitRow.id),
      unit: publicUnit(unitRow),
      autoPriced: false,
      routedForReview: true,
      reviewReason: computed.reason,
      message: computed.message,
    };
  }

  // Adding this unit may have moved the whole portfolio into a better tier.
  // Everyone's stored rate has to follow, or the manager sees two prices for
  // the same portfolio depending on which unit they look at.
  await repricePortfolio(supabase, input.pmAccountId, {
    actorName: input.actorName,
    skipUnitIds: [],
    ctx: pricingCtx,
  });

  const { data: fresh } = await supabase
    .from("property_manager_units")
    .select(UNIT_COLS)
    .eq("id", unitRow.id as string)
    .maybeSingle();

  await supabase.from("events").insert({
    event_type: "property_manager.unit.registered",
    source: "property-manager",
    summary: `Unit "${label}" registered and auto-priced for ${String(account.company_name)}.`,
    data: {
      pm_account_id: input.pmAccountId,
      unit_id: unitRow.id,
      source: input.source,
      standing_move_out_cents: (fresh as Row | null)?.standing_move_out_cents ?? null,
    },
  });

  return {
    ok: true,
    status: 200,
    unitId: String(unitRow.id),
    unit: publicUnit((fresh as Row) || unitRow),
    autoPriced: true,
    routedForReview: false,
    message: "Registered — standing rates are set and this unit is ready to book.",
  };
}

// ─── Re-pricing ────────────────────────────────────────────────────────────

export interface RepriceResult {
  ok: boolean;
  repriced: number;
  discountPercent: number;
  discountLabel: string | null;
  unitCount: number;
}

/**
 * Recompute every active unit's standing rates at the portfolio's current
 * volume tier and write the tier snapshot back to the account.
 *
 * Called whenever the unit count changes or an admin edits the tier table.
 * The list (pre-discount) value is recomputed too, so a change in the
 * residential tables flows through — cleaner pay is derived from that number
 * and must not go stale.
 */
export async function repricePortfolio(
  supabase: Admin,
  pmAccountId: string,
  opts: { actorName?: string | null; skipUnitIds?: string[]; ctx?: PmPricingContext | null } = {},
): Promise<RepriceResult> {
  const ctx = opts.ctx ?? (await loadPmPricingContext(supabase));
  const unitCount = await countRegisteredUnits(supabase, pmAccountId);
  const discountConfig = ctx?.discounts;
  const discount = discountConfig
    ? resolveVolumeDiscount(discountConfig, unitCount)
    : { percent: 0, label: null, unitCount, unitsToNextTier: null, nextPercent: null };

  await supabase
    .from("property_manager_accounts")
    .update({
      volume_discount_percent: discount.percent,
      volume_discount_label: discount.label,
      volume_discount_reviewed_at: new Date().toISOString(),
    })
    .eq("id", pmAccountId);

  if (!ctx) return { ok: false, repriced: 0, discountPercent: discount.percent, discountLabel: discount.label, unitCount };

  const skip = new Set(opts.skipUnitIds || []);
  const { data: units } = await supabase
    .from("property_manager_units")
    .select(UNIT_COLS)
    .eq("pm_account_id", pmAccountId)
    .eq("status", "active");

  let repriced = 0;
  for (const raw of (units || []) as Row[]) {
    if (skip.has(String(raw.id))) continue;
    const computed = await computeStandingRates(supabase, ctx, {
      address: (raw.address as string) || null,
      zipCode: (raw.zip_code as string) || null,
      sqft: raw.sqft == null ? null : Number(raw.sqft),
      bedrooms: raw.bedrooms == null ? null : Number(raw.bedrooms),
      bathrooms: raw.bathrooms == null ? null : Number(raw.bathrooms),
      flaggedNonStandard: !!raw.flagged_non_standard,
      unitCount,
    });
    // A unit that stops pricing cleanly keeps its last known rates rather
    // than losing them mid-portfolio; the review queue is for new entries.
    if (!computed.ok) continue;
    await supabase
      .from("property_manager_units")
      .update(ratesToColumns(computed.rates))
      .eq("id", raw.id as string);
    repriced++;
  }

  return {
    ok: true,
    repriced,
    discountPercent: discount.percent,
    discountLabel: discount.label,
    unitCount,
  };
}

// ─── Admin review of a routed unit ─────────────────────────────────────────

export interface ApproveUnitInput {
  unitId: string;
  sqft?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  zipCode?: string | null;
  /** Explicit Company-set rates, in cents, when the engine cannot produce them. */
  manualRates?: Partial<Record<PmServiceType, number>>;
  clearNonStandardFlag?: boolean;
  reviewNote?: string | null;
  actorName?: string | null;
}

/**
 * Price a unit that routed for review. The admin either supplies the missing
 * detail and lets the engine price it, or sets the rates explicitly for a
 * unit the residential bands genuinely do not describe.
 */
export async function approveUnit(
  supabase: Admin,
  input: ApproveUnitInput,
): Promise<{ ok: boolean; status: number; message: string; unit?: PublicUnit }> {
  const { data: unit } = await supabase
    .from("property_manager_units")
    .select(UNIT_COLS)
    .eq("id", input.unitId)
    .maybeSingle();
  if (!unit) return { ok: false, status: 404, message: "Unit not found." };

  const row = unit as Row;
  const pmAccountId = String(row.pm_account_id);
  const patch: Row = {
    reviewed_at: new Date().toISOString(),
    reviewed_by_name: clip(input.actorName, 120) || null,
    review_note: clip(input.reviewNote, 1000) || null,
  };
  if (input.sqft != null) patch.sqft = toInt(input.sqft);
  if (input.bedrooms != null) patch.bedrooms = toNum(input.bedrooms);
  if (input.bathrooms != null) patch.bathrooms = toNum(input.bathrooms);
  if (input.zipCode) patch.zip_code = clip(input.zipCode, 10);
  if (input.clearNonStandardFlag) patch.flagged_non_standard = false;

  const manual = input.manualRates || {};
  const hasManual = PM_SERVICE_TYPES.some((s) => Number(manual[s]) > 0);

  if (hasManual) {
    const ctx = await loadPmPricingContext(supabase);
    const unitCount = await countRegisteredUnits(supabase, pmAccountId);
    const discount = ctx
      ? resolveVolumeDiscount(ctx.discounts, unitCount + 1)
      : { percent: 0, label: null, unitCount, unitsToNextTier: null, nextPercent: null };
    // A manually set rate is the LIST value — the discount still comes off
    // company margin, and cleaner pay still computes from the full number.
    for (const service of PM_SERVICE_TYPES) {
      const listCents = Math.round(Number(manual[service]) || 0);
      if (listCents <= 0) continue;
      patch[`list_${service}_cents`] = listCents;
      patch[`standing_${service}_cents`] = Math.max(
        0,
        Math.round(listCents * (1 - discount.percent / 100)),
      );
    }
    patch.discount_percent_applied = discount.percent;
    patch.rates_computed_at = new Date().toISOString();
    patch.pricing_basis = {
      engine: "admin_manual",
      set_by: clip(input.actorName, 120) || null,
      note: clip(input.reviewNote, 1000) || null,
      discount_percent: discount.percent,
      computed_at: new Date().toISOString(),
    };
    patch.status = "active";
    patch.review_reason = null;
  }

  await supabase.from("property_manager_units").update(patch).eq("id", input.unitId);

  if (!hasManual) {
    // Re-run the engine with whatever the admin corrected.
    const ctx = await loadPmPricingContext(supabase);
    const unitCount = await countRegisteredUnits(supabase, pmAccountId);
    const computed = ctx
      ? await computeStandingRates(supabase, ctx, {
          address: (row.address as string) || null,
          zipCode: (patch.zip_code as string) || (row.zip_code as string) || null,
          sqft: (patch.sqft as number) ?? (row.sqft == null ? null : Number(row.sqft)),
          bedrooms: (patch.bedrooms as number) ?? (row.bedrooms == null ? null : Number(row.bedrooms)),
          bathrooms: (patch.bathrooms as number) ?? (row.bathrooms == null ? null : Number(row.bathrooms)),
          flaggedNonStandard: input.clearNonStandardFlag ? false : !!row.flagged_non_standard,
          unitCount: unitCount + 1,
        })
      : null;
    if (!computed || !computed.ok) {
      return {
        ok: false,
        status: 409,
        message:
          computed && !computed.ok
            ? `${computed.message} Set the rates explicitly to clear this unit.`
            : "Pricing tables are unavailable. Set the rates explicitly to clear this unit.",
      };
    }
    await supabase
      .from("property_manager_units")
      .update({ ...ratesToColumns(computed.rates), status: "active", review_reason: null })
      .eq("id", input.unitId);
  }

  await repricePortfolio(supabase, pmAccountId, { actorName: input.actorName });

  const { data: fresh } = await supabase
    .from("property_manager_units")
    .select(UNIT_COLS)
    .eq("id", input.unitId)
    .maybeSingle();

  await supabase.from("events").insert({
    event_type: "property_manager.unit.approved",
    source: "partner-admin",
    summary: `${clip(input.actorName, 120) || "Admin"} priced unit "${unitDisplayName(row as { unit_label?: string | null; address?: string | null })}".`,
    data: { pm_account_id: pmAccountId, unit_id: input.unitId, manual: hasManual },
  });

  return {
    ok: true,
    status: 200,
    message: "Unit priced and bookable.",
    unit: fresh ? publicUnit(fresh as Row) : undefined,
  };
}

// ─── Access details (stored once, reused every turnover) ───────────────────

export async function updateUnitAccess(
  supabase: Admin,
  input: {
    unitId: string;
    accessMethod?: string | null;
    accessCode?: string | null;
    accessNotes?: string | null;
    parkingNotes?: string | null;
    actorName?: string | null;
  },
): Promise<{ ok: boolean; status: number; message: string }> {
  const patch: Row = {};
  if (input.accessMethod !== undefined) patch.access_method = clip(input.accessMethod, 120) || null;
  if (input.accessCode !== undefined) patch.access_code = clip(input.accessCode, 120) || null;
  if (input.accessNotes !== undefined) patch.access_notes = clip(input.accessNotes, 2000) || null;
  if (input.parkingNotes !== undefined) patch.parking_notes = clip(input.parkingNotes, 1000) || null;
  if (Object.keys(patch).length === 0) {
    return { ok: false, status: 400, message: "Nothing to update." };
  }
  const { error } = await supabase
    .from("property_manager_units")
    .update(patch)
    .eq("id", input.unitId);
  if (error) return { ok: false, status: 400, message: error.message };
  return {
    ok: true,
    status: 200,
    message: "Saved. These details carry to every future turnover on this unit.",
  };
}

// ─── Shared helpers ────────────────────────────────────────────────────────

export function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function rateSummaryLine(unit: Row): string {
  const parts = PM_SERVICE_TYPES.map((service) => {
    const cents = standingRateFor(unit, service);
    return cents == null ? null : `${PM_SERVICE_LABELS[service]} ${formatRate(cents)}`;
  }).filter(Boolean);
  return parts.join(" · ");
}

export async function notifyPmAdmin(
  supabase: Admin,
  input: {
    subject: string;
    html: string;
    eventType: string;
    summary: string;
    data: Record<string, unknown>;
  },
): Promise<void> {
  await supabase.from("events").insert({
    event_type: input.eventType,
    source: "property-manager",
    summary: input.summary,
    data: input.data,
  });

  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "property_manager_settings")
    .maybeSingle();
  const notify =
    (setting?.value as { notify_email?: string } | null)?.notify_email ||
    process.env.PROPERTY_MANAGER_NOTIFY_EMAIL ||
    process.env.HOST_ONBOARDING_NOTIFY_EMAIL ||
    null;
  if (!notify) return;
  await sendPartnershipMessage(supabase, {
    templateKey: "admin_internal_notice",
    trigger: input.eventType,
    role: "admin",
    email: notify,
    subject: input.subject,
    html: input.html,
    vars: { subject_line: input.subject, body_html: input.html },
  }).catch(() => null);
}
