// ─── Partner / STR GHL custom-field map (single source of truth) ──────────
//
// The customer/booking funnel has one authoritative field builder
// (`_shared/ghl-field-map.ts`). The partner/STR flows previously built GHL
// custom fields ad-hoc in two places (host onboarding + turnover sync) which
// drifted: phone wasn't display-formatted like bookings, turnover-only hosts
// never got the STR identity fields onboarding set, etc.
//
// This module is the partner equivalent: every partner/STR GHL write maps
// through here so the SAME logical value lands on the SAME fieldKey with the
// SAME formatting across onboarding AND turnovers — consistent with the
// customer funnel (shared phone/money helpers).
//
// Values use existing, configured GHL SINGLE_OPTION labels (e.g.
// "Move In/Out Cleaning", "One-Time", "Per Visit") so we never push an option
// GHL doesn't have. Keys are runtime-resolved by ghl-client (no hardcoded
// UUIDs).

import { fmtMoney } from "./ghl-client.ts";
import { formatPhoneDisplayUS } from "./phone-format.ts";

export type GhlFieldValue = string | number | boolean | null | undefined;
export type GhlFieldBag = Record<string, GhlFieldValue>;

export type HostEntityType = "individual" | "entity";

/**
 * The STR-host *identity* fields. These describe WHO the contact is and never
 * change between events, so we set them on EVERY host contact upsert (both
 * onboarding and turnover) — that's the fix that makes a turnover-only host
 * match an onboarded host in GHL.
 *
 * `partnerStatus` / `onboardingStage` are lifecycle fields: only pass them
 * from the flows that actually own a transition (onboarding submit, agreement
 * sent/signed) so a routine turnover upsert never rewinds a host's stage.
 */
export function hostIdentityFields(opts: {
  entityType?: HostEntityType | null;
  entityName?: string | null;
  propertyCount?: number | null;
  serviceZone?: string | null;
  partnerStatus?: string | null;
  onboardingStage?: string | null;
}): GhlFieldBag {
  const isEntity = opts.entityType === "entity";
  const bag: GhlFieldBag = {
    client_type: "STR Host",
    host_type: "STR Host",
  };
  if (opts.entityType) {
    bag.host_entity_type = isEntity ? "Entity" : "Individual";
    bag.entity_name = isEntity ? (opts.entityName || "") : "";
  }
  if (opts.serviceZone != null) bag.market = opts.serviceZone || "";
  if (opts.propertyCount != null) bag.number_of_properties = opts.propertyCount;
  if (opts.partnerStatus) bag.partner_status = opts.partnerStatus;
  if (opts.onboardingStage) bag.onboarding_stage = opts.onboardingStage;
  return bag;
}

/**
 * Turnover opportunity/contact custom fields. Mirrors the booking funnel's
 * semantics (display-formatted contractor phone, cents→money formatting) so a
 * turnover opportunity reads the same as a residential job in GHL.
 */
export function turnoverCustomFields(opts: {
  serviceWhen?: string;
  dateLabel?: string;
  status?: "open" | "won" | "lost" | "abandoned";
  accessNotes?: string | null;
  jobNotes?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  sqft?: number | null;
  priceDollars?: number | null;
  isPaid?: boolean;
  cleanerName?: string | null;
  cleanerPhone?: string | null;
}): GhlFieldBag {
  const priceNum = Number(opts.priceDollars || 0);
  const priceCents = Math.round(priceNum * 100);
  return {
    // Closest configured GHL option for a single STR turnover clean.
    cleaning_type: "Move In/Out Cleaning",
    service_time__date: opts.serviceWhen || "",
    next_service_date__time: opts.status === "won" ? "" : (opts.serviceWhen || ""),
    preferred_start_date: opts.dateLabel || "",
    entry__gate_notes: opts.accessNotes || "",
    job_notes_internal: opts.jobNotes || "",
    bedrooms: opts.bedrooms ?? "",
    bathrooms: opts.bathrooms ?? "",
    estimated_sqft: opts.sqft ?? "",
    final_cost_: fmtMoney(priceCents),
    deposit_paid: opts.isPaid ? "Yes" : "No",
    deposit_amount_: fmtMoney(priceCents),
    remaining_balance: fmtMoney(0),
    service_frequency: "One-Time",
    billing_frequency: "Per Visit",
    "1_contractor": opts.cleanerName || "",
    // Display-format the contractor phone exactly like the booking funnel.
    "1_contractor_number": opts.cleanerPhone ? formatPhoneDisplayUS(opts.cleanerPhone) : "",
  };
}
