// ─── Airtable schema map — "NVC | Client & Revenue Ops" ───────────────────────
//
// Single source of truth for every base / table / field ID we write to.
// Writing by FIELD ID (not name) makes the integration resilient to anyone
// renaming a column in the Airtable UI — the ID never changes.
//
// Base: "NVC | Client & Revenue Ops"  (appoUuFQZQfCyKGlw)
//
// The Contractors table lives in a SEPARATE base ("NVC™ | Maryland",
// app0jCdQHXOvItVPo). Airtable links cannot cross bases, so the cleaner is
// stored on Jobs / Payroll Runs as the text field "Cleaner (Name)" and matched
// by name string — never as a record link.
//
// NOTE on "crucial data we map to GHL": the GHL contact sync
// (supabase/functions/_shared/ghl-field-map.ts) is the other half of this
// pipeline. The CRUCIAL_GHL_FIELDS map below documents which Airtable columns
// carry the same operational truth that GHL receives (lead source, lifecycle /
// payment status, Stripe customer id, locked pay tier, cleaner pay pool / per
// cleaner pay, service zone, etc.) so the CRM and the revenue-ops base never
// drift. Keep them aligned when either side changes.

export const REVENUE_OPS_BASE_ID = "appoUuFQZQfCyKGlw";

/** Separate Maryland base that owns the Contractors table (cross-base — link not allowed). */
export const MARYLAND_BASE_ID = "app0jCdQHXOvItVPo";

export const TABLES = {
  clients: "tblVdeArr2xi6X8nV",
  jobs: "tblAPqJV5Zb7EY6OR",
  properties: "tblb9GXgPjNKaUogN",
  commercialAccounts: "tblv37oMyC0hF6Yav",
  sites: "tblIAnpKS2RKtYPZk",
  payrollRuns: "tblGr8Cu8avwvV3xy",
} as const;

export type TableKey = keyof typeof TABLES;

// ─── Field IDs per table ──────────────────────────────────────────────────────

export const CLIENT_FIELDS = {
  clientName: "fld80wgt9XE4q75FN", // primary
  clientType: "fldOO5kiKnaU9i2HY",
  company: "fldJEOSsdi0JmKLgd",
  email: "fldKtXg47KiHDoIK4", // natural key for upsert
  phone: "fldDnxFw03pASlmCt",
  serviceZone: "fldyUy821bc8kMDeu",
  leadSource: "fldkM2Y8efdBAlBsF",
  lifecycleStage: "fldlsfoUyla1p1Q2I",
  onboardingStage: "fldkATjiTqfytao0n",
  agreementSigned: "fldFpHkMdQf8w340e",
  agreementType: "fldeSj5hHc8hyfbtc",
  stripeCustomerId: "fldgUcDumlPrnxslG",
  paymentMethodOnFile: "fldbQ7J9t2b0kj1vG",
  smsOptIn: "fldATiSE6Ji0DxpgY",
  notes: "fldnNP6izQ8g2Mmpb", // long text — free-form notes + admin audit trail
  // Count of linked Properties (rollup/count field on Clients). Read-only.
  propertiesCount: "fldrIEbiGVFSr1Pzn",
} as const;

export const JOB_FIELDS = {
  jobId: "fld9aWli13kTxoMzf", // primary + natural key for upsert
  dateCompleted: "fldhoNhfXxMt8sZxS",
  serviceType: "fldcHKWDIKgSI19NT",
  customerPaid: "fldDN2OYVsLZZKaZx",
  cleanerName: "fldjbr6tf9NtD0jyL", // text — cross-base, NOT a link
  numberOfCleaners: "fldoc73R2hdqoBdR5",
  tierPctLocked: "fldr6Uh1V70cJmLJt",
  cleanerPayPool: "fldNXo5cz2D3MY4ml",
  payPerCleaner: "fldGKEV9wShu9MSG9",
  payPeriod: "fld8EaDNFnVgHFHz3",
  paymentStatus: "fldlYORWTbBUOUwph",
  entrySource: "fldQeWeOGrjSPJExc",
  // link fields (created by scripts/add-airtable-links.ts)
  client: "Client", // multipleRecordLinks → Clients (write by name)
  property: "Property", // multipleRecordLinks → Properties (STR turnovers)
  payrollRun: "Payroll Run", // multipleRecordLinks → Payroll Runs
  // Field ID of the Client link — used when READING (returnFieldsByFieldId)
  // to group a host's turnover history by their Client record id.
  clientLinkId: "fldiOCbiJyxwxBLXh",
} as const;

export const PROPERTY_FIELDS = {
  propertyNickname: "fld6CkyqjKFN9VIxB", // primary + natural key
  address: "fldLGjyULkF4qUAFq",
  bedrooms: "fldTsOiFe870GgXpl",
  bathrooms: "fld1wD8gLDkFIzsEB",
  sqft: "fldG9y4LjdVVWvCXa",
  standardTurnoverRate: "fldocqP7jR5gtI89r",
  introRate: "fldtKgtMfBZCwMLfC",
  introRateEndDate: "fldLR7qQcsSS43uaG",
  linenIncluded: "fldjoZm0lyUennMcg",
  restockIncluded: "fldm2gBV6COkvg9Hb",
  accessType: "fldCJK3tB43Lnr2CP",
  accessInstructions: "fldLQOwaD9IGThFkX",
  stagingNotes: "fldbh7iAJn0EvYvWH",
  propertyStatus: "fldEnGRYQzYJObYeY",
  turnoverFrequency: "fldbWTEVb2POrD5Si",
  // link field
  host: "Host", // multipleRecordLinks → Clients (write by name)
  // Field ID of the Host link — used when READING (returnFieldsByFieldId)
  // to group properties under their host Client record id.
  hostLinkId: "fldGlabTTMCiLuTR7",
} as const;

export const COMMERCIAL_ACCOUNT_FIELDS = {
  businessName: "fldVuD4wKWQ0TL0Ss", // primary + natural key
  accountType: "fldd10U6uIhAS4aTj",
  accountStatus: "fldBLJzYWpKhn1Rdc",
  serviceFrequency: "fldovNcNKvawO6pNq",
  cleaningWindow: "fldFmYA6aCgEIteGS",
  monthlyContractValue: "fldGf5CrVntkNSvC0",
  perVisitRate: "fldE4F4wJq78T7uG6",
  contractStart: "fldfqOQwdTMHycL2g",
  contractTerm: "fldp3KSiSQLzn3xWY",
  billingCycle: "flddK7JcwS5kkNAWm",
  stripeCustomerId: "fldAOqT6lsYsQDSVO",
  // link field
  decisionMaker: "Decision Maker", // multipleRecordLinks → Clients
} as const;

export const SITE_FIELDS = {
  siteNickname: "fldC0rBkpvhLCISWI", // primary + natural key
  address: "fldlVtG9NxT40713W",
  sqft: "fldnjz0AYA4TsFY7H",
  facilityType: "fld3hVFDDjx3RHrmJ",
  restrooms: "fld0Rszy1hT627oqS",
  floors: "fldGy5gtEGjhZ8m7n",
  floorTypes: "fld4jsOF0vxByyWeo",
  accessMethod: "fldI2QHUqGhfAxMoD",
  addOnServices: "fldrIXR8xaMMYIoSb",
  // link field
  commercialAccount: "Commercial Account", // multipleRecordLinks → Commercial Accounts
} as const;

export const PAYROLL_RUN_FIELDS = {
  runId: "fldma9MP4dAavHr1w", // primary + natural key
  cleanerName: "fldmEx7eF3BNqikvg", // text — cross-base, NOT a link
  periodStart: "fldL2UnaibUcEsgNm",
  periodEnd: "fldfcED6fn7u9caTe",
  totalJobs: "fldX0KX925No7glkg",
  grossPay: "fldesfKdzVEm6wDJH",
  bonus: "fldutIxR6mPgSYFHY",
  deduction: "fldL1rXbU4rlVS5sU",
  netPay: "fldwPSiefPgpg1JXB",
  paymentMethod: "fldU0IFWyFhjdz6Le",
  status: "fldq3EcOQXuVyz5JY",
  stripeTransferId: "fldGvKPcpkSJvFmoX",
} as const;

// ─── The 6 link fields to create via the Meta API (Job A) ─────────────────────
//
// Airtable auto-creates the symmetric reverse field on the linked table.

export interface LinkFieldSpec {
  /** Table the new link field is added to. */
  tableId: string;
  /** Human label of the link field. */
  name: string;
  /** Table the link points at. */
  linkedTableId: string;
  /** Short note for logging. */
  description: string;
}

export const LINK_FIELDS: LinkFieldSpec[] = [
  {
    tableId: TABLES.jobs,
    name: "Client",
    linkedTableId: TABLES.clients,
    description: "Jobs → Clients",
  },
  {
    tableId: TABLES.properties,
    name: "Host",
    linkedTableId: TABLES.clients,
    description: "Properties → Clients (STR host)",
  },
  {
    tableId: TABLES.commercialAccounts,
    name: "Decision Maker",
    linkedTableId: TABLES.clients,
    description: "Commercial Accounts → Clients",
  },
  {
    tableId: TABLES.sites,
    name: "Commercial Account",
    linkedTableId: TABLES.commercialAccounts,
    description: "Sites → Commercial Accounts",
  },
  {
    tableId: TABLES.jobs,
    name: "Payroll Run",
    linkedTableId: TABLES.payrollRuns,
    description: "Jobs → Payroll Runs",
  },
  {
    tableId: TABLES.jobs,
    name: "Property",
    linkedTableId: TABLES.properties,
    description: "Jobs → Properties (STR turnovers, optional)",
  },
];

// ─── Select-field option vocabularies ─────────────────────────────────────────
//
// Send the EXACT option name string. When a value might not yet exist as an
// option the client writes with typecast:true so Airtable creates it rather
// than erroring — and logs that it happened (see client.ts).

export const CLIENT_TYPE = {
  residential: "Residential",
  strHost: "STR Host",
  commercial: "Commercial",
} as const;

export const JOB_SERVICE_TYPE = {
  standard: "Standard",
  deep: "Deep",
  moveInOut: "Move-In/Out",
  recurring: "Recurring",
  strTurnover: "STR Turnover",
  commercial: "Commercial",
  other: "Other",
} as const;

export const PAYMENT_STATUS = {
  pending: "Pending",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
} as const;

// Property lifecycle (spec §4.2): a property starts "Pending Pricing", goes
// "Active" once a Standard Rate is set + agreement signed, and can be "Paused".
export const PROPERTY_STATUS = {
  pendingPricing: "Pending Pricing",
  active: "Active",
  paused: "Paused",
} as const;

// Host (Client) lifecycle stage (spec §5): the admin promotes a host to
// "Active" once live, and "Churned" on offboard (history is retained).
export const LIFECYCLE_STAGE = {
  lead: "Lead",
  onboarding: "Onboarding",
  active: "Active",
  paused: "Paused",
  churned: "Churned",
} as const;

// Host onboarding stage (spec §5.2): "Live" once approved to go live.
export const ONBOARDING_STAGE = {
  pendingPricing: "Pending Pricing",
  agreementSent: "Agreement Sent",
  signed: "Signed",
  live: "Live",
} as const;

export const ENTRY_SOURCE = {
  portal: "Partner Portal",
  webhook: "Webhook",
  admin: "Manual Admin Entry",
  backfill: "Backfill",
} as const;

export const PAYROLL_STATUS = {
  pending: "Pending",
  processing: "Processing",
  paid: "Paid",
  failed: "Failed",
} as const;

// ─── Crucial data shared with the GHL contact sync ────────────────────────────
//
// Documents, for auditing, which Airtable field carries each piece of the
// operational truth that the GHL field map (ghl-field-map.ts) also writes.
// This is the alignment contract between the CRM and the revenue-ops base.

export const CRUCIAL_GHL_FIELDS = {
  // Client-level
  leadSource: { airtable: CLIENT_FIELDS.leadSource, ghlKey: "lead_source" },
  lifecycleStage: { airtable: CLIENT_FIELDS.lifecycleStage, ghlKey: "membership_status" },
  serviceZone: { airtable: CLIENT_FIELDS.serviceZone, ghlKey: "market" },
  stripeCustomerId: { airtable: CLIENT_FIELDS.stripeCustomerId, ghlKey: "stripe_customer_id" },
  paymentMethodOnFile: { airtable: CLIENT_FIELDS.paymentMethodOnFile, ghlKey: "default_payment_method" },
  smsOptIn: { airtable: CLIENT_FIELDS.smsOptIn, ghlKey: "sms_opt_in" },
  // Job-level
  jobPaymentStatus: { airtable: JOB_FIELDS.paymentStatus, ghlKey: "payment_status" },
  tierPctLocked: { airtable: JOB_FIELDS.tierPctLocked, ghlKey: "assigned_cleaner_pay_tier" },
  cleanerPayPool: { airtable: JOB_FIELDS.cleanerPayPool, ghlKey: "1_contractor_pay (pool)" },
  payPerCleaner: { airtable: JOB_FIELDS.payPerCleaner, ghlKey: "1_contractor_pay" },
  cleanerName: { airtable: JOB_FIELDS.cleanerName, ghlKey: "1_contractor" },
} as const;
