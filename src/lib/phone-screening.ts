// ─── Contractor Phone Screening — form definition (single source of truth) ────
//
// Mirrors the Contractor Phone Screening Guide, TRIMMED to run in 15 minutes
// or less (3–5 minutes for a fast disqualification): compound hard-qualifier
// prompts, a lean availability set, Systems & Legal as single spoken blocks
// with one confirmation each, and two high-signal scenario questions. The
// six consents remain INDIVIDUAL — never collapsed into a blanket ack.
//
// This file defines every section, question, and read-aloud script for the
// live-call form, the individual consent items, the standardized decline
// reasons, and the shared validation used on both the client (to block
// inconsistent submissions in the UI) and the server (authoritative). The
// screening-record PDF renders from these same definitions so the record
// always matches the form.
//
// Pure data + pure functions — safe to import from client components and
// from Next.js API routes.

export type GateValue = "pass" | "fail" | "pending";
export type YesNo = "yes" | "no";
export type Recommendation = "advance" | "hold" | "decline";

export type QuestionKind =
  | "gate" // hard qualifier: pass / fail / pending (pending = fixable, routes to Hold)
  | "yesno"
  | "text"
  | "longtext"
  | "select"
  | "multi"
  | "rating"; // 1–5

export interface ScreeningQuestion {
  key: string;
  label: string;
  /** Read-aloud script shown inline next to the field, visually distinct. */
  script?: string;
  /** Screener-facing hint (strong vs. concerning answers) — NOT read aloud. */
  guidance?: string;
  kind: QuestionKind;
  options?: string[];
  placeholder?: string;
  /** Gates only: can be marked "pending" (fixable) instead of a hard fail. */
  fixable?: boolean;
  /** Optional captures (notes) don't count toward section progress. */
  optional?: boolean;
}

export interface ScreeningSection {
  id: string;
  title: string;
  /** Read-aloud intro for the section. */
  intro?: string;
  /** The consents section renders from CONSENT_ITEMS instead of questions. */
  isConsents?: boolean;
  questions: ScreeningQuestion[];
}

/** answers[sectionId][questionKey] → value; answers[sectionId]._notes → string */
export type ScreeningAnswers = Record<string, Record<string, unknown>>;

export interface ConsentCapture {
  value: YesNo;
  note?: string;
  /** ISO timestamp of when the VA recorded the answer — stamped automatically. */
  at?: string;
  /** Screener user id / display name — stamped server-side, never typed. */
  by?: string;
  by_name?: string;
}

export type ScreeningConsents = Record<string, ConsentCapture>;

export interface ScreeningScorecard {
  availability_fit?: number;
  experience_standards?: number;
  communication_professionalism?: number;
  scenario_judgment?: number;
}

// ─── Sections ──────────────────────────────────────────────────────────────────

export const SCREENING_SECTIONS: ScreeningSection[] = [
  {
    id: "opening",
    title: "Call Opening",
    intro:
      "Hi, may I speak with {name}? This is {screener} calling from Novara Cleaning about the cleaning contractor application you submitted. Do you have about 15 minutes for a quick screen?",
    questions: [
      { key: "identity_confirmed", label: "Confirmed speaking with the applicant", kind: "yesno" },
      {
        key: "good_time",
        label: "Good time to talk",
        kind: "yesno",
        script:
          "If it's not a good time, no problem at all — when would be a better time for me to call you back?",
      },
      {
        key: "callback_time",
        label: "Callback time (if rescheduling)",
        kind: "text",
        placeholder: "e.g. Tomorrow 2pm",
        optional: true,
      },
    ],
  },
  {
    id: "qualifiers",
    title: "Hard Qualifiers",
    intro:
      "First I need to run through a few quick requirements — every contractor has to meet these before we can move forward, so I'll get them out of the way up front.",
    questions: [
      {
        key: "age_work_auth",
        label: "18+ and authorized to work in the U.S.",
        kind: "gate",
        script: "Are you 18 or older and legally authorized to work in the US?",
        fixable: false,
      },
      {
        key: "photo_id",
        label: "Valid government-issued photo ID",
        kind: "gate",
        script: "Do you have a valid government-issued photo ID?",
        fixable: true,
      },
      {
        key: "vehicle",
        label: "Own vehicle + license + insurance + capacity",
        kind: "gate",
        script:
          "Do you have your own reliable vehicle with a valid license and current insurance, and room to carry a vacuum and supplies?",
        fixable: true,
      },
      {
        key: "own_products",
        label: "Able to bring own products & equipment",
        kind: "gate",
        script: "Are you able to bring your own cleaning products and equipment to jobs?",
        fixable: true,
      },
      {
        key: "supplies_note",
        label: "Supplies note (optional)",
        kind: "text",
        placeholder: "e.g. Already stocked · Needs to buy basics first",
        optional: true,
      },
      {
        key: "phone_app",
        label: "Smartphone with data + app-ready",
        kind: "gate",
        script:
          "Do you have a smartphone with data and are you comfortable using an app to accept jobs, follow the checklist, and upload photos?",
        fixable: true,
      },
      {
        key: "home_base",
        label: "Home base (city / ZIP)",
        kind: "text",
        script: "Where are you based, and how far will you travel?",
        placeholder: "e.g. Rockville, 20850",
      },
      {
        key: "travel_radius",
        label: "Travel radius (miles)",
        kind: "text",
        placeholder: "e.g. 20",
      },
      {
        key: "no_serve_note",
        label: "Areas they won't serve (optional)",
        kind: "text",
        placeholder: "e.g. DC proper, anything past Baltimore",
        optional: true,
      },
    ],
  },
  {
    id: "availability",
    title: "Availability",
    intro:
      "Quick schedule check — I want to capture when you can work so we only ever offer you jobs that actually fit.",
    questions: [
      {
        key: "days",
        label: "Days available",
        kind: "multi",
        options: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        script: "Which days of the week are you available to work?",
      },
      {
        key: "hours",
        label: "Typical hours available",
        kind: "text",
        script: "And on those days, what hours are you generally available?",
        placeholder: "e.g. 8am–4pm",
      },
      { key: "weekends", label: "Available weekends", kind: "yesno", script: "Are weekends an option for you?" },
      {
        key: "cutoff_after",
        label: "Hard cutoff — no work AFTER",
        kind: "text",
        script:
          "Is there a hard cutoff — a time of day after which you can never work? For example, needing to be done by school pickup.",
        placeholder: "e.g. 3pm",
        optional: true,
      },
      {
        key: "cutoff_before",
        label: "Hard cutoff — no work BEFORE",
        kind: "text",
        script: "Anything on the front end — a time before which you can't start?",
        placeholder: "e.g. 9am",
        optional: true,
      },
      {
        key: "notice_needed",
        label: "Notice needed for a job offer",
        kind: "text",
        script: "How much notice do you need to accept a job — tomorrow, or a few days?",
        placeholder: "e.g. 1 day",
      },
      {
        key: "punctuality_ack",
        label: "Commits to punctuality + early notification",
        kind: "yesno",
        script:
          "One expectation I want to set now: arriving on time matters a lot here, and if something ever comes up, we need to hear from you as early as possible — never a no-show. Can you commit to that?",
      },
    ],
  },
  {
    id: "consents",
    title: "Consents",
    isConsents: true,
    intro:
      "Now the important part — I'm going to walk you through how this role works legally and how pay works, and I need a clear yes or no from you on each item. Stop me any time you have a question.",
    questions: [],
  },
  {
    id: "systems",
    title: "Systems & Expectations",
    intro:
      "Let me walk you through how day-to-day work actually runs, so nothing is a surprise. Jobs come through our contractor portal — offers show up with the date, location, and pay, and you accept or decline each one; nothing is forced onto your schedule. Before-and-after photos are mandatory on every job — they protect you as much as the client. Your work builds a performance score, the Novara Score, from reliability, quality, and client ratings; a higher score means the best jobs first and tier advancement that raises your pay percentage. If a quality issue comes up we handle it through a documented accountability process — coaching first, formal warnings if it repeats — and nothing is ever taken out of your pay. Any tip a client leaves is 100% yours. And on job days we need you reachable — confirm the job, message through the app if anything comes up, and always give early notice of a problem.",
    questions: [
      {
        key: "systems_ack",
        label: "Confirmed they understand and accept",
        kind: "yesno",
      },
    ],
  },
  {
    id: "legal",
    title: "Legal Terms",
    intro:
      "A few legal ground rules that will also be in your written agreement. Clients you meet through Novara are Novara clients — no side arrangements and no taking clients direct, during or after your time with us. Client privacy is strict: no posting client homes, addresses, or job photos on social media, and nothing about clients shared outside the app. The person who accepts the job is the person who shows up — no sending a friend, family member, or substitute in your place, ever. In a client's home we expect professional conduct — respectful, careful with property, nothing touched that isn't part of the job. And if you ever arrive to something out of scope — biohazards, hoarding, anything unsafe — you stop and contact us before doing anything; you'll never be penalized for stopping and reporting.",
    questions: [
      {
        key: "legal_ack",
        label: "Confirmed they understand and accept",
        kind: "yesno",
      },
    ],
  },
  {
    id: "scenarios",
    title: "Scenario Questions",
    intro:
      "Two quick real-world situations — there are no trick answers; I just want to hear how you'd handle each one.",
    questions: [
      {
        key: "breakage_answer",
        label: "Broke something — applicant's answer",
        kind: "longtext",
        script: "You accidentally break something in a client's home — what do you do?",
        guidance:
          "Strong: stops, photographs if safe, tells the client and Novara immediately, owns it. Concerning: hides it, leaves without saying anything, or offers to settle privately with the client.",
      },
      { key: "breakage_rating", label: "Broke something — rating", kind: "rating" },
      {
        key: "cash_offer_answer",
        label: "Client offers cash directly — applicant's answer",
        kind: "longtext",
        script:
          "A client offers to pay you directly, cash, to clean for them privately — what do you say?",
        guidance:
          "Strong: declines clearly, explains Novara clients stay with Novara, offers to loop in the office. Concerning: accepts, hedges, or asks for time to think about it.",
      },
      { key: "cash_offer_rating", label: "Cash offer — rating", kind: "rating" },
    ],
  },
];

/** Scenario answer/rating pairs, for rendering & the PDF. */
export const SCENARIO_PAIRS: Array<{
  answerKey: string;
  ratingKey: string;
  label: string;
  guidance?: string;
}> = [
  {
    answerKey: "breakage_answer",
    ratingKey: "breakage_rating",
    label: "Breaking something in a home",
    guidance:
      "Strong: stops, photographs if safe, tells the client and Novara immediately, owns it. Concerning: hides it, leaves without saying anything, or offers to settle privately with the client.",
  },
  {
    answerKey: "cash_offer_answer",
    ratingKey: "cash_offer_rating",
    label: "Client offers cash directly",
    guidance:
      "Strong: declines clearly, explains Novara clients stay with Novara, offers to loop in the office. Concerning: accepts, hedges, or asks for time to think about it.",
  },
];

// ─── Consents (each captured individually — the legal record) ─────────────────
// Six items. W-9 / payout setup is intentionally NOT here — onboarding already
// gates first payment on those, so the verbal consent was redundant. Do NOT
// collapse these into a blanket acknowledgment.

export interface ConsentItem {
  key: string;
  label: string;
  script: string;
}

export const CONSENT_ITEMS: ConsentItem[] = [
  {
    key: "contractor_1099",
    label: "Independent contractor (1099) status",
    script:
      "This is an independent contractor position — a 1099 role, not employment. You run your own schedule, we send you job offers, and you handle your own taxes; nothing is withheld from your pay. Are you okay working as a 1099 independent contractor?",
  },
  {
    key: "pay_structure",
    label: "Pay structure (tier % of job value, per completed job, weekly payout, travel unpaid)",
    script:
      "Pay works like this: you earn a percentage of each job's value — starting at 35% and rising to 40% and 45% as you advance tiers. You're paid per completed job, with payouts weekly. Travel time between jobs is not paid. Does that pay structure work for you?",
  },
  {
    key: "pay_final_value",
    label: "Pay follows the final approved job value, including add-ons",
    script:
      "Your percentage is applied to the final approved value of the job — so if the client adds services and the job value grows, your pay grows with it. Are you good with pay being based on that final approved value?",
  },
  {
    key: "background_check",
    label: "Background check",
    script:
      "Before you can take any jobs we run a background check. Do we have your consent to run one?",
  },
  {
    key: "signed_agreement",
    label: "Signed agreement before any work or system access",
    script:
      "You'll sign an independent contractor agreement before any work or system access — nothing starts until it's signed. Are you okay with that?",
  },
  {
    key: "liability_insurance",
    label: "Willing to carry own general liability insurance",
    script:
      "Contractors carry their own general liability insurance. Are you willing to carry your own coverage? And if you already have a policy, who's your carrier?",
  },
];

// ─── Scorecard & recommendation ────────────────────────────────────────────────

export const SCORECARD_ITEMS: Array<{ key: keyof ScreeningScorecard; label: string }> = [
  { key: "availability_fit", label: "Availability fit" },
  { key: "experience_standards", label: "Experience & standards" },
  { key: "communication_professionalism", label: "Communication & professionalism" },
  { key: "scenario_judgment", label: "Scenario judgment" },
];

export const DECLINE_REASONS: Array<{ code: string; label: string }> = [
  { code: "failed_hard_qualifier", label: "Failed a hard qualifier" },
  { code: "no_work_authorization", label: "Not authorized to work in the U.S." },
  { code: "under_18", label: "Under 18" },
  { code: "no_vehicle", label: "No reliable vehicle / transportation" },
  { code: "availability_mismatch", label: "Availability doesn't fit our jobs" },
  { code: "out_of_service_area", label: "Outside our service area" },
  { code: "insufficient_experience", label: "Insufficient experience for the role" },
  { code: "declined_consent", label: "Declined a required consent (1099 / pay / background check…)" },
  { code: "communication_concerns", label: "Communication / professionalism concerns" },
  { code: "compensation_mismatch", label: "Pay expectations mismatch" },
  { code: "withdrew", label: "Applicant withdrew / not interested" },
  { code: "other", label: "Other (see notes)" },
];

export const declineReasonLabel = (code: string | null | undefined): string =>
  DECLINE_REASONS.find((r) => r.code === code)?.label || code || "—";

/** Polite decline read-aloud, shown when a hard qualifier fails. */
export const DECLINE_SCRIPT =
  "Thank you so much for your time today, {name}. Based on the requirements for this role, we won't be able to move forward right now — but I really appreciate you speaking with me, and we'll keep your application on file in case anything changes.";

/** Read-aloud when a fixable qualifier routes to Hold instead. */
export const HOLD_SCRIPT =
  "No problem — that's something we can wait on. I'll make a note, and we'll follow up with you on a set date to pick this right back up once it's sorted.";

// ─── Shared state helpers (client UI + server validation) ─────────────────────

export interface HardQualifierState {
  failed: Array<{ key: string; label: string }>;
  pending: Array<{ key: string; label: string }>;
  answered: number;
  total: number;
}

export function hardQualifierState(answers: ScreeningAnswers): HardQualifierState {
  const section = SCREENING_SECTIONS.find((s) => s.id === "qualifiers");
  const gates = (section?.questions || []).filter((q) => q.kind === "gate");
  const values = (answers.qualifiers || {}) as Record<string, unknown>;
  const failed: Array<{ key: string; label: string }> = [];
  const pending: Array<{ key: string; label: string }> = [];
  let answered = 0;
  for (const g of gates) {
    const v = values[g.key];
    if (v === "pass" || v === "fail" || v === "pending") answered += 1;
    if (v === "fail") failed.push({ key: g.key, label: g.label });
    if (v === "pending") pending.push({ key: g.key, label: g.label });
  }
  return { failed, pending, answered, total: gates.length };
}

export interface ConsentsState {
  answered: number;
  total: number;
  noItems: Array<{ key: string; label: string }>;
  allYes: boolean;
}

export function consentsState(consents: ScreeningConsents): ConsentsState {
  const noItems: Array<{ key: string; label: string }> = [];
  let answered = 0;
  for (const item of CONSENT_ITEMS) {
    const c = consents[item.key];
    if (c?.value === "yes" || c?.value === "no") answered += 1;
    if (c?.value === "no") noItems.push({ key: item.key, label: item.label });
  }
  return {
    answered,
    total: CONSENT_ITEMS.length,
    noItems,
    allYes: answered === CONSENT_ITEMS.length && noItems.length === 0,
  };
}

/** Per-section progress: how many required questions have a non-empty answer. */
export function sectionProgress(
  section: ScreeningSection,
  answers: ScreeningAnswers,
  consents: ScreeningConsents,
): { answered: number; total: number } {
  if (section.isConsents) {
    const s = consentsState(consents);
    return { answered: s.answered, total: s.total };
  }
  const values = (answers[section.id] || {}) as Record<string, unknown>;
  const required = section.questions.filter((q) => !q.optional);
  let answered = 0;
  for (const q of required) {
    const v = values[q.key];
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    answered += 1;
  }
  return { answered, total: required.length };
}

export interface ScreeningOutcomeInput {
  answers: ScreeningAnswers;
  consents: ScreeningConsents;
  recommendation: Recommendation | null | undefined;
  declineReason?: string | null;
  holdPending?: string | null;
  holdFollowUpDate?: string | null;
  /** Short-form submit after a hard-qualifier failure skips completeness checks. */
  shortForm?: boolean;
}

/**
 * The authoritative consistency rules. Returns a list of blocking errors —
 * empty means the outcome is valid to submit. Used by the form (to disable
 * inconsistent combinations) and by the API (to enforce them).
 */
export function validateScreeningOutcome(input: ScreeningOutcomeInput): string[] {
  const errors: string[] = [];
  const rec = input.recommendation;
  if (!rec) {
    errors.push("A recommendation (Advance / Hold / Decline) is required.");
    return errors;
  }

  const hq = hardQualifierState(input.answers);
  const cs = consentsState(input.consents);

  if (rec === "advance") {
    if (hq.failed.length > 0) {
      errors.push(
        `Cannot Advance with a failed hard qualifier: ${hq.failed.map((f) => f.label).join(", ")}.`,
      );
    }
    if (hq.pending.length > 0) {
      errors.push(
        `Cannot Advance with unresolved (pending) qualifiers: ${hq.pending.map((f) => f.label).join(", ")} — route to Hold with a follow-up date.`,
      );
    }
    if (hq.answered < hq.total) {
      errors.push("All hard qualifiers must be answered before an Advance recommendation.");
    }
    if (cs.answered < cs.total) {
      errors.push("Every consent must be captured (Yes/No) before an Advance recommendation.");
    }
    if (cs.noItems.length > 0) {
      errors.push(
        `Cannot Advance with a consent recorded as No: ${cs.noItems.map((n) => n.label).join(", ")} — route to Hold or Decline.`,
      );
    }
  }

  if (rec === "decline") {
    const valid = DECLINE_REASONS.some((r) => r.code === input.declineReason);
    if (!valid) errors.push("Decline requires a reason from the standard list.");
  }

  if (rec === "hold") {
    if (!String(input.holdPending || "").trim()) {
      errors.push("Hold requires noting what is pending.");
    }
    const d = String(input.holdFollowUpDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      errors.push("Hold requires a specific follow-up date.");
    }
  }

  return errors;
}

// ─── Downstream field mapping (screening → applicant / cleaner record) ────────

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export interface DownstreamFields {
  /** Canonical Mon–Sun abbreviations — the format dispatch scoring reads. */
  preferredDays: string[];
  noWorkAfter: string | null;
  noWorkBefore: string | null;
  travelRadiusMiles: number | null;
  homeBase: string | null;
  supplyStatus: string | null;
  /** Availability one-liner for the applicant record. */
  availabilityText: string | null;
  /** Constraint notes for cleaners.constraints.notes (risk layer + dispatch). */
  constraintNotes: string | null;
}

export function deriveDownstreamFields(answers: ScreeningAnswers): DownstreamFields {
  const q = (answers.qualifiers || {}) as Record<string, unknown>;
  const av = (answers.availability || {}) as Record<string, unknown>;

  const rawDays = Array.isArray(av.days) ? (av.days as string[]) : [];
  const preferredDays = DAY_ORDER.filter((d) => rawDays.includes(d));

  const str = (v: unknown): string | null => {
    const s = typeof v === "string" ? v.trim() : "";
    return s || null;
  };

  const radiusRaw = str(q.travel_radius);
  const radiusNum = radiusRaw ? parseInt(radiusRaw.replace(/[^0-9]/g, ""), 10) : NaN;

  const availabilityParts = [
    preferredDays.length > 0 ? preferredDays.join("/") : null,
    str(av.hours),
    av.weekends === "yes" ? "weekends ok" : av.weekends === "no" ? "no weekends" : null,
  ].filter(Boolean);

  const noteParts = [
    str(av.cutoff_after) ? `No work after ${str(av.cutoff_after)}` : null,
    str(av.cutoff_before) ? `No work before ${str(av.cutoff_before)}` : null,
    str(av.notice_needed) ? `Needs ${str(av.notice_needed)} notice` : null,
    str(q.no_serve_note) ? `Won't serve: ${str(q.no_serve_note)}` : null,
    str(q.supplies_note) ? `Supplies: ${str(q.supplies_note)}` : null,
  ].filter(Boolean);

  return {
    preferredDays,
    noWorkAfter: str(av.cutoff_after),
    noWorkBefore: str(av.cutoff_before),
    travelRadiusMiles: Number.isFinite(radiusNum) && radiusNum > 0 ? radiusNum : null,
    homeBase: str(q.home_base),
    supplyStatus: str(q.supplies_note),
    availabilityText: availabilityParts.length > 0 ? availabilityParts.join(" · ") : null,
    constraintNotes: noteParts.length > 0 ? noteParts.join(" · ") : null,
  };
}

// ─── Misc ──────────────────────────────────────────────────────────────────────

export interface PhoneScreeningRow {
  id: string;
  applicant_id: string;
  status: "draft" | "submitted";
  answers: ScreeningAnswers;
  consents: ScreeningConsents;
  scorecard: ScreeningScorecard;
  recommendation: Recommendation | null;
  decline_reason: string | null;
  decline_notes: string | null;
  hold_pending: string | null;
  hold_follow_up_date: string | null;
  screener_id: string | null;
  screener_name: string | null;
  started_at: string;
  submitted_at: string | null;
  pdf_path: string | null;
  pdf_status: "none" | "generated" | "failed";
  pdf_attempts: number;
  pdf_last_error: string | null;
  created_at: string;
  updated_at: string;
}

export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  advance: "Advance",
  hold: "Hold",
  decline: "Decline",
};

export function callDurationMinutes(startedAt: string, submittedAt: string | null): number | null {
  if (!submittedAt) return null;
  const ms = new Date(submittedAt).getTime() - new Date(startedAt).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return Math.max(1, Math.round(ms / 60000));
}
