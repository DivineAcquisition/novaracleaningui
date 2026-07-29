// ─── GHL tag policy: a closed vocabulary, five slots, one meaning each ─────
//
// Tags in GHL were multiplying. The chat agent asked an LLM for
// "tag_recommendations" and pushed whatever came back, so the account filled up
// with one-offs like "military-gift" and "navy-family"; contractor sync pushed
// fifteen tags per person that duplicated data already sitting in custom
// fields; and half a dozen callers invented their own shapes ("src-fb",
// "membership-paused", "zone-20816"). A tag vocabulary nobody can enumerate is
// a filter nobody can trust.
//
// So tags are now a CLOSED vocabulary organized into SLOTS. A contact carries
// at most one tag per slot, and at most MAX_TAGS_PER_CONTACT tags in total:
//
//   1. action    workflow triggers GHL automations listen for
//   2. alert     something needs a human
//   3. role      who this contact is
//   4. status    where they are within that role
//   5. service   what they buy
//   6. zip       where they are
//   7. source    how they found us
//   8. campaign  which campaign
//
// The list is priority-ordered and the cap keeps the top five, so an automation
// trigger can never be squeezed out by a UTM campaign. Slots below the cut are
// the ones whose data ALREADY lives in GHL custom fields (source, campaign,
// UTM, ZIP), so nothing is actually lost when they're dropped — the same is
// true of everything the policy rejects outright: pay tier, skills, background
// check state, home size and preferred day are all custom fields.
//
// Anything not in the vocabulary is DROPPED, not passed through. That is the
// whole point: if a new tag is genuinely needed, it gets added here on purpose.

/** A contact may never carry more than this many tags. */
export const MAX_TAGS_PER_CONTACT = 5;

/**
 * Canonical lead lifecycle stages (the only lead-* tags we ever create).
 *
 * Multi-word values are SPACE-separated, matching every other category
 * ("pending approval", "move in out", "speed to lead miss"). Normalization
 * always produces spaces, so a hyphenated entry here would define a stage the
 * policy then refuses to accept — which is exactly what happened to
 * "follow-up" and silently dropped the stale-lead escalation tag.
 */
export const LEAD_STAGES = [
  "booked",
  "cold",
  "contacted",
  "engaged",
  "follow up",
  "lost",
  "new",
  "quoted",
  "unqualified",
  "waiting reply",
  "warm",
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

/** Build the canonical lead-stage tag, e.g. "lead - warm". Accepts either separator. */
export function leadStageTag(stage: LeadStage | string): string {
  return `lead - ${String(stage).trim().toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ")}`;
}

/** The full set of canonical lead-stage tags (used for mutual exclusivity). */
export const LEAD_STAGE_TAG_SET: ReadonlySet<string> = new Set(
  LEAD_STAGES.map((s) => leadStageTag(s)),
);

/** Map a free-text lead score / temperature onto a canonical lead stage. */
export function leadStageFromScore(score: string | null | undefined): LeadStage {
  const s = String(score || "").trim().toLowerCase().replace(/[-_]+/g, " ");
  if ((LEAD_STAGES as readonly string[]).includes(s)) return s as LeadStage;
  if (/hot|high/.test(s)) return "warm";
  if (/cool|low/.test(s)) return "cold";
  return "new";
}

// ─── The vocabulary ─────────────────────────────────────────────────────────

/**
 * Tags GHL WORKFLOWS trigger on. These are matched verbatim and deliberately
 * keep their legacy shape — renaming one silently breaks the automation on the
 * other side, which is the kind of failure nobody notices until a host never
 * receives their agreement.
 */
export const WORKFLOW_TRIGGER_TAGS: ReadonlySet<string> = new Set([
  "send-host-agreement-individual",
  "send-host-agreement-entity",
  "host-agreement-sent",
  "host-agreement-signed",
  "completion-hold-failed",
  "auto-cancelled-payment",
]);

/** Who this contact is. Exactly one. */
export const ROLE_TAGS = [
  "customer",
  "lead",
  "member",
  "contractor",
  "partner",
  "waitlist",
] as const;

/** Values allowed after a `category - ` prefix, per slotted category. */
const STATUS_VALUES: Record<string, ReadonlySet<string>> = {
  lead: new Set(LEAD_STAGES as readonly string[]),
  member: new Set(["active", "paused", "resumed", "cancelled", "weekly", "biweekly", "monthly", "quarterly"]),
  contractor: new Set(["applicant", "onboarding", "pending approval", "approved", "active", "inactive", "suspended", "terminated"]),
  booking: new Set(["confirmed", "cancelled", "rescheduled", "completed", "no show"]),
  partner: new Set(["host", "commercial", "office"]),
};

/** Things that need a person, not a filter. */
const ALERT_VALUES: ReadonlySet<string> = new Set([
  "speed to lead miss",
  "payment failed",
  "uncovered job",
  "agreement unsigned",
]);

/** Services we sell. Free-form service names collapse into these. */
const SERVICE_VALUES: ReadonlySet<string> = new Set([
  "standard",
  "deep",
  "move in out",
  "recurring",
  "commercial",
  "office",
  "turnover",
  "custom quote",
]);

/** How they found us. A closed set — UTM detail lives in custom fields. */
const SOURCE_VALUES: ReadonlySet<string> = new Set([
  "website",
  "google",
  "facebook",
  "instagram",
  "lsa",
  "referral",
  "admin",
  "partner",
  "turnover portal",
  "custom quote",
  "recycled",
]);

// Slot order IS priority order. When a contact exceeds the cap, the tail goes.
const SLOT_ORDER = [
  "action",
  "alert",
  "role",
  "status",
  "service",
  "zip",
  "source",
  "campaign",
] as const;

export type TagSlot = (typeof SLOT_ORDER)[number];

// ─── Normalization ──────────────────────────────────────────────────────────

// Categories we recognize as the left-hand side of a "category - value" tag.
const CATEGORY_ALIASES: Record<string, string> = {
  service: "service",
  svc: "service",
  zip: "zip",
  zone: "zip",
  member: "member",
  membership: "member",
  source: "source",
  src: "source",
  utm: "source",
  cmp: "campaign",
  campaign: "campaign",
  lead: "lead",
  booking: "booking",
  contractor: "contractor",
  cleaner: "contractor",
  partner: "partner",
  account: "partner",
  alert: "alert",
};

/**
 * Legacy and one-off tags → the canonical vocabulary. Keyed by the collapsed
 * (hyphen-joined, lowercase) form. This is what lets years of accumulated
 * shapes converge instead of being thrown away.
 */
const TAG_REMAP: Record<string, string> = {
  // Roles.
  "booking": "customer",
  "commercial-booking": "customer",
  "membership": "member",
  "str-host": "partner",
  "host-onboarding": "partner",
  "partner-host": "partner - host",

  // Lead stages.
  "lead": "lead - new",
  "lead-escalated": "lead - follow up",
  "speed-to-lead-miss": "alert - speed to lead miss",

  // Membership lifecycle.
  "membership-cancelled": "member - cancelled",
  "membership-paused": "member - paused",
  "membership-resumed": "member - resumed",

  // Booking lifecycle.
  "cancelled": "booking - cancelled",
  "rescheduled": "booking - rescheduled",

  // Contractor lifecycle: the status flags collapse onto one status tag
  // because every one of them is also a contractor_* custom field.
  "contractor-active": "contractor - active",
  "contractor-inactive": "contractor - inactive",
  "contractor-terminated": "contractor - terminated",
  "contractor-pending-approval": "contractor - pending approval",
  "contractor-approved": "contractor - approved",
  "onboarding-complete": "contractor - active",
  "onboarding-in-progress": "contractor - onboarding",

  // Call dispositions are a lead OUTCOME, so they land in the lead slot
  // rather than inventing a ninth category.
  "call-booked": "lead - booked",
  "call-callback": "lead - follow up",
  "call-completed": "lead - contacted",
  "call-dnc": "lead - unqualified",
  "call-no-answer": "lead - waiting reply",
  "call-not-interested": "lead - lost",
  "call-vm-left": "lead - waiting reply",

  // Partner account types.
  "account-commercial": "partner - commercial",
  "account-office": "partner - office",
  "account-partnership": "partner - host",
  "host-individual": "partner - host",
  "host-entity": "partner - host",

  // Services.
  "service-moveinout": "service - move in out",
  "service-move-in-out": "service - move in out",
  "one-time": "",
  "recurring": "service - recurring",

  // Retired outright — each of these is a GHL custom field already, so the tag
  // was duplicate data competing with the field for the truth.
  "payment-method-updated": "",
  "phone-verified": "",
  "stripe-connected": "",
  "payouts-enabled": "",
  "payouts-setup-started": "",
  "bg-check-passed": "",
  "bg-check-pending": "",
  "bg-check-failed": "",
  "bg-check-expired": "",
  "bg-check-expiring": "",
  "insurance-on-file": "",
  "insurance-unverified": "",
  "insurance-expired": "",
  "insurance-expiring": "",
  "agreement-signed": "",
  "discord-joined": "",
  "supplies-reviewed": "",
  "training-accessed": "",
  "short-notice-reschedule": "",
  "admin-rescheduled": "",
};

/**
 * Which slot a canonical tag occupies, and the key it competes for.
 *
 * Everything competes on its slot — one service, one ZIP, one role — EXCEPT
 * workflow triggers, which each get their own key. "send-host-agreement-entity"
 * and "host-agreement-sent" are applied together and mean different things to
 * GHL; collapsing them to one would drop the trigger and the host would never
 * receive their agreement.
 */
function slotAndValueFor(tag: string): { slot: TagSlot; key: string; value: string } | null {
  if (WORKFLOW_TRIGGER_TAGS.has(tag)) return { slot: "action", key: `action:${tag}`, value: tag };
  if ((ROLE_TAGS as readonly string[]).includes(tag)) return { slot: "role", key: "role", value: tag };

  const m = tag.match(/^([a-z ]+) - (.+)$/);
  if (!m) return null;
  const cat = m[1].trim();
  const value = m[2].trim();

  const slotted = (slot: TagSlot, v: string) => ({ slot, key: slot, value: v });
  if (cat === "alert") return ALERT_VALUES.has(value) ? slotted("alert", value) : null;
  if (cat === "service") return SERVICE_VALUES.has(value) ? slotted("service", value) : null;
  if (cat === "source") return SOURCE_VALUES.has(value) ? slotted("source", value) : null;
  if (cat === "campaign") return value ? slotted("campaign", value) : null;
  if (cat === "zip") return /^\d{5}$/.test(value) ? slotted("zip", value) : null;

  const statuses = STATUS_VALUES[cat];
  if (statuses) return statuses.has(value) ? slotted("status", `${cat} - ${value}`) : null;

  return null;
}

/**
 * Coerce a single raw tag into the canonical shape. Idempotent. Returns "" for
 * anything we have decided not to keep.
 */
export function normalizeTag(raw: string | null | undefined): string {
  if (!raw) return "";
  const lower = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (!lower) return "";

  // Collapse separator variants ("a - b", "a_b", "a:b", "a/b") to "a-b" so
  // legacy lookups and category detection are separator-agnostic.
  const collapsed = lower.replace(/\s*[-_:/]\s*/g, "-");
  if (collapsed in TAG_REMAP) return TAG_REMAP[collapsed];
  if (WORKFLOW_TRIGGER_TAGS.has(collapsed)) return collapsed;
  if ((ROLE_TAGS as readonly string[]).includes(collapsed)) return collapsed;

  const m = collapsed.match(/^([a-z]+)-(.+)$/);
  if (m) {
    const cat = CATEGORY_ALIASES[m[1]];
    if (cat) {
      const value = m[2].replace(/[-_:/]+/g, " ").replace(/\s+/g, " ").trim();
      return value ? `${cat} - ${value}` : "";
    }
  }

  // Unrecognized. Return the tidied form so the POLICY can decide to drop it —
  // normalization shouldn't be the thing that silently discards meaning.
  return lower;
}

/** Normalize + de-dupe a list of tags, dropping empties. */
export function normalizeTags(
  tags: (string | null | undefined)[] | null | undefined,
): string[] {
  if (!tags) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const n = normalizeTag(raw);
    if (!n || seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Is this tag part of the closed vocabulary? */
export function isCanonicalTag(tag: string | null | undefined): boolean {
  const n = normalizeTag(tag);
  return n ? slotAndValueFor(n) !== null : false;
}

export interface TagPolicyResult {
  /** The tags to send: canonical, one per slot, at most MAX_TAGS_PER_CONTACT. */
  tags: string[];
  /** Tags that were discarded, with why — so a caller can log it. */
  dropped: { tag: string; reason: string }[];
}

/**
 * Apply the policy to a set of tags.
 *
 * Later entries win within a slot, because callers list the tag they are
 * currently asserting last (a booking sync knows the current service; a stale
 * one from the contact's history does not).
 *
 * `keepUnknown` is for the cleanup tool, which needs to SEE unrecognized tags
 * rather than have them quietly filtered before it can report them.
 */
export function enforceTagPolicy(
  tags: (string | null | undefined)[] | null | undefined,
  opts: { max?: number } = {},
): TagPolicyResult {
  const max = Math.max(1, opts.max ?? MAX_TAGS_PER_CONTACT);
  const dropped: { tag: string; reason: string }[] = [];
  // Keyed by competition key, not slot: workflow triggers each hold their own.
  const byKey = new Map<string, { slot: TagSlot; tag: string }>();

  for (const raw of tags || []) {
    const original = String(raw ?? "").trim();
    if (!original) continue;

    const n = normalizeTag(original);
    if (!n) {
      dropped.push({ tag: original, reason: "retired — the same data lives in a custom field" });
      continue;
    }

    const placed = slotAndValueFor(n);
    if (!placed) {
      dropped.push({ tag: original, reason: "not in the tag vocabulary" });
      continue;
    }

    const existing = byKey.get(placed.key);
    if (existing && existing.tag !== n) {
      dropped.push({ tag: existing.tag, reason: `superseded by "${n}" in the ${placed.slot} slot` });
    }
    byKey.set(placed.key, { slot: placed.slot, tag: n });
  }

  // Priority order: whole slots in SLOT_ORDER, and within the action slot the
  // order the caller asserted them (insertion order of the Map).
  const ordered: string[] = [];
  for (const slot of SLOT_ORDER) {
    for (const entry of byKey.values()) {
      if (entry.slot === slot) ordered.push(entry.tag);
    }
  }

  if (ordered.length > max) {
    for (const t of ordered.slice(max)) {
      dropped.push({ tag: t, reason: `over the ${max}-tag limit (lowest priority slot)` });
    }
  }

  return { tags: ordered.slice(0, max), dropped };
}

/** Convenience: just the tags, policy applied. */
export function policyTags(tags: (string | null | undefined)[] | null | undefined): string[] {
  return enforceTagPolicy(tags).tags;
}

// ─── Canonical builders (use these instead of string templates) ────────────

export const serviceTag = (t?: string | null): string | null => {
  if (!t) return null;
  const v = String(t).replace(/[-_]+/g, " ").toLowerCase().trim();
  // "moveInOut" and friends arrive camel-cased from the booking funnel.
  const spaced = v.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const candidate = spaced === "moveinout" ? "move in out" : spaced;
  return SERVICE_VALUES.has(candidate) ? `service - ${candidate}` : null;
};

export const zipTag = (z?: string | null): string | null => {
  const v = String(z || "").trim();
  return /^\d{5}$/.test(v) ? `zip - ${v}` : null;
};

export const memberTag = (plan?: string | null): string | null => {
  if (!plan || plan === "none") return null;
  const v = String(plan).replace(/[-_]+/g, " ").toLowerCase().trim();
  return STATUS_VALUES.member.has(v) ? `member - ${v}` : "member";
};

export const sourceTag = (s?: string | null): string | null => {
  if (!s) return null;
  const v = String(s).replace(/[-_]+/g, " ").toLowerCase().trim();
  // Fold the provider-specific spellings we get from ad platforms.
  const folded = v
    .replace(/^fb.*$/, "facebook")
    .replace(/^ig.*$/, "instagram")
    .replace(/^google.*$/, "google")
    .replace(/^web.*$/, "website");
  return SOURCE_VALUES.has(folded) ? `source - ${folded}` : null;
};

export const campaignTag = (c?: string | null): string | null =>
  c ? `campaign - ${String(c).replace(/[-_]+/g, " ").toLowerCase().trim()}` : null;

export const roleTag = (role: (typeof ROLE_TAGS)[number]): string => role;

/** Every tag the vocabulary can produce, for the cleanup tool and docs. */
export function vocabularySummary(): Record<string, string[]> {
  return {
    action: [...WORKFLOW_TRIGGER_TAGS],
    alert: [...ALERT_VALUES].map((v) => `alert - ${v}`),
    role: [...ROLE_TAGS],
    status: Object.entries(STATUS_VALUES).flatMap(([cat, vals]) =>
      [...vals].map((v) => `${cat} - ${v}`)
    ),
    service: [...SERVICE_VALUES].map((v) => `service - ${v}`),
    zip: ["zip - <5 digits>"],
    source: [...SOURCE_VALUES].map((v) => `source - ${v}`),
    campaign: ["campaign - <name>"],
  };
}
