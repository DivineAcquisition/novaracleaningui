// ─── Contractor Phone Screening — form definition (single source of truth) ────
//
// Mirrors the Contractor Phone Screening Guide. This file defines every
// section, question, and read-aloud script for the live-call form, the
// individual consent items, the standardized decline reasons, and the shared
// validation used on both the client (to block inconsistent submissions in
// the UI) and the server (authoritative). The screening-record PDF renders
// from these same definitions so the record always matches the form.
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
  kind: QuestionKind;
  options?: string[];
  placeholder?: string;
  /** Gates only: can be marked "pending" (fixable) instead of a hard fail. */
  fixable?: boolean;
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
      "Hi, may I speak with {name}? This is {screener} calling from Novara Cleaning about the cleaning contractor application you submitted. Do you have about 15–20 minutes to go through a few quick questions together?",
    questions: [
      { key: "identity_confirmed", label: "Confirmed speaking with the applicant", kind: "yesno" },
      {
        key: "good_time",
        label: "Good time to talk",
        kind: "yesno",
        script:
          "If it's not a good time, no problem at all — when would be a better time for me to call you back?",
      },
      { key: "callback_time", label: "Callback time (if rescheduling)", kind: "text", placeholder: "e.g. Tomorrow 2pm" },
    ],
  },
  {
    id: "qualifiers",
    title: "Hard Qualifiers",
    intro:
      "First I need to run through a few quick requirements — every contractor has to meet these before we can move forward, so I'll get them out of the way up front.",
    questions: [
      { key: "age_18", label: "18 years or older", kind: "gate", script: "Are you 18 or older?", fixable: false },
      {
        key: "photo_id",
        label: "Valid government-issued photo ID",
        kind: "gate",
        script: "Do you have a valid government-issued photo ID — a driver's license, state ID, or passport?",
        fixable: true,
      },
      {
        key: "work_auth",
        label: "Authorized to work in the U.S.",
        kind: "gate",
        script: "Are you legally authorized to work in the United States?",
        fixable: false,
      },
      {
        key: "ssn_itin",
        label: "SSN or ITIN for the W-9",
        kind: "gate",
        script:
          "Since this is a contractor role, we'll need a W-9 before your first payment. Do you have a Social Security Number or an ITIN for that?",
        fixable: true,
      },
      {
        key: "vehicle",
        label: "Reliable vehicle",
        kind: "gate",
        script: "Do you have reliable transportation — a vehicle of your own you can use to get to jobs?",
        fixable: true,
      },
      {
        key: "license_insurance",
        label: "Valid driver's license + auto insurance",
        kind: "gate",
        script: "Do you have a valid driver's license and current auto insurance on that vehicle?",
        fixable: true,
      },
      {
        key: "vehicle_capacity",
        label: "Vehicle fits supplies & equipment",
        kind: "gate",
        script:
          "Can your vehicle carry your cleaning supplies and equipment — a vacuum, mop, and a caddy of products?",
        fixable: true,
      },
      {
        key: "own_products",
        label: "Willing to supply own products & equipment",
        kind: "gate",
        script:
          "As an independent contractor you supply your own cleaning products and equipment. Are you willing and able to do that?",
        fixable: true,
      },
      {
        key: "supply_status",
        label: "Current supply status",
        kind: "select",
        script: "Do you already have your supplies, or would you need to pick things up before a first job?",
        options: ["Fully stocked now", "Has most items — minor gaps", "Needs to purchase before first job"],
      },
      {
        key: "smartphone",
        label: "Smartphone with a data plan",
        kind: "gate",
        script: "Do you have a smartphone with a working data plan?",
        fixable: true,
      },
      {
        key: "app_comfort",
        label: "Comfortable using an app for jobs / checklists / photos",
        kind: "gate",
        script:
          "All of our work runs through an app — you'd receive job offers, follow checklists, and upload photos from your phone. Are you comfortable with that?",
        fixable: true,
      },
      {
        key: "home_base",
        label: "Home base (city / ZIP)",
        kind: "text",
        script: "What city or ZIP code would you be working out of?",
        placeholder: "e.g. Rockville, 20850",
      },
      {
        key: "travel_radius",
        label: "Travel radius (miles)",
        kind: "text",
        script: "How far are you willing to travel for a job — roughly how many miles from home?",
        placeholder: "e.g. 20",
      },
      {
        key: "no_serve_areas",
        label: "Areas they will NOT serve",
        kind: "text",
        script: "Are there any areas you would not want to take jobs in?",
        placeholder: "e.g. DC proper, anything past Baltimore",
      },
    ],
  },
  {
    id: "availability",
    title: "Availability & Capacity",
    intro:
      "Now let's talk schedule — I want to capture exactly when you can work so we only ever offer you jobs that actually fit.",
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
      {
        key: "target_hours",
        label: "Target hours per week",
        kind: "text",
        script: "How many hours a week are you looking for?",
        placeholder: "e.g. 25–30",
      },
      { key: "weekends", label: "Available weekends", kind: "yesno", script: "Are weekends an option for you?" },
      {
        key: "cutoff_after",
        label: "Hard cutoff — no work AFTER",
        kind: "text",
        script:
          "Is there a hard cutoff — a time of day after which you can never work? For example, needing to be done by school pickup.",
        placeholder: "e.g. 3pm",
      },
      {
        key: "cutoff_before",
        label: "Hard cutoff — no work BEFORE",
        kind: "text",
        script: "Anything on the front end — a time before which you can't start?",
        placeholder: "e.g. 9am",
      },
      {
        key: "commitments",
        label: "Other jobs / commitments",
        kind: "text",
        script: "Do you have another job or regular commitments we should plan around?",
      },
      {
        key: "notice_needed",
        label: "Notice needed for a job offer",
        kind: "text",
        script: "How much notice do you need to accept a job — could you take something for tomorrow, or do you need a few days?",
        placeholder: "e.g. 1 day",
      },
      {
        key: "blackout_dates",
        label: "Upcoming blackout dates",
        kind: "text",
        script: "Any trips or dates coming up when you won't be available?",
      },
      {
        key: "dependability",
        label: "Childcare / transport reliability factors",
        kind: "text",
        script:
          "Is there anything — childcare, shared vehicle, anything like that — that could affect your ability to make a scheduled job?",
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
    id: "experience",
    title: "Experience & Capability",
    intro: "Tell me a bit about your cleaning experience.",
    questions: [
      {
        key: "background",
        label: "Cleaning background",
        kind: "longtext",
        script: "How long have you been cleaning professionally, and where — a company, on your own, or both?",
      },
      {
        key: "settings",
        label: "Settings worked",
        kind: "multi",
        options: ["Residential", "Commercial", "Short-term rental (STR)"],
        script: "Have you cleaned homes, offices, short-term rentals like Airbnbs — which of those?",
      },
      {
        key: "deep_moveout",
        label: "Deep clean / move-out experience",
        kind: "yesno",
        script: "Have you done deep cleans or move-out cleans — inside ovens, baseboards, that level of detail?",
      },
      {
        key: "checklist_comfort",
        label: "Comfortable following a room-by-room checklist",
        kind: "yesno",
        script: "Every job here follows a room-by-room checklist in the app. Are you comfortable working from a checklist?",
      },
      {
        key: "solo_team",
        label: "Solo vs. team",
        kind: "select",
        options: ["Prefers solo", "Prefers team", "Either works"],
        script: "Do you prefer working solo, with a team, or does either work?",
      },
      {
        key: "physical",
        label: "Physically able (stairs, bending, carrying equipment)",
        kind: "yesno",
        script:
          "The work is physical — stairs, bending, kneeling, and carrying a vacuum between floors. Are you able to do that comfortably?",
      },
      {
        key: "sensitivities",
        label: "Product sensitivities / allergies",
        kind: "text",
        script: "Any sensitivities or allergies to cleaning products we should know about?",
      },
      {
        key: "pets_ok",
        label: "Comfortable in homes with pets",
        kind: "yesno",
        script: "Many of our homes have dogs or cats. Are you comfortable working around pets?",
      },
      {
        key: "cameras_ok",
        label: "Comfortable with cameras / client present",
        kind: "yesno",
        script: "Some homes have cameras, and sometimes the client is home while you work. Are you comfortable with both?",
      },
      {
        key: "photos_ok",
        label: "Comfortable photo-documenting work",
        kind: "yesno",
        script:
          "We photo-document every job — before shots when you arrive and after shots when you finish, taken in the app. Are you comfortable doing that on every job?",
      },
      {
        key: "standards_answer",
        label: "\"How do you know a clean is done?\"",
        kind: "longtext",
        script:
          "Last one here, and there's no trick to it: how do you know when a room is actually done? What do you check before you'd call a clean complete?",
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
    intro: "Let me walk you through how day-to-day work actually runs, so nothing is a surprise.",
    questions: [
      {
        key: "portal_flow",
        label: "Understands & accepts the portal + accept/decline flow",
        kind: "yesno",
        script:
          "Jobs come through our contractor portal: offers show up in the app with the date, location, and pay, and you accept or decline each one — nothing is ever forced on your schedule. Does that work for you?",
      },
      {
        key: "photo_docs",
        label: "Accepts mandatory before & after photos",
        kind: "yesno",
        script:
          "Before-and-after photos are mandatory on every job — they protect you as much as the client, because they're proof of the condition you found and the work you did. Are you on board with that?",
      },
      {
        key: "novara_score",
        label: "Understands the Novara Score → job priority & tier advancement",
        kind: "yesno",
        script:
          "Your work builds a performance score — the Novara Score — from reliability, quality, and client ratings. A higher score means you get offered the best jobs first and advance tiers, which raises your pay percentage. Make sense?",
      },
      {
        key: "accountability",
        label: "Understands the accountability process",
        kind: "yesno",
        script:
          "If a quality issue comes up we handle it through a documented process — coaching first, formal warnings if it repeats. Nothing is ever taken out of your pay. Are you comfortable with that?",
      },
      {
        key: "tips",
        label: "Understands tips are 100% theirs",
        kind: "yesno",
        script: "Good news item: any tip a client leaves is 100% yours — we never take a cut of tips.",
      },
      {
        key: "communication",
        label: "Accepts the communication standard",
        kind: "yesno",
        script:
          "On job days we need you reachable — confirm the job, message through the app if anything comes up, and always give early notice of a problem. Can you commit to that standard?",
      },
    ],
  },
  {
    id: "legal",
    title: "Legal Terms",
    intro: "A few legal ground rules that will also be in your written agreement — I need a yes on each.",
    questions: [
      {
        key: "non_solicitation",
        label: "Client non-solicitation",
        kind: "yesno",
        script:
          "Clients you meet through Novara are Novara clients — no side arrangements, no taking clients direct, during or after your time with us. Do you agree to that?",
      },
      {
        key: "confidentiality",
        label: "Confidentiality — no client photos on social media",
        kind: "yesno",
        script:
          "Client privacy is strict: no posting client homes, addresses, or job photos on social media, and nothing about clients shared outside the app. Agreed?",
      },
      {
        key: "no_subcontract",
        label: "No subcontracting or substitutes",
        kind: "yesno",
        script:
          "The person who accepts the job is the person who shows up — no sending a friend, family member, or substitute in your place, ever. Agreed?",
      },
      {
        key: "conduct",
        label: "Conduct & property expectations",
        kind: "yesno",
        script:
          "In a client's home we expect professional conduct — respectful, careful with property, nothing touched that isn't part of the job. Agreed?",
      },
      {
        key: "stop_report",
        label: "Stop-and-report rule for out-of-scope conditions",
        kind: "yesno",
        script:
          "If you ever arrive to something out of scope — biohazards, hoarding, anything unsafe — you stop and contact us before doing anything. You'll never be penalized for stopping and reporting. Agreed?",
      },
    ],
  },
  {
    id: "scenarios",
    title: "Scenario Questions",
    intro:
      "Last section — a few quick real-world situations. There are no trick answers; I just want to hear how you'd handle each one.",
    questions: [
      {
        key: "late_answer",
        label: "Running late — applicant's answer",
        kind: "longtext",
        script: "You're running 20 minutes late to a job. What do you do?",
      },
      { key: "late_rating", label: "Running late — rating", kind: "rating" },
      {
        key: "breakage_answer",
        label: "Broke something — applicant's answer",
        kind: "longtext",
        script: "You accidentally break something in a client's home. What do you do?",
      },
      { key: "breakage_rating", label: "Broke something — rating", kind: "rating" },
      {
        key: "dirtier_answer",
        label: "Dirtier than described — applicant's answer",
        kind: "longtext",
        script: "You arrive and the home is much dirtier than the job described. What do you do?",
      },
      { key: "dirtier_rating", label: "Dirtier than described — rating", kind: "rating" },
      {
        key: "complaint_answer",
        label: "Client says job was poor — applicant's answer",
        kind: "longtext",
        script: "A client messages that the job was poorly done. How do you respond?",
      },
      { key: "complaint_rating", label: "Client complaint — rating", kind: "rating" },
      {
        key: "cash_offer_answer",
        label: "Client offers cash directly — applicant's answer",
        kind: "longtext",
        script: "A client says: \"Next time just come directly and I'll pay you cash.\" What do you say?",
      },
      { key: "cash_offer_rating", label: "Cash offer — rating", kind: "rating" },
    ],
  },
];

/** Scenario answer/rating pairs, for rendering & the PDF. */
export const SCENARIO_PAIRS: Array<{ answerKey: string; ratingKey: string; label: string }> = [
  { answerKey: "late_answer", ratingKey: "late_rating", label: "Running late to a job" },
  { answerKey: "breakage_answer", ratingKey: "breakage_rating", label: "Breaking something in a home" },
  { answerKey: "dirtier_answer", ratingKey: "dirtier_rating", label: "Home dirtier than described" },
  { answerKey: "complaint_answer", ratingKey: "complaint_rating", label: "Client says the job was poor" },
  { answerKey: "cash_offer_answer", ratingKey: "cash_offer_rating", label: "Client offers cash directly" },
];

// ─── Consents (each captured individually — the legal record) ─────────────────

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
    key: "w9_payout",
    label: "W-9 + payout setup before first payment",
    script:
      "Before your first payment you'll complete a W-9 and set up direct payouts through our payment partner, Stripe. Are you able and willing to complete both?",
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

/** Per-section progress: how many questions have a non-empty answer. */
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
  let answered = 0;
  for (const q of section.questions) {
    const v = values[q.key];
    if (v == null) continue;
    if (typeof v === "string" && v.trim() === "") continue;
    if (Array.isArray(v) && v.length === 0) continue;
    answered += 1;
  }
  return { answered, total: section.questions.length };
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
    str(av.target_hours) ? `~${str(av.target_hours)} hrs/wk` : null,
  ].filter(Boolean);

  const noteParts = [
    str(av.cutoff_after) ? `No work after ${str(av.cutoff_after)}` : null,
    str(av.cutoff_before) ? `No work before ${str(av.cutoff_before)}` : null,
    str(av.commitments) ? `Commitments: ${str(av.commitments)}` : null,
    str(av.notice_needed) ? `Needs ${str(av.notice_needed)} notice` : null,
    str(av.blackout_dates) ? `Blackout: ${str(av.blackout_dates)}` : null,
    str(q.no_serve_areas) ? `Won't serve: ${str(q.no_serve_areas)}` : null,
    str(q.supply_status) && q.supply_status !== "Fully stocked now"
      ? `Supplies: ${str(q.supply_status)}`
      : null,
  ].filter(Boolean);

  return {
    preferredDays,
    noWorkAfter: str(av.cutoff_after),
    noWorkBefore: str(av.cutoff_before),
    travelRadiusMiles: Number.isFinite(radiusNum) && radiusNum > 0 ? radiusNum : null,
    homeBase: str(q.home_base),
    supplyStatus: str(q.supply_status),
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
