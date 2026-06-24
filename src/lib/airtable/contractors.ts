// ─── Contractors table in "NVC | Client & Revenue Ops" ───────────────────────
//
// Creates (idempotently) a Contractors table in the Revenue Ops base and syncs
// every cleaner into it with a clear view of their pay (lifetime + this month,
// pulled from the Jobs table), their payroll runs (linked), and their signed
// Independent Contractor Agreement (URL + attached PDF).
//
// Why a new table here (the Contractors table historically lived in the separate
// Maryland base): keeping contractors in THIS base lets us link them to Payroll
// Runs and roll up pay natively. SERVER ONLY (needs AIRTABLE_PAT with
// schema.bases:write).

import {
  createTable,
  createField,
  listBaseTables,
  listTableFields,
  listRecords,
  upsertRecords,
  type CreateFieldSpec,
  type Fields,
} from "./client";
import { JOB_FIELDS, PAYROLL_RUN_FIELDS, TABLES } from "./schema";
import { getAdminSupabase } from "./sources/admin-client";

const TABLE_NAME = "Contractors";

const CHECKBOX = { color: "greenBright", icon: "check" } as const;

// Field definitions (order matters — first is the primary field).
const FIELD_DEFS: CreateFieldSpec[] = [
  { name: "Name", type: "singleLineText" },
  { name: "Email", type: "email" },
  { name: "Phone", type: "phoneNumber" },
  { name: "Status", type: "singleSelect", options: { choices: [{ name: "Active" }, { name: "Paused" }, { name: "Inactive" }] } },
  { name: "Pay Tier", type: "singleSelect", options: { choices: [{ name: "Foundation" }, { name: "Proven" }, { name: "Elite" }] } },
  { name: "Pay %", type: "number", options: { precision: 0 } },
  { name: "Home Address", type: "singleLineText" },
  { name: "City", type: "singleLineText" },
  { name: "State", type: "singleLineText" },
  { name: "ZIP", type: "singleLineText" },
  { name: "Skillset", type: "multilineText" },
  { name: "Stripe Account ID", type: "singleLineText" },
  { name: "Payouts Enabled", type: "checkbox", options: { ...CHECKBOX } },
  { name: "Onboarding Complete", type: "checkbox", options: { ...CHECKBOX } },
  { name: "Agreement Signed", type: "checkbox", options: { ...CHECKBOX } },
  { name: "Agreement Signed Date", type: "date", options: { dateFormat: { name: "local" } } },
  { name: "Agreement Document", type: "url" },
  { name: "Agreement PDF", type: "multipleAttachments" },
  { name: "Lifetime Jobs", type: "number", options: { precision: 0 } },
  { name: "Lifetime Pay", type: "currency", options: { precision: 2, symbol: "$" } },
  { name: "Pay This Month", type: "currency", options: { precision: 2, symbol: "$" } },
  { name: "Last Synced", type: "dateTime", options: { dateFormat: { name: "iso" }, timeFormat: { name: "24hour" }, timeZone: "America/New_York" } },
  { name: "Payroll Runs", type: "multipleRecordLinks", options: { linkedTableId: TABLES.payrollRuns } },
];

export interface ContractorsTableInfo {
  tableId: string;
  /** field name → field id */
  fieldId: Record<string, string>;
  created: boolean;
}

/** Create the Contractors table if missing; return its id + field-id map. */
export async function ensureContractorsTable(): Promise<ContractorsTableInfo> {
  const tables = await listBaseTables();
  let table = tables.find((t) => t.name === TABLE_NAME);
  let created = false;

  if (!table) {
    table = await createTable(TABLE_NAME, FIELD_DEFS, "Cleaning contractors — pay, payroll, and signed agreements.");
    created = true;
  }

  // Map field names → ids (and add any missing fields on re-run).
  let fields = await listTableFields(table.id);
  const haveNames = new Set(fields.map((f) => f.name));
  for (const def of FIELD_DEFS) {
    if (!haveNames.has(def.name)) {
      await createField(table.id, def);
    }
  }
  if (haveNames.size !== FIELD_DEFS.length) {
    fields = await listTableFields(table.id);
  }

  const fieldId: Record<string, string> = {};
  for (const f of fields) fieldId[f.name] = f.id;
  return { tableId: table.id, fieldId, created };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (Array.isArray(v)) return v.map(String).join(", ");
  return String(v);
}
function num(v: unknown): number {
  const n = Number(Array.isArray(v) ? v[0] : v);
  return Number.isFinite(n) ? n : 0;
}
function normName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}
function titleTier(t: string): string {
  const x = (t || "").toLowerCase();
  if (x.startsWith("prov")) return "Proven";
  if (x.startsWith("elite")) return "Elite";
  return "Foundation";
}

interface PayAgg { jobs: number; lifetime: number; thisMonth: number }

export interface ContractorSyncResult {
  ok: true;
  created: boolean;
  contractorsSynced: number;
  withPay: number;
  withAgreement: number;
  warnings: string[];
}

/**
 * Create the table (if needed) and upsert every cleaner with pay + payroll
 * links + agreement. Idempotent (merge on Email).
 */
export async function syncContractors(): Promise<ContractorSyncResult> {
  const info = await ensureContractorsTable();
  const F = info.fieldId;
  const warnings: string[] = [];
  const supabase = getAdminSupabase();

  // 1. Cleaners (the source of truth).
  const { data: cleaners, error: clErr } = await supabase
    .from("cleaners")
    .select(
      "first_name, last_name, email, phone, status, pay_tier, pay_percentage, home_address, home_city, state, home_zip, stripe_account_id, payouts_enabled, onboarding_complete, ob_agreement_signed, ob_agreement_signed_at, skillset",
    );
  if (clErr) throw new Error(`Read cleaners failed: ${clErr.message}`);

  // 2. Pay aggregation from the Airtable Jobs table (matched by cleaner name).
  const payByName = new Map<string, PayAgg>();
  try {
    const jobs = await listRecords(TABLES.jobs);
    const monthPrefix = new Date().toISOString().slice(0, 7);
    for (const j of jobs) {
      const nm = normName(str(j.fields[JOB_FIELDS.cleanerName]));
      if (!nm) continue;
      const pay = num(j.fields[JOB_FIELDS.payPerCleaner]);
      const date = str(j.fields[JOB_FIELDS.dateCompleted]);
      const agg = payByName.get(nm) || { jobs: 0, lifetime: 0, thisMonth: 0 };
      agg.jobs += 1;
      agg.lifetime += pay;
      if (date.slice(0, 7) === monthPrefix) agg.thisMonth += pay;
      payByName.set(nm, agg);
    }
  } catch (e) {
    warnings.push(`Pay aggregation skipped: ${(e as Error).message}`);
  }

  // 3. Payroll Run record ids per cleaner name (for the link field).
  const runsByName = new Map<string, string[]>();
  try {
    const runs = await listRecords(TABLES.payrollRuns);
    for (const r of runs) {
      const nm = normName(str(r.fields[PAYROLL_RUN_FIELDS.cleanerName]));
      if (!nm) continue;
      const list = runsByName.get(nm) || [];
      list.push(r.id);
      runsByName.set(nm, list);
    }
  } catch (e) {
    warnings.push(`Payroll link skipped: ${(e as Error).message}`);
  }

  // 4. Signed contractor agreements (URL + PDF) by email.
  const agreementByEmail = new Map<string, string>();
  try {
    const { data: subs } = await supabase
      .from("docuseal_submissions")
      .select("submitter_email, document_url, signing_url, status")
      .eq("audience", "contractor");
    for (const s of subs || []) {
      const email = String(s.submitter_email || "").toLowerCase();
      const url = (s.document_url as string) || (s.signing_url as string) || "";
      if (email && url && !agreementByEmail.has(email)) agreementByEmail.set(email, url);
    }
  } catch (e) {
    warnings.push(`Agreement lookup skipped: ${(e as Error).message}`);
  }

  // 5. Build + upsert records (merge on Email).
  let withPay = 0;
  let withAgreement = 0;
  const records: Fields[] = [];
  for (const c of cleaners || []) {
    const email = String(c.email || "").trim();
    if (!email) continue;
    const name = `${c.first_name || ""} ${c.last_name || ""}`.trim() || email;
    const nm = normName(name);
    const pay = payByName.get(nm);
    const runs = runsByName.get(nm) || [];
    const agreementUrl = agreementByEmail.get(email.toLowerCase()) || "";
    if (pay) withPay += 1;
    if (agreementUrl) withAgreement += 1;

    const rec: Fields = {
      [F["Name"]]: name,
      [F["Email"]]: email,
      [F["Phone"]]: (c.phone as string) || undefined,
      [F["Status"]]: c.status ? str(c.status).charAt(0).toUpperCase() + str(c.status).slice(1) : "Active",
      [F["Pay Tier"]]: titleTier(c.pay_tier as string),
      [F["Pay %"]]: c.pay_percentage != null ? Number(c.pay_percentage) : undefined,
      [F["Home Address"]]: (c.home_address as string) || undefined,
      [F["City"]]: (c.home_city as string) || undefined,
      [F["State"]]: (c.state as string) || undefined,
      [F["ZIP"]]: (c.home_zip as string) || undefined,
      [F["Skillset"]]: Array.isArray(c.skillset) ? (c.skillset as string[]).join(", ") : undefined,
      [F["Stripe Account ID"]]: (c.stripe_account_id as string) || undefined,
      [F["Payouts Enabled"]]: c.payouts_enabled === true,
      [F["Onboarding Complete"]]: c.onboarding_complete === true,
      [F["Agreement Signed"]]: c.ob_agreement_signed === true,
      [F["Agreement Signed Date"]]: c.ob_agreement_signed_at ? String(c.ob_agreement_signed_at).slice(0, 10) : undefined,
      [F["Lifetime Jobs"]]: pay ? pay.jobs : 0,
      [F["Lifetime Pay"]]: pay ? Math.round(pay.lifetime * 100) / 100 : 0,
      [F["Pay This Month"]]: pay ? Math.round(pay.thisMonth * 100) / 100 : 0,
      [F["Last Synced"]]: new Date().toISOString(),
    };
    if (agreementUrl) {
      rec[F["Agreement Document"]] = agreementUrl;
      // Attachment: Airtable fetches + stores a copy from the URL.
      (rec as Record<string, unknown>)[F["Agreement PDF"]] = [{ url: agreementUrl }];
    }
    if (runs.length) (rec as Record<string, unknown>)[F["Payroll Runs"]] = runs;

    records.push(rec);
  }

  if (records.length) {
    await upsertRecords(info.tableId, [F["Email"]], records);
  }

  return {
    ok: true,
    created: info.created,
    contractorsSynced: records.length,
    withPay,
    withAgreement,
    warnings,
  };
}
