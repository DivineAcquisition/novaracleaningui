// ─── Talent acquisition intake (Airtable → workspace, ONE-WAY) ────────────────
//
// Fillout applications land in the "NVC | Client & Revenue Ops" base
// (appoUuFQZQfCyKGlw), Applicants table — STRICTLY that base, never the
// Maryland base. That pipeline is untouched — we only READ it and pull
// applicants into public.cleaner_applicants, where the cleaner hub owns the
// rest of the lifecycle. The only write-back is a courtesy marker: rows whose
// "Application Status" is still New/empty get stamped "Imported" so the
// Airtable view shows what's been pulled. Airtable is never the management
// surface.
//
// Fields are referenced by FIELD ID so column renames in the Airtable UI can't
// break the sync.

import { createRecords, listRecords, updateRecords, type AirtableRecord, type Fields } from "./client";

/** Applicants table in the Client & Revenue Ops base (the client's default base). */
export const TALENT_APPLICANTS_TABLE = "tblJQx7JbalZPmlAB";

/** Applicants table fields (base appoUuFQZQfCyKGlw / tblJQx7JbalZPmlAB). */
export const TALENT_FIELDS = {
  contractorName: "fldQi9O7pxyiTQhGc",
  email: "fldR6Jf0Tzu2CaRdZ",
  phone: "fldCfJpafAt4TaWGa",
  address: "fldNFQ76zvG0sSMVV",
  zipCode: "fldochpZ4X2VZwh69",
  state: "fldukAIbNQp2uTgHq",
  status: "fldVn8tK9u7spOWlz", // Applied | No Hire | Hired | Onboarding | Active | Inactive
  applicationStatus: "fldSdsxBLx6kk7gTp", // New | Reviewed | Phone Screen | Background Check | Onboarded | Rejected
  dateApplied: "fldBzslXinV06lIeU",
  role: "fld9qzABmztEmY5s9",
  department: "fldP8UuWqJB42LQFS",
  contractorType: "fldGD4Ul0wzovaIjK",
  transportation: "flddPBlrFUTDyiNz5",
  authorizedToWork: "fldUDu31uvFbPd8z9",
  consent1099: "fldetuCODrqo1S9Ax",
  experience: "fldfXUNb5j2a6ORqc",
  availability: "fldexoUSC7tDn9zch",
  backgroundCheckConsent: "fldDv8iHBIcQGwOOP",
  payConsent: "fldyTNtlEI1kAq8JW",
  reliabilityNote: "fldtAmmCkjBSGCPpE",
  reasonNote: "fldRrFQdeoMb22LuE",
  zone: "fld5U5rRzBtcEsVjG",
  preferredDays: "fldG2FzcxAMUQi3wz",
  rejectionReason: "fldT7o7zsWvdoB0qO",
  lastActivity: "fldbm8w0hi2i7fAbr",
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
    // Prefer the explicit "Date Applied" field; fall back to record creation.
    appliedAt: str(f[TALENT_FIELDS.dateApplied]) || rec.createdTime || null,
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

/** Read every applicant row from the Client & Revenue Ops base. */
export async function fetchTalentApplicants(): Promise<TalentApplicant[]> {
  const records = await listRecords(TALENT_APPLICANTS_TABLE);
  return records.map(mapTalentRecord);
}

export interface CreateTalentApplicantInput {
  fullName: string;
  email: string;
  phone?: string | null;
  zipCode?: string | null;
  state?: string | null;
  address?: string | null;
  role?: string | null;
  availability?: string | null;
  experience?: string | null;
  notes?: string | null;
}

/**
 * Create an Applicants-table row in Airtable (admin manual intake), then return
 * the same mapped shape the sync path uses so the local row can be inserted
 * with a real airtable_record_id.
 */
export async function createTalentApplicantInAirtable(
  input: CreateTalentApplicantInput,
): Promise<TalentApplicant> {
  const fullName = input.fullName.trim();
  const email = input.email.trim().toLowerCase();
  if (!fullName) throw new Error("Name is required");
  if (!email || !email.includes("@")) throw new Error("A valid email is required");

  const fields: Fields = {
    [TALENT_FIELDS.contractorName]: fullName,
    [TALENT_FIELDS.email]: email,
    [TALENT_FIELDS.phone]: input.phone?.trim() || undefined,
    [TALENT_FIELDS.zipCode]: input.zipCode?.trim() || undefined,
    [TALENT_FIELDS.state]: input.state?.trim() || undefined,
    [TALENT_FIELDS.address]: input.address?.trim() || undefined,
    [TALENT_FIELDS.role]: input.role?.trim() || "Independent Cleaner",
    [TALENT_FIELDS.availability]: input.availability?.trim() || undefined,
    [TALENT_FIELDS.experience]: input.experience?.trim() || undefined,
    [TALENT_FIELDS.reasonNote]: input.notes?.trim() || undefined,
    [TALENT_FIELDS.status]: "Applied",
    [TALENT_FIELDS.applicationStatus]: "New",
    [TALENT_FIELDS.dateApplied]: new Date().toISOString().slice(0, 10),
  };

  const created = await createRecords(TALENT_APPLICANTS_TABLE, [fields], { typecast: true });
  const rec = created[0];
  if (!rec?.id) throw new Error("Airtable did not return a created record");
  return mapTalentRecord(rec);
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
    TALENT_APPLICANTS_TABLE,
    toMark.map((r) => ({
      id: r.airtableRecordId,
      fields: { [TALENT_FIELDS.applicationStatus]: "Imported" },
    })),
    { typecast: true },
  );
  return toMark.length;
}
