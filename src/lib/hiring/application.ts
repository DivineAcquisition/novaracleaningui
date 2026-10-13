// ─── Public applicant intake ────────────────────────────────────────────────
//
// Mirrors the fields a new row in Airtable Applicants
// (appoUuFQZQfCyKGlw / tblJQx7JbalZPmlAB) is created with, plus two supply
// questions added for this form:
//   • Willing To Get Supplies (single select Yes / No) — must be Yes
//   • Supplies Currently Have (long text) — only after Yes
//
// Choice `value`s are the Airtable option strings. "Somewhat " keeps the
// trailing space Airtable stored on that choice (length 9). Trimming it
// would create a second option.

export const APPLICANT_ID_BUCKET = "applicant-ids";
export const GOVERNMENT_ID_FIELD_ID = "fldhOvh9QzQuVd4NN";
export const APPLICANT_DEPARTMENT = "Service Delivery";
export const ID_MAX_BYTES = 4_000_000;

/** Airtable choice is the word Somewhat plus one trailing space. */
export const EXPERIENCE_SOMEWHAT = "Somewhat ";

export const TRANSPORTATION_CAR = "Yes (Own A Vehicle)";
export const TRANSPORTATION_NONE = "No Transportation";

export const APPLICANT_ROLES = [
  {
    value: "Field Cleaner (Contractor)",
    label: "Field Cleaner",
    hint: "Residential homes across the DMV",
  },
  {
    value: "Lead Cleaner (Contractor)",
    label: "Lead Cleaner",
    hint: "Run the job and set the standard on site",
  },
  {
    value: "Specialized Contractor",
    label: "Specialized Contractor",
    hint: "Deep cleans, move-outs, and specialty work",
  },
  {
    value: "Company",
    label: "Cleaning company",
    hint: "You bring a crew",
  },
] as const;

export const CONTRACTOR_TYPES = [
  { value: "Individual", label: "Just me", hint: "I clean the jobs myself" },
  { value: "Company", label: "A company", hint: "I have a crew or a business" },
] as const;

export const APPLICANT_STATES = [
  { value: "Maryland", label: "Maryland" },
  { value: "Virginia", label: "Virginia" },
  { value: "DC", label: "Washington, DC" },
  { value: "New York", label: "New York" },
] as const;

export const EXPERIENCE_OPTIONS = [
  { value: "Yes 1yr+", label: "Yes — a year or more" },
  { value: EXPERIENCE_SOMEWHAT, label: "Some experience" },
  { value: "Not At All", label: "Not yet" },
] as const;

export const AVAILABILITY_OPTIONS = [
  { value: "Full-Time", label: "Full-time" },
  { value: "Anytime When Need", label: "Whenever you need me" },
  { value: "Weekdays Only", label: "Weekdays only" },
  { value: "Weekends Only", label: "Weekends only" },
] as const;

export const PREFERRED_DAYS = ["Mon", "Tues", "Wed", "Thur", "Fri", "Sat", "Sun"] as const;

export const DAY_LABEL: Record<(typeof PREFERRED_DAYS)[number], string> = {
  Mon: "Monday",
  Tues: "Tuesday",
  Wed: "Wednesday",
  Thur: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

export type ApplicantRole = (typeof APPLICANT_ROLES)[number]["value"];
export type ApplicantState = (typeof APPLICANT_STATES)[number]["value"];
export type ContractorType = (typeof CONTRACTOR_TYPES)[number]["value"];
export type PreferredDay = (typeof PREFERRED_DAYS)[number];

export type ApplicationStep =
  | "role"
  | "name"
  | "email"
  | "phone"
  | "address"
  | "zip"
  | "state"
  | "contractorType"
  | "car"
  | "id"
  | "authorized"
  | "experience"
  | "availability"
  | "days"
  | "consent1099"
  | "consentBg"
  | "consentPay"
  | "supplies"
  | "suppliesOnHand"
  | "reliability"
  | "reason"
  | "review";

const BASE_STEPS: ApplicationStep[] = [
  "role",
  "name",
  "email",
  "phone",
  "address",
  "zip",
  "state",
  "contractorType",
  "car",
  "id",
  "authorized",
  "experience",
  "availability",
  "days",
  "consent1099",
  "consentBg",
  "consentPay",
  "supplies",
];

export function visibleSteps(willingToGetSupplies: string): ApplicationStep[] {
  const steps = [...BASE_STEPS];
  if (willingToGetSupplies === "Yes") steps.push("suppliesOnHand");
  steps.push("reliability", "reason", "review");
  return steps;
}

export interface HiringApplicationDraft {
  role: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  zipCode: string;
  state: string;
  contractorType: string;
  transportation: string;
  authorizedToWork: string;
  experience: string;
  availability: string;
  preferredDays: string[];
  consent1099: boolean;
  backgroundCheckConsent: boolean;
  payConsent: boolean;
  willingToGetSupplies: string;
  suppliesOnHand: string;
  reliabilityNote: string;
  reasonNote: string;
  idConfirmed: boolean;
  idFile: { name: string; type: string; size: number } | null;
  hiringRole?: string | null;
}

export interface NormalizedHiringApplication {
  fullName: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  zipCode: string;
  state: ApplicantState;
  role: ApplicantRole;
  contractorType: ContractorType;
  transportation: typeof TRANSPORTATION_CAR;
  authorizedToWork: "Yes";
  experience: (typeof EXPERIENCE_OPTIONS)[number]["value"];
  availability: (typeof AVAILABILITY_OPTIONS)[number]["value"];
  preferredDays: PreferredDay[];
  consent1099: true;
  backgroundCheckConsent: true;
  payConsent: true;
  willingToGetSupplies: "Yes";
  suppliesOnHand: string;
  reliabilityNote: string;
  reasonNote: string;
  department: typeof APPLICANT_DEPARTMENT;
  hiringRole: string | null;
  idContentType: string;
}

export type ApplicationIssue = {
  ok: false;
  status: 400 | 422;
  error: string;
  code: string;
  /** Hard stop: the person cannot continue this application. */
  gate: boolean;
};

export type ApplicationResult =
  | { ok: true; value: NormalizedHiringApplication }
  | ApplicationIssue;

/** strictNullChecks is off in this project, so `!result.ok` does not narrow. */
export function isApplicationIssue(result: ApplicationResult): result is ApplicationIssue {
  return result.ok === false;
}

const ALLOWED_ID_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

const EXT_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".pdf": "application/pdf",
};

export function presetRoleForHiringPage(roleId: string | null | undefined): ApplicantRole {
  if (roleId === "specialized-contractors") return "Specialized Contractor";
  return "Field Cleaner (Contractor)";
}

export function hiringIntentNote(roleId: string | null | undefined): string | null {
  if (roleId === "commercial-cleaner") {
    return "Commercial routes are filled from this same application when demand opens. Pick the role that matches how you work.";
  }
  if (roleId === "specialized-contractors") {
    return "Specialty work is an active list — we reach out when a deep clean or move-out opens near you.";
  }
  return null;
}

export function optionLabel<T extends { value: string; label: string }>(
  options: readonly T[],
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const hit = options.find((o) => o.value === value || o.value.trim() === value.trim());
  return hit?.label || value.trim() || null;
}

export function experienceLabel(value: string | null | undefined): string | null {
  return optionLabel(EXPERIENCE_OPTIONS, value);
}

export function availabilityLabel(value: string | null | undefined): string | null {
  return optionLabel(AVAILABILITY_OPTIONS, value);
}

export function roleLabel(value: string | null | undefined): string | null {
  return optionLabel(APPLICANT_ROLES, value);
}

export function gateCopy(code: string): { title: string; body: string } {
  switch (code) {
    case "no_car":
      return {
        title: "A car is required",
        body: "A car is the only transportation we can accept. You need to drive yourself to each job — rideshare, transit, and borrowing a car don’t qualify. If that changes, you’re welcome to apply again.",
      };
    case "not_authorized":
      return {
        title: "Work authorization is required",
        body: "This role is only open to people who are legally authorized to work in the United States.",
      };
    case "not_willing_supplies":
      return {
        title: "Supplies are part of the role",
        body: "Independent contractors bring their own supplies. We can only move forward with people who are willing to get what a job needs.",
      };
    case "missing_consent":
      return {
        title: "We need that agreement to continue",
        body: "All three are required before we can review an application: 1099 contractor status, a background check, and the pay structure.",
      };
    default:
      return {
        title: "We can’t continue this application",
        body: "One of the requirements for this role wasn’t met.",
      };
  }
}

export function phoneDigits(value: string | null | undefined): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits;
}

export function toE164Us(value: string | null | undefined): string | null {
  const digits = phoneDigits(value);
  if (digits.length !== 10) return null;
  return `+1${digits}`;
}

function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function multiLine(value: string): string {
  return value.replace(/\r\n/g, "\n").trim().replace(/\n{3,}/g, "\n\n");
}

export function idContentType(name: string, type: string): string | null {
  const mime = type === "image/jpg" ? "image/jpeg" : type.toLowerCase();
  if (ALLOWED_ID_MIME.has(mime)) return mime;
  const ext = name.toLowerCase().match(/\.[a-z0-9]+$/)?.[0] || "";
  return EXT_MIME[ext] || null;
}

export function safeIdFilename(name: string): string {
  const cleaned = name
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(-80);
  return cleaned || "government-id";
}

function issue(status: 400 | 422, code: string, error: string, gate = false): ApplicationIssue {
  return { ok: false, status, error, code, gate };
}

function includesValue<T extends { value: string }>(options: readonly T[], value: string): boolean {
  return options.some((o) => o.value === value);
}

/** Validate a single step. `review` runs the full application. */
export function issuesForStep(step: ApplicationStep, draft: HiringApplicationDraft): ApplicationIssue | null {
  switch (step) {
    case "role":
      if (!includesValue(APPLICANT_ROLES, draft.role)) {
        return issue(400, "invalid_role", "Choose the role you’re applying for.");
      }
      return null;
    case "name": {
      const first = oneLine(draft.firstName);
      const last = oneLine(draft.lastName);
      if (first.length < 2) return issue(400, "missing_name", "Enter your first name.");
      if (last.length < 2) return issue(400, "missing_name", "Enter your last name.");
      if (first.length > 80 || last.length > 80) {
        return issue(400, "missing_name", "Use the name that’s on your ID — up to 80 characters each.");
      }
      return null;
    }
    case "email": {
      const email = draft.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
        return issue(400, "invalid_email", "Enter a valid email address.");
      }
      return null;
    }
    case "phone":
      if (!toE164Us(draft.phone)) {
        return issue(400, "invalid_phone", "Enter a 10-digit US phone number.");
      }
      return null;
    case "address": {
      const address = oneLine(draft.address);
      if (address.length < 5) return issue(400, "missing_address", "Enter your street address.");
      if (address.length > 200) return issue(400, "missing_address", "Keep the address under 200 characters.");
      return null;
    }
    case "zip":
      if (!/^\d{5}$/.test(draft.zipCode.trim())) {
        return issue(400, "invalid_zip", "Enter a 5-digit ZIP code.");
      }
      return null;
    case "state":
      if (!includesValue(APPLICANT_STATES, draft.state)) {
        return issue(400, "invalid_state", "Choose Maryland, Virginia, DC, or New York.");
      }
      return null;
    case "contractorType":
      if (!includesValue(CONTRACTOR_TYPES, draft.contractorType)) {
        return issue(400, "invalid_contractor_type", "Tell us if you’re applying as yourself or as a company.");
      }
      return null;
    case "car":
      if (!draft.transportation) return issue(400, "missing_car", "Tell us whether you have a car.");
      if (draft.transportation !== TRANSPORTATION_CAR) {
        return issue(422, "no_car", gateCopy("no_car").body, true);
      }
      return null;
    case "id":
      return idIssue(draft);
    case "authorized":
      if (!draft.authorizedToWork) {
        return issue(400, "missing_authorization", "Tell us whether you’re authorized to work in the U.S.");
      }
      if (draft.authorizedToWork !== "Yes") {
        return issue(422, "not_authorized", gateCopy("not_authorized").body, true);
      }
      return null;
    case "experience":
      if (!includesValue(EXPERIENCE_OPTIONS, draft.experience)) {
        return issue(400, "invalid_experience", "Choose the experience that fits you.");
      }
      return null;
    case "availability":
      if (!includesValue(AVAILABILITY_OPTIONS, draft.availability)) {
        return issue(400, "invalid_availability", "Choose the availability that fits you.");
      }
      return null;
    case "days": {
      const days = draft.preferredDays.filter((d) =>
        (PREFERRED_DAYS as readonly string[]).includes(d),
      );
      if (days.length === 0) return issue(400, "missing_days", "Pick at least one day you can work.");
      return null;
    }
    case "consent1099":
      if (!draft.consent1099) {
        return issue(422, "missing_consent", gateCopy("missing_consent").body, true);
      }
      return null;
    case "consentBg":
      if (!draft.backgroundCheckConsent) {
        return issue(422, "missing_consent", gateCopy("missing_consent").body, true);
      }
      return null;
    case "consentPay":
      if (!draft.payConsent) {
        return issue(422, "missing_consent", gateCopy("missing_consent").body, true);
      }
      return null;
    case "supplies":
      if (!draft.willingToGetSupplies) {
        return issue(400, "missing_supplies", "Tell us whether you’re willing to get supplies.");
      }
      if (draft.willingToGetSupplies !== "Yes") {
        return issue(422, "not_willing_supplies", gateCopy("not_willing_supplies").body, true);
      }
      return null;
    case "suppliesOnHand": {
      const supplies = multiLine(draft.suppliesOnHand);
      if (supplies.length < 2) {
        return issue(400, "missing_supplies_list", "List what you already have. If you’re starting from scratch, write “none yet.”");
      }
      if (supplies.length > 2000) {
        return issue(400, "missing_supplies_list", "Keep the supply list under 2,000 characters.");
      }
      return null;
    }
    case "reliability": {
      const note = oneLine(draft.reliabilityNote);
      if (note.length < 2) return issue(400, "missing_reliability", "Tell us a bit about your reliability.");
      if (note.length > 1000) return issue(400, "missing_reliability", "Keep this to a few sentences (1,000 characters).");
      return null;
    }
    case "reason": {
      const note = oneLine(draft.reasonNote);
      if (note.length < 2) return issue(400, "missing_reason", "Tell us why you want to join Novara.");
      if (note.length > 1000) return issue(400, "missing_reason", "Keep this to a few sentences (1,000 characters).");
      return null;
    }
    case "review":
      return null;
    default:
      return null;
  }
}

function idIssue(draft: HiringApplicationDraft): ApplicationIssue | null {
  if (!draft.idFile) return issue(400, "missing_id", "Upload a photo or PDF of your government-issued photo ID.");
  if (!draft.idConfirmed) {
    return issue(400, "missing_id", "Confirm this is a current, unexpired government-issued photo ID.");
  }
  if (draft.idFile.size <= 0) return issue(400, "invalid_id", "That file is empty. Upload the ID again.");
  if (draft.idFile.size > ID_MAX_BYTES) {
    return issue(400, "invalid_id", "ID photos need to be 4 MB or smaller.");
  }
  if (!idContentType(draft.idFile.name, draft.idFile.type)) {
    return issue(400, "invalid_id", "Upload a JPG, PNG, WEBP, HEIC, or PDF.");
  }
  return null;
}

export function validateHiringApplication(draft: HiringApplicationDraft): ApplicationResult {
  const steps = visibleSteps(draft.willingToGetSupplies);
  for (const step of steps) {
    if (step === "review") continue;
    const found = issuesForStep(step, draft);
    if (found) return found;
  }

  const firstName = oneLine(draft.firstName);
  const lastName = oneLine(draft.lastName);
  const supplies = multiLine(draft.suppliesOnHand);
  const contentType = idContentType(draft.idFile!.name, draft.idFile!.type)!;

  return {
    ok: true,
    value: {
      fullName: `${firstName} ${lastName}`,
      firstName,
      lastName,
      email: draft.email.trim().toLowerCase(),
      phone: toE164Us(draft.phone)!,
      address: oneLine(draft.address),
      zipCode: draft.zipCode.trim(),
      state: draft.state as ApplicantState,
      role: draft.role as ApplicantRole,
      contractorType: draft.contractorType as ContractorType,
      transportation: TRANSPORTATION_CAR,
      authorizedToWork: "Yes",
      experience: draft.experience as NormalizedHiringApplication["experience"],
      availability: draft.availability as NormalizedHiringApplication["availability"],
      preferredDays: PREFERRED_DAYS.filter((d) => draft.preferredDays.includes(d)),
      consent1099: true,
      backgroundCheckConsent: true,
      payConsent: true,
      willingToGetSupplies: "Yes",
      suppliesOnHand: supplies,
      reliabilityNote: oneLine(draft.reliabilityNote),
      reasonNote: oneLine(draft.reasonNote),
      department: APPLICANT_DEPARTMENT,
      hiringRole: draft.hiringRole?.trim() || null,
      idContentType: contentType,
    },
  };
}
