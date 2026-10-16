import { postalStateCode } from "@/lib/us-states";

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

/** Bump when the wording on the application changes. Stored with every submission. */
export const CONSENT_VERSION = "2026-10-15";

export const PRIVACY_POLICY_URL = "https://novaracleaning.com/privacy";

export const AGE_18_COPY = "I am 18 or older.";

export const LICENSE_COPY = "I have a valid driver’s license.";

export const AUTO_INSURED_COPY = "The car I will drive to jobs is insured.";

export const SMS_CONSENT_COPY =
  "I agree that Novara may text and call this number about my application. Those messages are occasional, about this application only. Reply STOP to opt out of texts. Message and data rates may apply.";

export const ID_PURPOSE_COPY =
  "We keep this photo only to confirm you are the person applying. Only Novara hiring staff can open it. This is not an employment-eligibility form (not an I-9). Do not upload a Social Security card, a Social Security number, or immigration documents.";

export const ID_CONFIRM_COPY =
  "This is my current, unexpired government-issued photo ID. I understand it is kept only to confirm my identity.";

export const CONSENT_1099_INTRO =
  "You work with Novara as an independent contractor, not as a W-2 employee. Novara does not withhold taxes, and you are not on payroll or benefits. You accept jobs, bring your own supplies, and get paid for completed work. At tax time you file your own return. If your pay for the year meets the IRS threshold, we file a 1099-NEC that reports what we paid you — you use that form when you file.";

/** One sentence. The full covenant, including damages, is read at screening and signed in the agreement. */
export const NON_SOLICIT_EXPECTATION =
  "If you are offered work, the contractor agreement includes a 24-month client non-solicitation covenant: during the engagement, and for 24 months after it ends, you don’t solicit or clean for clients you met through Novara.";

export const CONFIDENTIALITY_EXPECTATION =
  "Client names, addresses, and door codes stay confidential, and photos of client homes do not go on social media.";

export const INSURANCE_EXPECTATION =
  "Novara maintains commercial general liability insurance for assigned jobs. You are responsible for your own car insurance. Any other insurance the contractor agreement requires is confirmed before you are offered work.";

export const CONSENT_1099_LABEL =
  "I understand this is 1099 contractor work, not employment, that I handle my own taxes, and that the client, confidentiality, and insurance expectations on this page apply if I am offered work.";

export const BACKGROUND_DISCLOSURE =
  "Before anyone is offered work, Novara may obtain a consumer report that includes a criminal-history check and a driving record. We may decline an application based on that report. This page is the disclosure only. A separate signed authorization, required by the Fair Credit Reporting Act, is collected immediately before a check is ordered. Nothing is assigned until the check clears.";

export const BACKGROUND_CONSENT_COPY =
  "I have read this disclosure. I understand a criminal-history check and a driving-record check may be run, that Novara may decline me based on the report, and that I will sign a separate authorization immediately before any check is ordered.";

export const PAY_CONSENT_COPY = "I’m comfortable starting at 40–45% of each job.";

export const TRUTHFULNESS_COPY = "My answers on this application are true and complete.";

export interface HiringConsentTexts {
  age18: string;
  validDriversLicense: string;
  autoInsured: string;
  smsConsent: string;
  idPurpose: string;
  idConfirmed: string;
  privacyPolicyUrl: string;
  consent1099Intro: string;
  nonSolicitation: string;
  confidentiality: string;
  insurance: string;
  consent1099: string;
  backgroundDisclosure: string;
  backgroundConsent: string;
  payConsent: string;
  truthfulness: string;
}

export interface HiringConsentRecord {
  version: string;
  acceptedAt: string;
  ip: string | null;
  userAgent: string | null;
  age18: true;
  validDriversLicense: true;
  autoInsured: true;
  smsConsent: true;
  idConfirmed: true;
  consent1099: true;
  backgroundCheckConsent: true;
  payConsent: true;
  answersAccurate: true;
  texts: HiringConsentTexts;
}

export function hiringConsentTexts(): HiringConsentTexts {
  return {
    age18: AGE_18_COPY,
    validDriversLicense: LICENSE_COPY,
    autoInsured: AUTO_INSURED_COPY,
    smsConsent: SMS_CONSENT_COPY,
    idPurpose: ID_PURPOSE_COPY,
    idConfirmed: ID_CONFIRM_COPY,
    privacyPolicyUrl: PRIVACY_POLICY_URL,
    consent1099Intro: CONSENT_1099_INTRO,
    nonSolicitation: NON_SOLICIT_EXPECTATION,
    confidentiality: CONFIDENTIALITY_EXPECTATION,
    insurance: INSURANCE_EXPECTATION,
    consent1099: CONSENT_1099_LABEL,
    backgroundDisclosure: BACKGROUND_DISCLOSURE,
    backgroundConsent: BACKGROUND_CONSENT_COPY,
    payConsent: PAY_CONSENT_COPY,
    truthfulness: TRUTHFULNESS_COPY,
  };
}

/** Exact wording the applicant agreed to, plus when and from where. */
export function buildHiringConsentRecord(meta: {
  acceptedAt: string;
  ip?: string | null;
  userAgent?: string | null;
}): HiringConsentRecord {
  return {
    version: CONSENT_VERSION,
    acceptedAt: meta.acceptedAt,
    ip: meta.ip?.trim() || null,
    userAgent: meta.userAgent?.trim().slice(0, 500) || null,
    age18: true,
    validDriversLicense: true,
    autoInsured: true,
    smsConsent: true,
    idConfirmed: true,
    consent1099: true,
    backgroundCheckConsent: true,
    payConsent: true,
    answersAccurate: true,
    texts: hiringConsentTexts(),
  };
}

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

/** States Novara currently hires in. Texas and California are not on this list. */
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
  | "age"
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
  "contractorType",
  "car",
  "id",
  "authorized",
  "age",
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
  city: string;
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
  age18: boolean;
  validDriversLicense: boolean;
  autoInsured: boolean;
  smsConsent: boolean;
  answersAccurate: boolean;
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
  age18: true;
  validDriversLicense: true;
  autoInsured: true;
  smsConsent: true;
  answersAccurate: true;
  consentVersion: typeof CONSENT_VERSION;
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

export const OPEN_APPLICANT_ROLE: ApplicantRole = "Field Cleaner (Contractor)";

export function isOpenApplicantRole(value: string | null | undefined): boolean {
  return value === OPEN_APPLICANT_ROLE;
}

/** Every public hiring page starts on Field Cleaner. The other roles are opening soon. */
export function presetRoleForHiringPage(_roleId: string | null | undefined): ApplicantRole {
  return OPEN_APPLICANT_ROLE;
}

export function hiringIntentNote(_roleId: string | null | undefined): string | null {
  return null;
}

const APPLICANT_STATE_BY_POSTAL: Record<string, ApplicantState> = {
  MD: "Maryland",
  VA: "Virginia",
  DC: "DC",
  NY: "New York",
};

/** Short line for a saved application. Never the Indeed job title. */
export function savedApplicationNote(firstName: string | null | undefined): string {
  const name = (firstName || "").trim() || "you";
  return `Saved for ${name} · Field Cleaner, residential homes in the DMV. You can close this and come back.`;
}

/** Map a Google Places state ("MD" or "Maryland") onto an Airtable applicant state. */
export function applicantStateFromAddress(raw: string | null | undefined): ApplicantState | "" {
  const code = postalStateCode(raw);
  return APPLICANT_STATE_BY_POSTAL[code] || "";
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
    case "no_license":
      return {
        title: "A valid driver’s license is required",
        body: "You need a valid driver’s license to drive yourself to each job. If that changes, you’re welcome to apply again.",
      };
    case "no_auto_insurance":
      return {
        title: "The car needs to be insured",
        body: "The car you drive to jobs has to be insured. If that changes, you’re welcome to apply again.",
      };
    case "under_18":
      return {
        title: "You need to be 18 or older",
        body: "This role is only open to people who are 18 or older.",
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
      if (!draft.smsConsent) {
        return issue(400, "missing_sms", "Agree to texts and calls about your application to continue.");
      }
      return null;
    case "address": {
      const address = oneLine(draft.address);
      const city = oneLine(draft.city || "");
      if (address.length < 5) return issue(400, "missing_address", "Search for your address so we can fill this in.");
      if (address.length > 200) return issue(400, "missing_address", "Keep the address under 200 characters.");
      if (city.length < 2) return issue(400, "missing_city", "Enter your city.");
      if (city.length > 80) return issue(400, "missing_city", "Keep the city under 80 characters.");
      if (!/^\d{5}$/.test(draft.zipCode.trim())) {
        return issue(400, "invalid_zip", "Enter a 5-digit ZIP code.");
      }
      if (!includesValue(APPLICANT_STATES, draft.state)) {
        return issue(400, "invalid_state", "Choose Maryland, Virginia, DC, or New York.");
      }
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
      if (!draft.validDriversLicense) {
        return issue(422, "no_license", gateCopy("no_license").body, true);
      }
      if (!draft.autoInsured) {
        return issue(422, "no_auto_insurance", gateCopy("no_auto_insurance").body, true);
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
    case "age":
      if (!draft.age18) {
        return issue(422, "under_18", gateCopy("under_18").body, true);
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
      if (!draft.answersAccurate) {
        return issue(400, "missing_truthfulness", "Confirm that your answers are true and complete.");
      }
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
    const found = issuesForStep(step, draft);
    if (found) return found;
  }

  const firstName = oneLine(draft.firstName);
  const lastName = oneLine(draft.lastName);
  const street = oneLine(draft.address);
  const city = oneLine(draft.city || "");
  const address = city && !street.toLowerCase().includes(city.toLowerCase()) ? `${street}, ${city}` : street;
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
      address,
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
      age18: true,
      validDriversLicense: true,
      autoInsured: true,
      smsConsent: true,
      answersAccurate: true,
      consentVersion: CONSENT_VERSION,
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
