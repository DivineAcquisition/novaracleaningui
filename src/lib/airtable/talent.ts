// ─── Talent acquisition intake (Airtable → workspace, ONE-WAY) ────────────────
//
// Fillout applications land in the "NVC™ | Maryland" base (app0jCdQHXOvItVPo),
// Contractors table. That pipeline is untouched — we only READ it and pull
// applicants into public.cleaner_applicants, where the cleaner hub owns the
// rest of the lifecycle. The only write-back is a courtesy marker: rows whose
// "Application Status" is still New/empty get stamped "Imported" so the
// Airtable view shows what's been pulled. Airtable is never the management
// surface.
//
// Fields are referenced by FIELD ID so column renames in the Airtable UI can't
// break the sync.

import { listRecords, updateRecords, type AirtableRecord } from "./client";

export const TALENT_BASE_ID = "app0jCdQHXOvItVPo";
export const TALENT_CONTRACTORS_TABLE = "tblGrwPqdCStDUwIb";

/** Contractors table fields (base app0jCdQHXOvItVPo). */
export const TALENT_FIELDS = {
  contractorName: "fldcVQK2pAwMaAUu0",
  email: "fldlYCZXvyctgJQ6m",
  phone: "fldls5utZfALvY5wB",
  address: "fldcAQDQaKgDexJlb",
  zipCode: "fldnmlPcQpm7QBByq",
  state: "fldN6Jk74QyPawpoH",
  status: "fldR5EjGkOuIZyyX4", // Applied | No Hire | Hired | Onboarding | Active | Inactive
  applicationStatus: "fldGLCkJr9kNs70zm", // New | Reviewed | Phone Screen | Background Check | Onboarded | Rejected
  role: "fld6rqUC9No36HzYE",
  department: "fldGZGUYuwarzXSfY",
  contractorType: "fldZodJ61966tk9Xi",
  transportation: "fldg9EPYhGsPqNQ3i",
  authorizedToWork: "fldor1XUZwPYHYD17",
  consent1099: "fldeo5GqcGbtPWcQb",
  experience: "fldl0XeanKINA87EN",
  availability: "fldkhJlQVU8dqI4t0",
  backgroundCheckConsent: "fldsHEGuGTj83zBJd",
  payConsent: "fldMum1EtP7GrJbqs",
  reliabilityNote: "fldFvWSnyCsCj27Ce",
  reasonNote: "fldVvaLT5jMaGODRo",
  zone: "fldxfwnMu7EzUShJI",
  preferredDays: "fldp5tzKTyYO49G5P",
  rejectionReason: "fldrAagMV5dbgWapD",
  lastActivity: "fld6r70UFKwZTBQfH",
} as const;

export interface TalentApplicant {
  airtableRecordId: string;
  email: string | null;
  phone: string | null;
  fullName: string | null;
  firstName: string | null;
  lastName: string | null;
  address: string | null;
  zipCode: string | null;
  state: string | null;
  zone: string | null;
  role: string | null;
  department: string | null;
  contractorType: string | null;
  experience: string | null;
  availability: string | null;
  preferredDays: string[];
  transportation: string | null;
  authorizedToWork: string | null;
  consent1099: boolean | null;
  backgroundCheckConsent: boolean | null;
  payConsent: boolean | null;
  reliabilityNote: string | null;
  reasonNote: string | null;
  /** Airtable pipeline status — used ONLY to infer the initial stage on first import. */
  airtableStatus: string | null;
  airtableApplicationStatus: string | null;
  appliedAt: string | null;
  lastModified: string | null;
  /** Full raw fields snapshot (keyed by field id) for the detail view. */
  submission: Record<string, unknown>;
}

const str = (v: unknown): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s || null;
};

const bool = (v: unknown): boolean | null => (v === undefined || v === null ? null : Boolean(v));

function splitName(full: string | null): { first: string | null; last: string | null } {
  if (!full) return { first: null, last: null };
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: null };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/** Attachments in the raw snapshot get reduced to name+url so the jsonb stays small. */
function compactSubmission(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v) && v.length > 0 && typeof v[0] === "object" && v[0] !== null && "url" in (v[0] as object)) {
      out[k] = (v as Array<{ filename?: string; url?: string }>).map((a) => ({
        filename: a.filename,
        url: a.url,
      }));
    } else {
      out[k] = v;
    }
  }
  return out;
}

export function mapTalentRecord(rec: AirtableRecord): TalentApplicant {
  const f = rec.fields || {};
  const fullName = str(f[TALENT_FIELDS.contractorName]);
  const { first, last } = splitName(fullName);
  const days = f[TALENT_FIELDS.preferredDays];
  return {
    airtableRecordId: rec.id,
    email: str(f[TALENT_FIELDS.email])?.toLowerCase() ?? null,
    phone: str(f[TALENT_FIELDS.phone]),
    fullName,
    firstName: first,
    lastName: last,
    address: str(f[TALENT_FIELDS.address]),
    zipCode: str(f[TALENT_FIELDS.zipCode]),
    state: str(f[TALENT_FIELDS.state]),
    zone: str(f[TALENT_FIELDS.zone]),
    role: str(f[TALENT_FIELDS.role]),
    department: str(f[TALENT_FIELDS.department]),
    contractorType: str(f[TALENT_FIELDS.contractorType]),
    experience: str(f[TALENT_FIELDS.experience]),
    availability: str(f[TALENT_FIELDS.availability]),
    preferredDays: Array.isArray(days) ? days.map((d) => String(d)) : [],
    transportation: str(f[TALENT_FIELDS.transportation]),
    authorizedToWork: str(f[TALENT_FIELDS.authorizedToWork]),
    consent1099: bool(f[TALENT_FIELDS.consent1099]),
    backgroundCheckConsent: bool(f[TALENT_FIELDS.backgroundCheckConsent]),
    payConsent: bool(f[TALENT_FIELDS.payConsent]),
    reliabilityNote: str(f[TALENT_FIELDS.reliabilityNote]),
    reasonNote: str(f[TALENT_FIELDS.reasonNote]),
    airtableStatus: str(f[TALENT_FIELDS.status]),
    airtableApplicationStatus: str(f[TALENT_FIELDS.applicationStatus]),
    appliedAt: rec.createdTime || null,
    lastModified: str(f[TALENT_FIELDS.lastActivity]),
    submission: compactSubmission(f),
  };
}

/**
 * Initial pipeline stage for a record seen for the FIRST time, inferred from
 * where the Airtable pipeline already had them. After import the app owns the
 * stage — subsequent syncs never move it.
 */
export function initialStageFromAirtable(a: TalentApplicant): string {
  switch ((a.airtableStatus || "").toLowerCase()) {
    case "no hire":
      return "rejected";
    case "hired":
    case "onboarding":
      return "onboarding";
    case "active":
      return "active";
    case "inactive":
      return "withdrawn";
    default:
      return "applicant";
  }
}

/** Read every applicant row from the talent base. */
export async function fetchTalentApplicants(): Promise<TalentApplicant[]> {
  const records = await listRecords(TALENT_CONTRACTORS_TABLE, { baseId: TALENT_BASE_ID });
  return records.map(mapTalentRecord);
}

/**
 * Courtesy write-back: stamp "Imported" on rows whose Application Status is
 * still New/empty. Never touches rows a human has already moved along.
 */
export async function markImported(records: TalentApplicant[]): Promise<number> {
  const toMark = records.filter((r) => {
    const s = (r.airtableApplicationStatus || "").toLowerCase();
    return s === "" || s === "new";
  });
  if (toMark.length === 0) return 0;
  await updateRecords(
    TALENT_CONTRACTORS_TABLE,
    toMark.map((r) => ({
      id: r.airtableRecordId,
      fields: { [TALENT_FIELDS.applicationStatus]: "Imported" },
    })),
    { baseId: TALENT_BASE_ID, typecast: true },
  );
  return toMark.length;
}
