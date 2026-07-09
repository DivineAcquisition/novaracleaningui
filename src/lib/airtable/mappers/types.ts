// ─── Source-data input shapes for the Airtable mappers ────────────────────────
//
// These are the NORMALIZED inputs each sync function accepts — the boundary
// between "your source system" (Supabase rows, GHL webhook payloads, manual
// admin entry) and Airtable. Source adapters (see ../sources/) translate raw
// Supabase rows into these shapes.
//
// Money unit conventions are noted per field. Job pay is handled in CENTS
// (matching the Supabase payout engine); contract/config money is in DOLLARS.

export interface ClientInput {
  /** Natural key — upsert merges on Email. Required. */
  email: string;
  name: string;
  /** "Residential" | "STR Host" | "Commercial" */
  type?: string;
  company?: string;
  phone?: string;
  /** City / market / coverage area. Mirrors GHL `market`. */
  serviceZone?: string;
  /** Mirrors GHL `lead_source`. */
  leadSource?: string;
  /** Mirrors GHL `membership_status` lifecycle. */
  lifecycleStage?: string;
  onboardingStage?: string;
  /** YYYY-MM-DD — the Airtable "Agreement Signed" column is a DATE field. */
  agreementSignedDate?: string;
  agreementType?: string;
  stripeCustomerId?: string;
  /** "Yes" | "No" (singleSelect in Airtable). */
  paymentMethodOnFile?: string;
  /** "Yes" | "No" (singleSelect in Airtable). */
  smsOptIn?: string;
  notes?: string;
}

export interface PropertyInput {
  /** Natural key — upsert merges on Property Nickname. Required. */
  nickname: string;
  address?: string;
  bedrooms?: number;
  bathrooms?: number;
  sqft?: number;
  /** DOLLARS */
  standardTurnoverRate?: number;
  /** DOLLARS */
  introRate?: number;
  /** YYYY-MM-DD */
  introRateEndDate?: string;
  linenIncluded?: boolean;
  restockIncluded?: boolean;
  accessType?: string;
  accessInstructions?: string;
  stagingNotes?: string;
  propertyStatus?: string;
  turnoverFrequency?: string;
  /** Host (Client) — link resolved by this email, or pass hostRecordId directly. */
  hostEmail?: string;
  hostRecordId?: string;
}

export interface CommercialAccountInput {
  /** Natural key — upsert merges on Business Name. Required. */
  businessName: string;
  accountType?: string;
  accountStatus?: string;
  serviceFrequency?: string;
  cleaningWindow?: string;
  /** DOLLARS */
  monthlyContractValue?: number;
  /** DOLLARS */
  perVisitRate?: number;
  /** YYYY-MM-DD */
  contractStart?: string;
  contractTerm?: string;
  billingCycle?: string;
  stripeCustomerId?: string;
  /** Decision Maker (Client) — link resolved by email, or pass record id. */
  decisionMakerEmail?: string;
  decisionMakerRecordId?: string;
}

export interface SiteInput {
  /** Natural key — upsert merges on Site Nickname. Required. */
  nickname: string;
  address?: string;
  sqft?: number;
  facilityType?: string;
  restrooms?: number;
  floors?: number;
  /** multipleSelects — exact option names */
  floorTypes?: string[];
  accessMethod?: string;
  /** multipleSelects — exact option names */
  addOnServices?: string[];
  /** Commercial Account — link resolved by business name, or pass record id. */
  commercialAccountName?: string;
  commercialAccountRecordId?: string;
}

export interface JobInput {
  /** Natural key — upsert merges on Job ID. Required. */
  jobId: string;
  /** YYYY-MM-DD (drives the pay period). */
  dateCompleted?: string;
  /** Exact option name, e.g. "Deep", "STR Turnover". */
  serviceType?: string;
  /** What the customer paid, in CENTS. Drives the pay pool. */
  customerPaidCents: number;
  /** Cleaner display name (cross-base text — NOT a link). */
  cleanerName?: string;
  numberOfCleaners?: number;
  /**
   * Locked tier % (35/40/45). Provide this OR `tier`. If both are omitted the
   * job is treated as Foundation (35%).
   */
  tierPct?: number;
  /** Tier name ("foundation"/"proven"/"elite") — used when tierPct absent. */
  tier?: string;
  /**
   * Authoritative pre-computed pay (CENTS) from the Supabase payout engine.
   * When present these win over the computed estimate so Airtable matches the
   * money the cleaner is actually paid.
   */
  cleanerPayPoolCents?: number;
  payPerCleanerCents?: number;
  /** "Pending" | "Paid" | "Failed" | "Refunded" */
  paymentStatus?: string;
  /** "Partner Portal" | "Webhook" | "Manual Admin Entry" | "Backfill" */
  entrySource?: string;
  /** Link to Client (by email or record id). */
  clientEmail?: string;
  clientRecordId?: string;
  /** Link to Property for STR turnovers (by nickname or record id). */
  propertyNickname?: string;
  propertyRecordId?: string;
  /** Link to the Payroll Run this job rolled into (record id). */
  payrollRunRecordId?: string;
}

export interface PayrollRunInput {
  /** Natural key — upsert merges on Run ID. Required. */
  runId: string;
  /** Cleaner display name (cross-base text — NOT a link). */
  cleanerName?: string;
  /** YYYY-MM-DD */
  periodStart?: string;
  /** YYYY-MM-DD */
  periodEnd?: string;
  totalJobs?: number;
  /** DOLLARS */
  grossPay?: number;
  /** DOLLARS */
  bonus?: number;
  /** DOLLARS */
  deduction?: number;
  /** DOLLARS */
  netPay?: number;
  paymentMethod?: string;
  /** "Pending" | "Processing" | "Paid" | "Failed" */
  status?: string;
  /** YYYY-MM-DD — when the money actually went out. */
  sentAt?: string;
  stripeTransferId?: string;
  /** Component breakdown (custom payouts vs extra pay). */
  notes?: string;
  /** Job record ids that rolled into this run (sets the reverse "Payroll Run" link). */
  jobRecordIds?: string[];
}

// Field display names used for formula lookups when resolving link targets.
export const LOOKUP_FIELD_NAMES = {
  clientEmail: "Email",
  propertyNickname: "Property Nickname",
  commercialBusinessName: "Business Name",
} as const;
