// ─── GHL tag taxonomy + normalizer ────────────────────────────────────────
//
// One place that decides what a GHL contact tag looks like. Every tag we send
// is coerced into a consistent `category - value` shape (lowercase, single
// " - " separator) so the GHL account stays organized instead of accumulating
// random one-off tags like "lead-escalated", "src-fb", "membership-paused".
//
// Lead lifecycle stages are a fixed, reusable vocabulary — callers should use
// `leadStageTag()` / LEAD_STAGES rather than inventing new lead tags.

/** Canonical lead lifecycle stages (the only lead-* tags we ever create). */
export const LEAD_STAGES = [
  "cold",
  "contacted",
  "engaged",
  "follow-up",
  "lost",
  "new",
  "quoted",
  "unqualified",
  "waiting reply",
  "warm",
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

/** Build the canonical lead-stage tag, e.g. "lead - warm". */
export function leadStageTag(stage: LeadStage | string): string {
  return `lead - ${String(stage).trim().toLowerCase().replace(/[-_]+/g, "-")}`;
}

/** The full set of canonical lead-stage tags (used for mutual exclusivity). */
export const LEAD_STAGE_TAG_SET: ReadonlySet<string> = new Set(
  LEAD_STAGES.map((s) => leadStageTag(s)),
);

/** Map a free-text lead score / temperature onto a canonical lead stage. */
export function leadStageFromScore(score: string | null | undefined): LeadStage {
  const s = String(score || "").trim().toLowerCase();
  if ((LEAD_STAGES as readonly string[]).includes(s)) return s as LeadStage;
  if (/hot|high/.test(s)) return "warm";
  if (/cool|low/.test(s)) return "cold";
  return "new";
}

// Categories we recognize as the left-hand side of a "category - value" tag.
// Any prefix here gets reformatted; everything else is just whitespace/
// case-normalized so we never silently drop a meaningful tag.
const CATEGORY_ALIASES: Record<string, string> = {
  service: "service",
  zip: "zip",
  member: "member",
  membership: "member",
  source: "source",
  src: "source",
  cmp: "campaign",
  campaign: "campaign",
  lead: "lead",
  payment: "payment",
  booking: "booking",
  customer: "customer",
  dispatch: "dispatch",
  cleaner: "cleaner",
  referral: "referral",
  waitlist: "waitlist",
  market: "market",
  cancel: "cancel",
  was: "former member",
  alert: "alert",
};

// Legacy one-off tags → canonical taxonomy. Keyed by the collapsed
// (hyphen-joined, lowercase) form of the incoming tag.
const TAG_REMAP: Record<string, string> = {
  "lead": "lead - new",
  "lead-escalated": "lead - follow-up",
  "speed-to-lead-miss": "lead - waiting reply",
  "admin-booked": "source - admin",
  "payment-method-updated": "payment - method updated",
  "membership-cancelled": "member - cancelled",
  "membership-paused": "member - paused",
  "membership-resumed": "member - resumed",
};

/**
 * Coerce a single raw tag into the canonical `category - value` shape.
 * Idempotent: a tag that is already canonical comes back unchanged.
 */
export function normalizeTag(raw: string | null | undefined): string {
  if (!raw) return "";
  const lower = String(raw).trim().toLowerCase().replace(/\s+/g, " ");
  if (!lower) return "";

  // Collapse all separator variants ("a - b", "a_b", "a:b", "a/b") to "a-b"
  // so legacy lookups and category detection are separator-agnostic.
  const collapsed = lower.replace(/\s*[-_:/]\s*/g, "-");
  if (TAG_REMAP[collapsed]) return TAG_REMAP[collapsed];

  const m = collapsed.match(/^([a-z]+)-(.+)$/);
  if (m) {
    const cat = CATEGORY_ALIASES[m[1]];
    if (cat) {
      const value = m[2].replace(/[-_:/]+/g, " ").replace(/\s+/g, " ").trim();
      return value ? `${cat} - ${value}` : cat;
    }
  }

  // No recognized category — keep the meaning but standardize spacing/case.
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

// ─── Canonical builders (use these instead of string templates) ────────────

export const serviceTag = (t?: string | null): string | null =>
  t ? `service - ${String(t).replace(/[-_]+/g, " ").toLowerCase().trim()}` : null;

export const zipTag = (z?: string | null): string | null =>
  z ? `zip - ${String(z).trim()}` : null;

export const memberTag = (plan?: string | null): string | null =>
  plan && plan !== "none"
    ? `member - ${String(plan).replace(/[-_]+/g, " ").toLowerCase().trim()}`
    : null;

export const sourceTag = (s?: string | null): string | null =>
  s ? `source - ${String(s).replace(/[-_]+/g, " ").toLowerCase().trim()}` : null;

export const campaignTag = (c?: string | null): string | null =>
  c ? `campaign - ${String(c).replace(/[-_]+/g, " ").toLowerCase().trim()}` : null;
