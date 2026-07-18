// ─── VAs (team) table in "NVC | Client & Revenue Ops" ────────────────────────
//
// Creates (idempotently) a "VAs" table in the Revenue Ops base and backlogs
// every VA onboarding record into it — identity, role + pay type, onboarding
// status, signed agreement, and the operational details they submitted.
//
// SERVER ONLY (needs AIRTABLE_PAT with schema.bases:write). Idempotent: merges
// on Email so re-syncing updates rather than duplicating.

import {
  createField,
  createTable,
  listBaseTables,
  listTableFields,
  upsertRecords,
  type CreateFieldSpec,
  type Fields,
} from "./client";
import { getAdminSupabase } from "./sources/admin-client";

const TABLE_NAME = "VAs";
const CHECKBOX = { color: "greenBright", icon: "check" } as const;

const FIELD_DEFS: CreateFieldSpec[] = [
  { name: "Name", type: "singleLineText" },
  { name: "Email", type: "email" },
  { name: "Phone", type: "phoneNumber" },
  {
    name: "Role",
    type: "singleSelect",
    options: { choices: [{ name: "Operations" }, { name: "Sales" }, { name: "Recruiting" }, { name: "All-in-one" }] },
  },
  {
    name: "Pay Type",
    type: "singleSelect",
    options: { choices: [{ name: "Base pay" }, { name: "Hourly" }] },
  },
  {
    name: "Status",
    type: "singleSelect",
    options: {
      choices: [
        { name: "Invited" }, { name: "Started" }, { name: "Signed" },
        { name: "Submitted" }, { name: "Approved" }, { name: "Rejected" }, { name: "Offboarded" },
      ],
    },
  },
  { name: "Agreement Signed", type: "checkbox", options: { ...CHECKBOX } },
  { name: "Agreement Signed Date", type: "date", options: { dateFormat: { name: "local" } } },
  { name: "Timezone", type: "singleLineText" },
  { name: "Working Hours", type: "singleLineText" },
  { name: "Experience", type: "multilineText" },
  { name: "Tools", type: "multilineText" },
  { name: "Notes", type: "multilineText" },
  { name: "GHL User ID", type: "singleLineText" },
  { name: "Applied", type: "date", options: { dateFormat: { name: "local" } } },
  { name: "Submitted", type: "date", options: { dateFormat: { name: "local" } } },
  { name: "Approved", type: "date", options: { dateFormat: { name: "local" } } },
  { name: "Last Synced", type: "dateTime", options: { dateFormat: { name: "iso" }, timeFormat: { name: "24hour" }, timeZone: "America/New_York" } },
];

export interface VasTableInfo {
  tableId: string;
  fieldId: Record<string, string>;
  created: boolean;
}

/** Create the VAs table if missing; return its id + field-id map. */
export async function ensureVasTable(): Promise<VasTableInfo> {
  const tables = await listBaseTables();
  let table = tables.find((t) => t.name === TABLE_NAME);
  let created = false;

  if (!table) {
    table = await createTable(TABLE_NAME, FIELD_DEFS, "Virtual assistants — onboarding, agreement, role & pay type.");
    created = true;
  }

  let fields = await listTableFields(table.id);
  const haveNames = new Set(fields.map((f) => f.name));
  let addedAny = false;
  for (const def of FIELD_DEFS) {
    if (!haveNames.has(def.name)) {
      await createField(table.id, def);
      addedAny = true;
    }
  }
  if (addedAny) fields = await listTableFields(table.id);

  const fieldId: Record<string, string> = {};
  for (const f of fields) fieldId[f.name] = f.id;
  return { tableId: table.id, fieldId, created };
}

const ROLE_LABEL: Record<string, string> = {
  operations: "Operations",
  sales: "Sales",
  recruiting: "Recruiting",
  all: "All-in-one",
};

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const dateOnly = (v: unknown) => (v ? String(v).slice(0, 10) : undefined);

export interface VaSyncResult {
  ok: true;
  created: boolean;
  vasSynced: number;
  signed: number;
  warnings: string[];
}

/** Create the table (if needed) and upsert every VA onboarding row (merge on Email). */
export async function syncVas(): Promise<VaSyncResult> {
  const info = await ensureVasTable();
  const F = info.fieldId;
  const warnings: string[] = [];
  const supabase = getAdminSupabase();

  const { data: rows, error } = await supabase
    .from("va_onboarding")
    .select(
      "email, first_name, last_name, phone, va_role, pay_type, status, agreement_signed_at, timezone, working_hours, experience, tools, notes, ghl_user_id, created_at, submitted_at, approved_at",
    );
  if (error) throw new Error(`Read va_onboarding failed: ${error.message}`);

  let signed = 0;
  const records: Fields[] = [];
  for (const v of rows || []) {
    const email = String(v.email || "").trim();
    if (!email) continue;
    const name = `${v.first_name || ""} ${v.last_name || ""}`.trim() || email;
    if (v.agreement_signed_at) signed += 1;

    records.push({
      [F["Name"]]: name,
      [F["Email"]]: email,
      [F["Phone"]]: (v.phone as string) || undefined,
      [F["Role"]]: ROLE_LABEL[String(v.va_role || "").toLowerCase()] || undefined,
      [F["Pay Type"]]: String(v.pay_type || "base") === "hourly" ? "Hourly" : "Base pay",
      [F["Status"]]: cap(String(v.status || "")),
      [F["Agreement Signed"]]: !!v.agreement_signed_at,
      [F["Agreement Signed Date"]]: dateOnly(v.agreement_signed_at),
      [F["Timezone"]]: (v.timezone as string) || undefined,
      [F["Working Hours"]]: (v.working_hours as string) || undefined,
      [F["Experience"]]: (v.experience as string) || undefined,
      [F["Tools"]]: (v.tools as string) || undefined,
      [F["Notes"]]: (v.notes as string) || undefined,
      [F["GHL User ID"]]: (v.ghl_user_id as string) || undefined,
      [F["Applied"]]: dateOnly(v.created_at),
      [F["Submitted"]]: dateOnly(v.submitted_at),
      [F["Approved"]]: dateOnly(v.approved_at),
      [F["Last Synced"]]: new Date().toISOString(),
    });
  }

  if (records.length) {
    await upsertRecords(info.tableId, [F["Email"]], records);
  }

  return { ok: true, created: info.created, vasSynced: records.length, signed, warnings };
}
