// ─── Contractor Standards & Conduct Addendum ─────────────────────────────────
//
// The addendum every contractor acknowledges: existing contractors re-acknowledge,
// new contractors acknowledge at onboarding. This module is the SOURCE OF TRUTH
// for its text. It is rendered verbatim on the acknowledgment page, in the
// onboarding wizard, and in the admin preview — nobody retypes it anywhere.
//
// Why in-repo rather than a DocuSeal template like the ICA: the addendum will be
// revised as new failure modes show up, and every revision has to be re-consented
// to by people who already agreed to the previous one. That needs a version the
// application can compare, which an ops-managed template revision can't give us.
// The ICA stays where it is — it is a contract, signed once. This clarifies the
// professional standard already required under it, and is re-acknowledged.
//
// ── Publishing a revision ──
// Editing the words below is not enough. A revision means:
//   1. edit the sections here,
//   2. bump CONTRACTOR_STANDARDS_VERSION *and* CONTRACTOR_STANDARDS_EDITION,
//   3. bump `app_settings.contractor_standards.version` in a migration — the
//      edge function that sends links and the SQL status view read it there,
//   4. run `npm run standards:verify`, which fails if (2) and (3) disagree.
// Everyone who acknowledged the previous version is then owed a fresh one, and
// the admin panel starts listing them again automatically.

/**
 * The acknowledged-version identifier. Compared for EXACT equality against
 * `cleaners.conduct_standards_version`: anything that isn't this string — an
 * older version, or nothing at all — means an acknowledgment is owed.
 *
 * Dated rather than sequential so a stale record reads as "agreed to the
 * September text", which is the question anyone actually asks of it.
 */
export const CONTRACTOR_STANDARDS_VERSION = "2026-09-11";

/** Human-facing label for the same thing. Shown on the document and in emails. */
export const CONTRACTOR_STANDARDS_EDITION = "Edition 1.0 · September 2026";

export const CONTRACTOR_STANDARDS_TITLE = "Contractor Standards & Conduct Addendum";

export const CONTRACTOR_STANDARDS_SUBTITLE =
  "To be acknowledged by every contractor. Existing contractors re-acknowledge; " +
  "new contractors acknowledge at onboarding.";

export const CONTRACTOR_STANDARDS_PREAMBLE =
  "These standards clarify expectations that already exist under your Independent " +
  "Contractor Agreement. They are not new obligations — they are the specifics of " +
  "what performing the Services to a professional standard actually requires.";

export type StandardsListTone =
  /** Things you must do. */
  | "required"
  /** Things you must not do. */
  | "prohibited"
  /** Rules that don't split cleanly into either. */
  | "neutral";

export interface StandardsList {
  /** Sub-heading above the items, when the section has more than one list. */
  title?: string;
  tone: StandardsListTone;
  items: string[];
}

export interface StandardsSection {
  /** Stable slug. Used as the anchor and as the section key in any record. */
  id: string;
  heading: string;
  /** Framing sentence above the lists — why the section exists. */
  lede?: string;
  lists: StandardsList[];
  /**
   * Lines pulled out of the list flow because they carry the consequence.
   * Rendered with weight, after the lists.
   */
  emphasis?: string[];
}

export const CONTRACTOR_STANDARDS_SECTIONS: StandardsSection[] = [
  {
    id: "appearance",
    heading: "Professional Appearance & Dress Code",
    lede:
      "You are entering clients' homes as a representative of NovaraCleaning. " +
      "Appearance is part of the service.",
    lists: [
      {
        title: "Required on every job",
        tone: "required",
        items: [
          "Clean, unstained, work-appropriate clothing",
          "Closed-toe, non-slip shoes",
          "Clothing that stays modest and secure through the full range of physical movement the work requires — bending, reaching, kneeling, lifting",
        ],
      },
      {
        title: "Not permitted",
        tone: "prohibited",
        items: [
          "Low-cut tops, short dresses or skirts, crop tops, or any garment that exposes undergarments or the body during normal cleaning movements",
          "Torn, dirty, or visibly worn clothing",
          "Loose jewelry or anything that could catch on surfaces or furniture",
        ],
      },
    ],
    emphasis: [
      "The working test: if you would not be comfortable bending down to pick something up in " +
        "front of a client, the outfit is not appropriate for the job. This is not about style — " +
        "it is about the client's comfort in their own home and your own safety while working.",
    ],
  },
  {
    id: "phone",
    heading: "Phone & Communication Requirements",
    lede: "Your phone is a required piece of equipment on every job, the same as your supplies.",
    lists: [
      {
        title: "Before every job",
        tone: "required",
        items: [
          "Phone charged to at least 50% at arrival, or a charger with you",
          "Ringer and notifications ON — not silent, not do-not-disturb",
          "Data/service confirmed working. If you know a property has poor signal, tell the office before the job",
        ],
      },
      {
        title: "During every job",
        tone: "required",
        items: [
          "Answer or return calls from the office within 5 minutes",
          "If a client asks a question you can't answer, contact the office — do not guess, and do not tell the client to figure it out",
          "If you cannot locate the client to ask something, look for them, call out, or call the office. Leaving a question unresolved because you \u201Ccouldn't find\u201D someone is not acceptable",
        ],
      },
    ],
    emphasis: [
      "Unreachable during an active job is a reliability failure, recorded as such. If your phone " +
        "dies or breaks mid-job, contact the office by any means as soon as possible.",
    ],
  },
  {
    id: "checklist",
    heading: "Your Dashboard & Checklist",
    lede:
      "Every job has a defined, room-by-room checklist in your dashboard. It is not optional, " +
      "and it is not something the client is responsible for explaining to you.",
    lists: [
      {
        title: "Before arriving",
        tone: "required",
        items: [
          "Open the job in your dashboard and read the full checklist",
          "Review any special instructions, access details, and property notes",
          "Know the scope you are being paid to complete",
        ],
      },
      {
        title: "During the job",
        tone: "required",
        items: [
          "Work the checklist and check items off as you complete them — not all at once at the end",
          "Capture required before and after photos",
          "Complete each area before moving to the next. Starting multiple rooms and finishing none is a failed job, regardless of hours spent",
        ],
      },
    ],
    emphasis: [
      "If a client asks what the clean includes: you should be able to answer from the checklist " +
        "in your dashboard. \u201CTell me what you want cleaned\u201D is not an acceptable answer — the " +
        "scope is already defined and you have it in front of you.",
      "Never mark an item complete that you did not do. Falsifying checklist completion is " +
        "grounds for immediate removal.",
    ],
  },
  {
    id: "property",
    heading: "Client Property & Furniture",
    lists: [
      {
        tone: "neutral",
        items: [
          "Never move heavy furniture on your own initiative. If cleaning behind or under an item requires moving it, ask the client first",
          "If a client asks you to move something, you may — but you are responsible for returning it to its original position before you leave, and for telling the client if you cannot",
          "Never leave a client's home in a state requiring them to restore it. A room you moved furniture in must be put back",
          "Report any damage immediately to the office. Do not attempt to hide, repair, or minimize it",
        ],
      },
    ],
  },
  {
    id: "pets",
    heading: "Pets in the Home",
    lede:
      "Many clients have pets, and they are family to them. How you treat an animal in a " +
      "client's home reflects on this company entirely.",
    lists: [
      {
        tone: "neutral",
        items: [
          "Never strike, kick, swing at, chase, or handle a client's pet roughly — under any circumstances, for any reason. There is no situation in which physical contact with a client's animal is appropriate",
          "If a pet is in your way, interfering with the work, or making you uncomfortable, ask the client to move the animal. That is always the correct response",
          "If you are uncomfortable around animals, tell the office in advance so you are not assigned to homes with pets. This is a legitimate preference and will be accommodated — it is not held against you",
          "If a pet is injured, escapes, or is involved in an incident of any kind, report it to the office immediately, before you leave the property",
        ],
      },
    ],
    emphasis: [
      "Any allegation of harm to a client's animal results in immediate suspension pending " +
        "investigation. Substantiated mistreatment of a client's pet is grounds for immediate " +
        "removal, and may carry consequences beyond your relationship with this company.",
    ],
  },
  {
    id: "punctuality",
    heading: "Punctuality",
    lists: [
      {
        tone: "neutral",
        items: [
          "Arrive within your scheduled window. Not 30 minutes late, not \u201Croughly around\u201D it",
          "If you are running late for any reason, notify the office before your scheduled start time — not after you were supposed to arrive",
          "Breaks are expected on longer jobs, but sitting in your vehicle for extended periods mid-clean, without informing anyone, is not a break — it is unaccounted time and is recorded as such",
          "Clients notice, and often report, time spent not working",
        ],
      },
    ],
  },
  {
    id: "chemicals",
    heading: "Chemicals & Products",
    lists: [
      {
        tone: "neutral",
        items: [
          "Use only products appropriate to the surface being cleaned",
          "Never spray an unidentified or all-purpose chemical across every surface indiscriminately — different surfaces require different products",
          "If you are unsure whether a product is safe for a surface, ask the office or skip it — do not guess",
          "Be aware of pets and children in the home when using any chemical product",
        ],
      },
    ],
  },
  {
    id: "incidents",
    heading: "When Something Goes Wrong",
    lists: [
      {
        tone: "neutral",
        items: [
          "If anything happens on a job that a client might reasonably complain about — damage, a disagreement, an incident with a pet or a person, running significantly over time, or work you could not complete — report it to the office yourself, before you leave the property",
        ],
      },
    ],
    emphasis: ["Reporting it yourself protects you. Hearing it first from the client does not."],
  },
];

/**
 * The consent itself. Shown next to the checkbox and stored verbatim on the
 * acknowledgment row, so a record from an older version can always be read
 * back with the words the contractor actually agreed to.
 */
export const CONTRACTOR_STANDARDS_ACKNOWLEDGMENT =
  "I have read and understood these Contractor Standards. I understand they clarify the " +
  "professional standard already required under my Independent Contractor Agreement, and that " +
  "failing to meet them may result in coaching, a formal strike, suspension from new " +
  "assignments, or removal, depending on severity.";

// ─── Standing ────────────────────────────────────────────────────────────────

/** What we know about one contractor's acknowledgment of the current version. */
export type StandardsStanding =
  /** Acknowledged the current version. Nothing owed. */
  | "current"
  /** Acknowledged an earlier version. Owed a re-acknowledgment. */
  | "outdated"
  /** Never acknowledged any version. Owed a first acknowledgment. */
  | "never";

export interface StandardsRecord {
  conduct_standards_version?: string | null;
  conduct_standards_acknowledged_at?: string | null;
}

/**
 * Which of the three states a contractor is in.
 *
 * A version string we don't recognise counts as `outdated`, not `current`:
 * being wrong in the direction of asking again is cheap, and being wrong the
 * other way means an unacknowledged contractor is invisible.
 */
export function standardsStanding(row: StandardsRecord | null | undefined): StandardsStanding {
  const version = String(row?.conduct_standards_version || "").trim();
  if (!version) return "never";
  return version === CONTRACTOR_STANDARDS_VERSION ? "current" : "outdated";
}

/** True when this contractor still owes an acknowledgment. */
export function needsStandardsAcknowledgment(row: StandardsRecord | null | undefined): boolean {
  return standardsStanding(row) !== "current";
}

/**
 * Why we're asking, in the contractor's own terms. A re-acknowledgment after a
 * revision is a different conversation from a first one, and reading "please
 * acknowledge" again when you already did is how people conclude the form is
 * broken and stop filling it in.
 */
export function standardsAskCopy(standing: StandardsStanding): { title: string; body: string } {
  if (standing === "outdated") {
    return {
      title: "We've updated the contractor standards",
      body:
        "You've acknowledged an earlier version of these standards. They've been revised, so we " +
        "need you to read the current version and acknowledge it again. It takes a couple of minutes.",
    };
  }
  return {
    title: "Please read and acknowledge the contractor standards",
    body:
      "These are the specifics of what performing to a professional standard requires on every " +
      "job — appearance, phone, checklist, client property, pets, punctuality and chemicals. " +
      "Read them, acknowledge at the bottom, and you're done.",
  };
}

/** The acknowledgment link we text and email. */
export function standardsLink(token: string): string {
  return `https://contractor.novaracleaning.com/cleaner/standards/${token}`;
}

/** Total rules across every section — used for the "N standards" summary line. */
export function standardsRuleCount(): number {
  return CONTRACTOR_STANDARDS_SECTIONS.reduce(
    (total, section) =>
      total + section.lists.reduce((n, list) => n + list.items.length, 0),
    0,
  );
}
