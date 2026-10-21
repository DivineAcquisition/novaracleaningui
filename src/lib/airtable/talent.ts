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

import {
  APPLICANT_DEPARTMENT,
  APPLICANT_ROLES,
  APPLICANT_STATES,
  AVAILABILITY_OPTIONS,
  CONTRACTOR_TYPES,
  EXPERIENCE_OPTIONS,
  PREFERRED_DAYS,
  TRANSPORTATION_CAR,
  TRANSPORTATION_NONE,
} from "../hiring/application";
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
  governmentId: "fldhOvh9QzQuVd4NN",
  authorizedToWork: "fldUDu31uvFbPd8z9",
  consent1099: "fldetuCODrqo1S9Ax",
  willingToGetSupplies: "flddV4WNeBCFigL4h",
  suppliesOnHand: "fldsj6AneGK4IKatF",
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
  /** Yes / No. Null when the column was empty (older rows). */
  willingToGetSupplies: string | null;
  suppliesOnHand: string | null;
  hasGovernmentId: boolean;
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
    willingToGetSupplies: str(f[TALENT_FIELDS.willingToGetSupplies]),
    suppliesOnHand: str(f[TALENT_FIELDS.suppliesOnHand]),
    hasGovernmentId: Array.isArray(f[TALENT_FIELDS.governmentId]) && (f[TALENT_FIELDS.governmentId] as unknown[]).length > 0,
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

const TALENT_KNOWN_OPTIONS: Record<string, readonly string[]> = {
  [TALENT_FIELDS.role]: APPLICANT_ROLES.map((r) => r.value),
  [TALENT_FIELDS.state]: APPLICANT_STATES.map((s) => s.value),
  [TALENT_FIELDS.contractorType]: CONTRACTOR_TYPES.map((t) => t.value),
  [TALENT_FIELDS.transportation]: [TRANSPORTATION_CAR, TRANSPORTATION_NONE],
  [TALENT_FIELDS.authorizedToWork]: ["Yes", "No"],
  [TALENT_FIELDS.experience]: EXPERIENCE_OPTIONS.map((o) => o.value),
  [TALENT_FIELDS.availability]: AVAILABILITY_OPTIONS.map((o) => o.value),
  [TALENT_FIELDS.preferredDays]: [...PREFERRED_DAYS],
  [TALENT_FIELDS.willingToGetSupplies]: ["Yes", "No"],
  [TALENT_FIELDS.department]: [
    "Sales & Revenue",
    "Operations & Customer Experience",
    "Talent Acquisition",
    APPLICANT_DEPARTMENT,
  ],
};

export interface CreateTalentApplicantInput {
  fullName: string;
  email: string;
  phone?: string | null;
  zipCode?: string | null;
  state?: string | null;
  address?: string | null;
  role?: string | null;
  department?: string | null;
  contractorType?: string | null;
  availability?: string | null;
  experience?: string | null;
  preferredDays?: string[] | null;
  transportation?: string | null;
  authorizedToWork?: string | null;
  consent1099?: boolean | null;
  backgroundCheckConsent?: boolean | null;
  payConsent?: boolean | null;
  willingToGetSupplies?: string | null;
  suppliesOnHand?: string | null;
  reliabilityNote?: string | null;
  notes?: string | null;
  /** Public URL Airtable can download. Written to the photo-ID attachment field. */
  governmentIdUrl?: string | null;
  governmentIdFilename?: string | null;
}

function applicantWriteFields(input: CreateTalentApplicantInput, mode: "create" | "update"): Fields {
  const fields: Fields = {
    [TALENT_FIELDS.contractorName]: input.fullName.trim(),
    [TALENT_FIELDS.email]: input.email.trim().toLowerCase(),
    [TALENT_FIELDS.phone]: input.phone?.trim() || undefined,
    [TALENT_FIELDS.zipCode]: input.zipCode?.trim() || undefined,
    [TALENT_FIELDS.state]: input.state?.trim() || undefined,
    [TALENT_FIELDS.address]: input.address?.trim() || undefined,
    [TALENT_FIELDS.role]: input.role?.trim() || (mode === "create" ? "Independent Cleaner" : undefined),
    [TALENT_FIELDS.department]: input.department?.trim() || undefined,
    [TALENT_FIELDS.contractorType]: input.contractorType?.trim() || undefined,
    [TALENT_FIELDS.availability]: input.availability?.trim() || undefined,
    // Do not trim — the Airtable choice "Somewhat " includes a trailing space.
    [TALENT_FIELDS.experience]: input.experience || undefined,
    [TALENT_FIELDS.preferredDays]: input.preferredDays?.length ? input.preferredDays : undefined,
    [TALENT_FIELDS.transportation]: input.transportation?.trim() || undefined,
    [TALENT_FIELDS.authorizedToWork]: input.authorizedToWork?.trim() || undefined,
    [TALENT_FIELDS.consent1099]: input.consent1099 === true ? true : undefined,
    [TALENT_FIELDS.backgroundCheckConsent]: input.backgroundCheckConsent === true ? true : undefined,
    [TALENT_FIELDS.payConsent]: input.payConsent === true ? true : undefined,
    [TALENT_FIELDS.willingToGetSupplies]: input.willingToGetSupplies?.trim() || undefined,
    [TALENT_FIELDS.suppliesOnHand]: input.suppliesOnHand?.trim() || undefined,
    [TALENT_FIELDS.reliabilityNote]: input.reliabilityNote?.trim() || undefined,
    [TALENT_FIELDS.reasonNote]: input.notes?.trim() || undefined,
    [TALENT_FIELDS.governmentId]: input.governmentIdUrl
      ? [{ url: input.governmentIdUrl, filename: input.governmentIdFilename || "government-id" }]
      : undefined,
  };
  if (mode === "create") {
    fields[TALENT_FIELDS.status] = "Applied";
    fields[TALENT_FIELDS.applicationStatus] = "New";
    fields[TALENT_FIELDS.dateApplied] = new Date().toISOString().slice(0, 10);
  }
  return fields;
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

  const created = await createRecords(TALENT_APPLICANTS_TABLE, [applicantWriteFields(input, "create")], {
    typecast: true,
    knownOptions: TALENT_KNOWN_OPTIONS,
  });
  const rec = created[0];
  if (!rec?.id) throw new Error("Airtable did not return a created record");
  return mapTalentRecord(rec);
}

/** Patch an existing Applicants row. Does not reset Status or Application Status. */
export async function updateTalentApplicantInAirtable(
  recordId: string,
  input: CreateTalentApplicantInput,
): Promise<TalentApplicant> {
  const updated = await updateRecords(
    TALENT_APPLICANTS_TABLE,
    [{ id: recordId, fields: applicantWriteFields(input, "update") }],
    { typecast: true, knownOptions: TALENT_KNOWN_OPTIONS },
  );
  const rec = updated[0];
  if (!rec?.id) throw new Error("Airtable did not return the updated record");
  return mapTalentRecord(rec);
}

/**
 * Courtesy write-back: stamp "Imported" on rows whose Application Status is
 * still New/empty. Never touches rows a human has already moved along.
 */
/** Clear the government-ID attachment. Airtable accepts an empty attachment list. */
export async function clearTalentGovernmentId(recordId: string): Promise<"cleared" | "failed"> {
  try {
    await updateRecords(
      TALENT_APPLICANTS_TABLE,
      [{ id: recordId, fields: { [TALENT_FIELDS.governmentId]: [] } }],
      { typecast: true },
    );
    return "cleared";
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[airtable] clear government id", (err as Error).message);
    return "failed";
  }
}

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
