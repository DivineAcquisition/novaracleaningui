// ─── Contractor Phone Screening — form definition (single source of truth) ────
//
// Mirrors the "Phone Screening Script (Simple) · Novara 2026" VA playbook,
// section for section: four hard qualifiers, honest availability, ONE spoken
// acknowledgment block, how more work is earned (Novara Score), the verbatim
// client non-solicitation notice, and two scenario questions. A qualified call
// runs about 10 minutes; a disqualifying one ends in about three.
//
// What this deliberately does NOT ask, and why:
//   · Driver's license / auto insurance / "room to carry a vacuum" — not
//     screening signal; verified at onboarding if it matters.
//   · Smartphone, data plan, app comfort — they are on the phone with us.
//   · Work authorization as its own question — the acknowledgment covers the
//     contractor terms, and onboarding collects the W-9.
// The formal, individually-signed consents (contractor agreement, background
// check authorization, W-9) still happen at onboarding. This call captures
// VERBAL agreement, not the legal record — so nothing legally required is
// lost by collapsing them into one acknowledgment here.
//
// Two captures on this call are legally significant and are therefore stored
// as consents (timestamped and attributed to the screener, never hand-typed):
// the acknowledgment block, and the client non-solicitation covenant, which is
// read VERBATIM and whose answer is recorded verbatim. A No on either blocks
// Advance.
//
// This file defines every section, question, and read-aloud script for the
// live-call form, both consents, the standardized decline reasons, and the
// shared validation used on both the client (to block inconsistent
// submissions in the UI) and the server (authoritative). The screening-record
// PDF renders from these same definitions so the record always matches the
// form.
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
  /** Gates only: label for the pending option, when "fixable" needs wording. */
  pendingLabel?: string;
  /** Optional captures (notes) don't count toward section progress. */
  optional?: boolean;
}

export interface ScreeningSection {
  id: string;
  title: string;
  /** Read-aloud intro for the section. */
  intro?: string;
  /** Screener-facing framing for the section — NOT read aloud. */
  guidance?: string;
  /** The acknowledgment section renders from ACKNOWLEDGMENT, not questions. */
  isAcknowledgment?: boolean;
  /** The non-solicitation section renders from NON_SOLICITATION, not questions. */
  isNonSolicitation?: boolean;
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

/**
 * Shape of the `phone_screenings.consents` column. The condensed form writes a
 * single entry under ACKNOWLEDGMENT_KEY; rows from the older six-consent form
 * still carry their original keys and are rendered as-is on the PDF.
 */
export type ScreeningConsents = Record<string, ConsentCapture>;

export interface ScreeningScorecard {
  availability_fit?: number;
  experience_standards?: number;
  communication_professionalism?: number;
  scenario_judgment?: number;
}

// ─── Sections ──────────────────────────────────────────────────────────────────

/**
 * Age is the one gate with no fixable path and no override: a minor cannot
 * sign a contractor agreement, so a failed age gate can only end in Decline.
 * Enforced in hardQualifierState() and validateScreeningOutcome(), on both the
 * client and the server.
 */
export const AGE_GATE_KEY = "age_18";

/** Passing this gate is what feeds cleaners.max_travel_miles downstream. */
export const TRAVEL_GATE_KEY = "travel_30_40";

/** Miles credited to the contractor record when the travel gate passes. */
export const TRAVEL_GATE_MILES = 40;

// ─── Before you dial (screener guidance — never read aloud) ────────────────────

export const BEFORE_YOU_DIAL: Array<{ title: string; detail: string }> = [
  {
    title: "Be human, not a robot",
    detail:
      "Read the shaded boxes out loud, but say them your way. If it sounds like you're reading a form, they'll shut down. The one exception is the client non-solicitation notice — that one is read word for word.",
  },
  {
    title: "Ask the four qualifiers first",
    detail:
      "If someone doesn't have a car, you both just saved twenty minutes. That's a kindness, not a rejection.",
  },
  {
    title: "Listen to how they talk to you",
    detail:
      "This person will be alone in someone's home. If they're rude, cagey, or scattered on this call, that's real information.",
  },
  {
    title: "How long",
    detail:
      "About 10 minutes if they qualify, 3 if they don't. If you're past 15, you've started selling instead of screening.",
  },
];

/** The four things that end the call kindly, stated plainly for the VA. */
export const END_CALL_TRIGGERS = [
  "Under 18",
  "No car",
  "Won't travel",
  "Asks to be paid cash or off the books",
];

export const SCREENING_SECTIONS: ScreeningSection[] = [
  {
    id: "opening",
    title: "Opening the Call",
    intro:
      "Hi, is this {name}? This is {screener} with Novara Cleaning — you applied to clean with us. Do you have about ten minutes? … Great. This is pretty casual. I'll tell you how the work actually goes, ask you a few things, and by the end we'll both know if it's a good fit. Sound good?",
    guidance:
      "If it's a bad time, reschedule once. If they no-show the second call, you've learned something about reliability.",
    questions: [
      { key: "identity_confirmed", label: "Confirmed speaking with the applicant", kind: "yesno" },
      {
        key: "good_time",
        label: "Good time to talk",
        kind: "yesno",
        script:
          "If it's not a good time, no problem at all — when would be a better time for me to call you back?",
        guidance: "Reschedule once. A second no-show is itself the answer on reliability.",
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
    title: "The Four Things They Need",
    intro:
      "First I need to run through four quick requirements — every contractor has to meet these before we can move forward, so I'll get them out of the way up front.",
    guidance:
      "Ask these first. A \"no\" on any of them ends the call kindly. Also end the call politely if they ask to be paid cash or off the books.",
    questions: [
      {
        key: AGE_GATE_KEY,
        label: "18 or older",
        kind: "gate",
        script: "Just to confirm — you're 18 or older?",
        guidance:
          "Hard stop. Under 18 can't sign our contractor agreement — no exceptions, no workarounds. Under 18 is the one answer that can only end in Decline.",
        fixable: false,
      },
      {
        key: "photo_id",
        label: "Valid photo ID",
        kind: "gate",
        script: "Do you have a valid photo ID?",
        guidance:
          "\"I can get one\" isn't a no — that's a Hold. Mark it fixable, tell them to come back once they have it, and set a follow-up date.",
        fixable: true,
        pendingLabel: "Can get one — Hold",
      },
      {
        key: "own_car",
        label: "Own car",
        kind: "gate",
        script: "Do you have your own car?",
        guidance:
          "Rides, rideshare, or \"my cousin drives me\" won't work. Jobs are spread out with tight windows.",
        fixable: false,
      },
      {
        key: TRAVEL_GATE_KEY,
        label: "Can travel 30–40 miles for a job",
        kind: "gate",
        script: "Are you able to travel up to 30 to 40 miles for a job?",
        guidance:
          "Be straight that travel time isn't paid, so their honest answer matters more than a polite one.",
        fixable: false,
      },
    ],
  },
  {
    id: "availability",
    title: "When Can They Actually Work?",
    intro:
      "I want your honest availability, not your best-case. It's totally fine if you've got another job or other things going on — you're a contractor, that's your call. I just need to know when you can actually take our jobs, so I'm not sending you work you have to turn down.",
    guidance: "You want the real answer, not the eager one.",
    questions: [
      {
        key: "days",
        label: "Days available",
        kind: "multi",
        options: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
        script: "Which days can you work?",
        guidance: "Actual days, not \"most days\".",
      },
      {
        key: "hours",
        label: "Typical hours available",
        kind: "text",
        script: "And on those days, what hours?",
        guidance: "Start and end. Our jobs often start 8–10am.",
        placeholder: "e.g. 8am–4pm",
      },
      {
        key: "weekends",
        label: "Available weekends",
        kind: "yesno",
        script: "Are weekends an option for you?",
        guidance: "Turnovers and move-outs cluster here.",
      },
      {
        key: "cutoff_after",
        label: "Hard cutoff — no work AFTER",
        kind: "text",
        script:
          "Any hard cutoffs — a time of day after which you can never work? For example, needing to be done by school pickup.",
        guidance:
          "Important, and capture it verbatim: \"nothing after 3\" changes which jobs they can take. Hard cutoffs are written to the contractor record and read by dispatch and the risk layer — leave blank only if they genuinely have none.",
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
        guidance: "Same-day availability is worth a lot.",
        placeholder: "e.g. 1 day",
      },
      {
        key: "punctuality_commitment",
        label: "Agreed to flag lateness early",
        kind: "yesno",
        script:
          "Showing up on time is the biggest thing here. If you're ever running late or can't make it, I need to know early — not after. You good with that?",
        guidance: "Say this plainly, then note their answer. Hesitation here is worth writing down.",
      },
      {
        key: "punctuality_note",
        label: "What they said about lateness",
        kind: "text",
        placeholder: "Their answer, in their words…",
        optional: true,
      },
    ],
  },
  {
    id: "acknowledgment",
    title: "The One Thing to Agree To",
    isAcknowledgment: true,
    guidance:
      "Read it as one block and get one clear yes. If they hesitate on the background check specifically, slow down and ask why — that hesitation matters. A \"no\" anywhere here means we don't move forward.",
    questions: [],
  },
  {
    id: "earning",
    title: "How You Get More Work",
    intro:
      "Quick thing on how you get more work, because it's pretty simple. We track two things. First is reliability — do you take jobs when we offer them, and do you show up on time and finish them. Second is quality — that comes from our own checks and from what customers say about your work. Those two together make your Novara Score. It decides how much work you get offered and how fast you move up. New cleaners start at our base rate, and as you build a track record you move up two more levels and earn a bigger percentage of every job. So it's about as straightforward as it gets — show up, do good work, earn more.",
    guidance:
      "Say this one with energy — it's a selling point, not a warning. If they ask for specifics: three tiers, each a higher percentage of the job value, and crews earn a higher rate than solo jobs. The exact numbers are in the agreement they'll sign.",
    questions: [
      {
        key: "novara_score_explained",
        label: "Explained the Novara Score and tier progression",
        kind: "yesno",
      },
      {
        key: "questions_raised",
        label: "Questions they asked about pay or tiers",
        kind: "text",
        placeholder: "e.g. asked what the top tier pays",
        optional: true,
      },
    ],
  },
  {
    id: "non_solicitation",
    title: "Client Non-Solicitation — Formal Notice",
    isNonSolicitation: true,
    guidance:
      "Shift your tone here. Read it word for word, slowly. This is the one part of the call that is not casual. Do not paraphrase, soften, or explain it away — the formality is the point. Anything other than a clear yes is a no. If they want to discuss it: the full provision is in the agreement and they're welcome to read it carefully before signing — you do not negotiate terms on this call. Anyone who laughs it off, negotiates the edges, or asks how you would find out — write down exactly what they said.",
    questions: [],
  },
  {
    id: "scenarios",
    title: "Two Questions That Tell You Everything",
    intro:
      "Two quick real-world situations — there are no trick answers; I just want to hear how you'd handle each one.",
    guidance: "Nobody says \"no\" to \"are you reliable?\" These actually reveal something.",
    questions: [
      {
        key: "breakage_answer",
        label: "Broke something — applicant's answer",
        kind: "longtext",
        script: "Say you accidentally break something in a client's home. What do you do?",
        guidance:
          "Good: tells us right away, takes a photo, doesn't try to fix it themselves or hope nobody notices. Concerning: hides it, leaves without saying anything, or offers to settle privately with the client.",
      },
      { key: "breakage_rating", label: "Broke something — rating", kind: "rating" },
      {
        key: "cash_offer_answer",
        label: "Client offers cash directly — applicant's answer",
        kind: "longtext",
        script:
          "A client offers to pay you directly, cash, to clean for them privately — what do you say?",
        guidance:
          "You just read them the non-solicitation covenant, so this tests whether it landed. Good: declines clearly, says Novara clients stay with Novara, offers to loop in the office. Concerning: accepts, hedges, or asks for time to think about it.",
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
      "Good: tells us right away, takes a photo, doesn't try to fix it themselves or hope nobody notices. Concerning: hides it, leaves without saying anything, or offers to settle privately with the client.",
  },
  {
    answerKey: "cash_offer_answer",
    ratingKey: "cash_offer_rating",
    label: "Client offers cash directly",
    guidance:
      "Good: declines clearly, says Novara clients stay with Novara, offers to loop in the office. Concerning: accepts, hedges, or asks for time to think about it.",
  },
];

// ─── Acknowledgment (one spoken block, one recorded Yes/No) ───────────────────
//
// Read as a single block and captured ONCE: contractor status, pay, the
// background check and agreement that gate any work, and the on-job process.
// The individually-signed versions of these — the contractor agreement, the
// background check authorization, and the W-9 — are collected at onboarding,
// which is where the legal record actually lives. This capture is the verbal
// agreement on the call, timestamped and attributed to the screener.
//
// A No here blocks Advance outright.

export interface AcknowledgmentItem {
  key: string;
  label: string;
  script: string;
}

export const ACKNOWLEDGMENT_KEY = "terms_ack";

export const ACKNOWLEDGMENT: AcknowledgmentItem = {
  key: ACKNOWLEDGMENT_KEY,
  label: "1099 status, pay, background check & agreement, and on-job process",
  script:
    "Okay, a few things to make sure we're on the same page before we go further. This is a 1099 contractor role, so you're not an employee — no taxes come out of your pay, and you handle your own at tax time. Pay is a percentage of each job's value based on your tier, paid weekly. Travel time isn't paid. Before you get any work, you'll need to pass a background check and sign our contractor agreement. Nothing gets assigned until both of those are done. And on every job you'll follow our process — the checklist in the app, before and after photos, and letting us know right away if anything comes up. Are you good with all of that?",
};

// ─── Client non-solicitation covenant (read VERBATIM, answer recorded) ────────
//
// The one part of the call that is not casual: the covenant is read word for
// word because it carries legal weight, and the applicant's answer is recorded
// verbatim alongside the timestamp and screener. Anything other than a clear
// yes is a no, and a No blocks Advance.
//
// The bracketed figures in the playbook come from the signed Independent
// Contractor Agreement. The term is set here; the liquidated-damages figure
// stays null until the signed ICA figure is confirmed, in which case the script
// refers to "the amount stated in the Agreement" rather than reading a number
// we cannot stand behind on a recorded call.

export const NON_SOLICITATION_KEY = "client_non_solicitation_ack";

/** Months the covenant survives the end of the engagement, per the ICA. */
export const NON_SOLICITATION_MONTHS = 24;

/** Per-client liquidated damages from the ICA. Null → read as "the amount stated in the Agreement". */
export const NON_SOLICITATION_DAMAGES_USD: number | null = null;

const damagesPhrase = (): string =>
  NON_SOLICITATION_DAMAGES_USD == null
    ? "the amount stated in the Agreement"
    : `$${NON_SOLICITATION_DAMAGES_USD.toLocaleString("en-US")}`;

export const NON_SOLICITATION: AcknowledgmentItem = {
  key: NON_SOLICITATION_KEY,
  label: `Client non-solicitation covenant — ${NON_SOLICITATION_MONTHS} months post-engagement`,
  script: [
    "I'm going to read this next part exactly as it appears in the agreement, because it carries legal weight and you need to hear it in full.",
    `Under the Independent Contractor Agreement you will sign, you agree to a client non-solicitation covenant. During your engagement with Novara Cleaning, and for ${NON_SOLICITATION_MONTHS} months after it ends for any reason, you will not — directly or indirectly — solicit, accept, service, or perform cleaning services for any client you were introduced to, assigned to, or learned of through Novara Cleaning. This applies whether the client approaches you or you approach them.`,
    "It applies whether you are paid in cash, by check, through another company, or through a family member or any third party acting on your behalf.",
    "If you breach this provision, the Agreement provides that: your engagement is terminated immediately for cause; you owe Novara Cleaning liquidated damages of " +
      damagesPhrase() +
      " per client, which the company may set off against any amounts otherwise payable to you; Novara Cleaning may seek injunctive relief to stop the conduct; and you are responsible for the company's attorneys' fees and costs incurred in enforcing it.",
    "These obligations survive the end of our working relationship.",
    "Do you understand and accept this provision?",
  ].join("\n\n"),
};

/** Said briefly, back in a normal tone, right after the verbatim block. */
export const CONFIDENTIALITY_SCRIPT =
  "And just so it's said: client names, addresses, and door codes stay confidential during and after the engagement. No photos of client homes on social media, ever.";

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
  { code: "declined_consent", label: "Declined the acknowledgment (1099 / pay / background check / process)" },
  { code: "refused_non_solicitation", label: "Would not accept the client non-solicitation covenant" },
  { code: "off_books_pay_request", label: "Asked to be paid cash / off the books" },
  { code: "communication_concerns", label: "Communication / professionalism concerns" },
  { code: "compensation_mismatch", label: "Pay expectations mismatch" },
  { code: "withdrew", label: "Applicant withdrew / not interested" },
  { code: "other", label: "Other (see notes)" },
];

export const declineReasonLabel = (code: string | null | undefined): string =>
  DECLINE_REASONS.find((r) => r.code === code)?.label || code || "—";

// ─── How the call ends (three ways — never leave someone guessing) ─────────────

/** Read-aloud when they're a fit and onboarding is next. */
export const ADVANCE_SCRIPT =
  "Great — you're a fit for what we're looking for. You'll get an email and a text with your next steps: the agreement to sign, your W-9, the background check, and setting up how you get paid. Once all that's done and approved, you'll get access to the app and we'll start sending you jobs. Knock that out as soon as you can — nothing gets assigned until it's finished. Any questions before we hang up?";

/** Read-aloud when a fixable qualifier routes to Hold instead. */
export const HOLD_SCRIPT =
  "You're a good fit overall — the only thing we need is {pending}. Once you've got that, reach back out and we'll pick right up. Let's plan on {followUpDate}.";

/** Guidance pinned to the Hold path — a vague date means they never come back. */
export const HOLD_GUIDANCE =
  "Always give a real date. \"Get back to me sometime\" means they never will.";

/** Polite decline read-aloud, shown when a hard qualifier fails. */
export const DECLINE_SCRIPT =
  "I appreciate you taking the time today, {name}. Based on what we talked about, this isn't going to be the right fit for us right now. I'd rather tell you straight than leave you waiting on a call that isn't coming. I do wish you the best.";

/** Guidance pinned to the Decline path. */
export const DECLINE_GUIDANCE =
  "Keep it short. Don't over-explain, don't debate it, and don't say \"we'll keep you on file\" if you won't.";

// ─── Right after the call ──────────────────────────────────────────────────────

export const POST_CALL_CHECKLIST: Array<{ doThis: string; why: string }> = [
  { doThis: "Log the outcome", why: "Advance, Hold, or Decline — with a reason" },
  { doThis: "Record their yes", why: "The agreement block and the non-solicitation covenant, with the date" },
  { doThis: "Note their availability", why: "Especially hard cutoffs — dispatch needs these" },
  { doThis: "If advancing", why: "Send onboarding right away, while they're still excited" },
  { doThis: "If holding", why: "Set the reminder for the date you gave them" },
];

// ─── Shared state helpers (client UI + server validation) ─────────────────────

export interface HardQualifierState {
  failed: Array<{ key: string; label: string }>;
  pending: Array<{ key: string; label: string }>;
  answered: number;
  total: number;
  /** Age failed — the non-negotiable stop. Decline is the only outcome. */
  ageStop: boolean;
}

export function hardQualifierState(answers: ScreeningAnswers): HardQualifierState {
  const section = SCREENING_SECTIONS.find((s) => s.id === "qualifiers");
  const gates = (section?.questions || []).filter((q) => q.kind === "gate");
  const values = (answers.qualifiers || {}) as Record<string, unknown>;
  const failed: Array<{ key: string; label: string }> = [];
  const pending: Array<{ key: string; label: string }> = [];
  let answered = 0;
  let ageStop = false;
  for (const g of gates) {
    const v = values[g.key];
    if (v === "pass" || v === "fail" || v === "pending") answered += 1;
    // A non-fixable gate has no "pending" path. Anything stored as pending on
    // one is a hard fail here, so no amount of hand-edited draft data can turn
    // the age stop into a Hold.
    const isFail = v === "fail" || (v === "pending" && !g.fixable);
    if (isFail) {
      failed.push({ key: g.key, label: g.label });
      if (g.key === AGE_GATE_KEY) ageStop = true;
    } else if (v === "pending") {
      pending.push({ key: g.key, label: g.label });
    }
  }
  return { failed, pending, answered, total: gates.length, ageStop };
}

export interface AcknowledgmentState {
  /** The recorded answer, or null when it hasn't been captured yet. */
  value: YesNo | null;
  captured: boolean;
  isYes: boolean;
  isNo: boolean;
  capture: ConsentCapture | undefined;
}

/** Reads one consent capture off the row. Used for both spoken consents. */
export function consentState(consents: ScreeningConsents, key: string): AcknowledgmentState {
  const capture = consents?.[key];
  const value = capture?.value === "yes" || capture?.value === "no" ? capture.value : null;
  return {
    value,
    captured: value !== null,
    isYes: value === "yes",
    isNo: value === "no",
    capture: value === null ? undefined : capture,
  };
}

export function acknowledgmentState(consents: ScreeningConsents): AcknowledgmentState {
  return consentState(consents, ACKNOWLEDGMENT_KEY);
}

export function nonSolicitationState(consents: ScreeningConsents): AcknowledgmentState {
  return consentState(consents, NON_SOLICITATION_KEY);
}

/**
 * The applicant's answer to the covenant, recorded verbatim. Stored with the
 * section's answers rather than on the consent so it is a full quote, not a
 * one-line note — the playbook requires exactly what they said.
 */
export const NON_SOLICITATION_VERBATIM_KEY = "verbatim_answer";

export function nonSolicitationVerbatim(answers: ScreeningAnswers): string {
  const v = (answers?.non_solicitation || {})[NON_SOLICITATION_VERBATIM_KEY];
  return typeof v === "string" ? v.trim() : "";
}

/** Per-section progress: how many required questions have a non-empty answer. */
export function sectionProgress(
  section: ScreeningSection,
  answers: ScreeningAnswers,
  consents: ScreeningConsents,
): { answered: number; total: number } {
  if (section.isAcknowledgment) {
    return { answered: acknowledgmentState(consents).captured ? 1 : 0, total: 1 };
  }
  if (section.isNonSolicitation) {
    // The recorded Yes/No and the verbatim answer are both required.
    const captured = nonSolicitationState(consents).captured ? 1 : 0;
    const verbatim = nonSolicitationVerbatim(answers) ? 1 : 0;
    return { answered: captured + verbatim, total: 2 };
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
  const ack = acknowledgmentState(input.consents);
  const nonSolicit = nonSolicitationState(input.consents);

  // Under 18 is the one answer with no path other than Decline — a minor
  // cannot sign a contractor agreement, so there is nothing to hold for.
  if (hq.ageStop && rec !== "decline") {
    errors.push("Under 18 is a hard stop with no exceptions — the only valid outcome is Decline.");
  }

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
    if (!ack.captured) {
      errors.push("The acknowledgment must be recorded (Yes/No) before an Advance recommendation.");
    }
    if (ack.isNo) {
      errors.push(
        "The acknowledgment was recorded as No — Advance is blocked; route to Hold or Decline.",
      );
    }
    // The covenant is read verbatim and its answer recorded verbatim; anything
    // other than a clear yes is a no.
    if (!nonSolicit.captured) {
      errors.push(
        "The client non-solicitation covenant must be read and its answer recorded (Yes/No) before an Advance recommendation.",
      );
    }
    if (nonSolicit.isNo) {
      errors.push(
        "The client non-solicitation covenant was not accepted — Advance is blocked; route to Decline.",
      );
    }
    if (nonSolicit.captured && !nonSolicitationVerbatim(input.answers)) {
      errors.push("Record the applicant's answer to the non-solicitation covenant verbatim.");
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

  // Passing the travel gate credits the full radius. Screenings taken on the
  // older form recorded a typed mileage instead, so fall back to that.
  let travelRadiusMiles: number | null = q[TRAVEL_GATE_KEY] === "pass" ? TRAVEL_GATE_MILES : null;
  if (travelRadiusMiles === null) {
    const legacy = str(q.travel_radius);
    const legacyNum = legacy ? parseInt(legacy.replace(/[^0-9]/g, ""), 10) : NaN;
    if (Number.isFinite(legacyNum) && legacyNum > 0) travelRadiusMiles = legacyNum;
  }

  const availabilityParts = [
    preferredDays.length > 0 ? preferredDays.join("/") : null,
    str(av.hours),
    av.weekends === "yes" ? "weekends ok" : av.weekends === "no" ? "no weekends" : null,
  ].filter(Boolean);

  const noteParts = [
    str(av.cutoff_after) ? `No work after ${str(av.cutoff_after)}` : null,
    str(av.cutoff_before) ? `No work before ${str(av.cutoff_before)}` : null,
    str(av.notice_needed) ? `Needs ${str(av.notice_needed)} notice` : null,
  ].filter(Boolean);

  return {
    preferredDays,
    noWorkAfter: str(av.cutoff_after),
    noWorkBefore: str(av.cutoff_before),
    travelRadiusMiles,
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
