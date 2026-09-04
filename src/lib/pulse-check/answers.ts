export const PULSE_DAYS = [
  { value: "Mon", label: "Mon" },
  { value: "Tue", label: "Tue" },
  { value: "Wed", label: "Wed" },
  { value: "Thu", label: "Thu" },
  { value: "Fri", label: "Fri" },
  { value: "Sat", label: "Sat" },
  { value: "Sun", label: "Sun" },
] as const;

export type PulseDay = (typeof PULSE_DAYS)[number]["value"];

export const PULSE_STATUS_OPTIONS = [
  {
    value: "still_active",
    label: "Yes — I want to keep working with Novara",
    hint: "Stay on the roster and keep getting jobs",
  },
  {
    value: "step_away",
    label: "I need some time away",
    hint: "A short pause is OK. A full month means we close the contractor account",
  },
  {
    value: "leave",
    label: "No — I don't want to be a Novara contractor",
    hint: "This closes your account today. You cannot reapply for 3 months",
  },
] as const;

/** Kept so history rows from the first pulse-check cycle still render. */
export const PULSE_LEGACY_STATUS = ["not_sure"] as const;

export const PULSE_ABILITY_OPTIONS = [
  { value: "able", label: "No, I'm able to work" },
  { value: "blocked", label: "Yes — something is preventing me right now" },
] as const;

export const PULSE_TIME_AWAY_OPTIONS = [
  { value: "1_week", days: 7, label: "1 week" },
  { value: "2_weeks", days: 14, label: "2 weeks" },
  { value: "1_month", days: 30, label: "1 month" },
] as const;

export type PulseStatusAnswer = (typeof PULSE_STATUS_OPTIONS)[number]["value"] | "not_sure";
export type PulseAbilityAnswer = (typeof PULSE_ABILITY_OPTIONS)[number]["value"];
export type PulseTimeAway = (typeof PULSE_TIME_AWAY_OPTIONS)[number]["value"];
export type PulseOutcome = "pending" | "completed" | "needs_review" | "no_response";
export type PulseRosterAction = "none" | "inactive" | "terminate";

export interface PulseDraft {
  status: PulseStatusAnswer | "";
  ability: PulseAbilityAnswer | "";
  abilityNote: string;
  timeAway: PulseTimeAway | "";
  acknowledged: boolean;
  preferredWorkDays: string[];
  noWorkAfter: string;
  noWorkBefore: string;
}

export const EMPTY_PULSE_DRAFT: PulseDraft = {
  status: "",
  ability: "",
  abilityNote: "",
  timeAway: "",
  acknowledged: false,
  preferredWorkDays: [],
  noWorkAfter: "",
  noWorkBefore: "",
};

const DAY_SET = new Set<string>(PULSE_DAYS.map((d) => d.value));
const STATUS_SET = new Set<string>([
  ...PULSE_STATUS_OPTIONS.map((o) => o.value),
  ...PULSE_LEGACY_STATUS,
]);
const TIME_AWAY_SET = new Set<string>(PULSE_TIME_AWAY_OPTIONS.map((o) => o.value));

function asDays(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/[,\s/]+/)
      : [];
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item || "").trim();
    if (!s) continue;
    const short = s.slice(0, 3);
    const match = PULSE_DAYS.find(
      (d) => d.value.toLowerCase() === short.toLowerCase() || d.value.toLowerCase() === s.toLowerCase(),
    );
    const canonical = match?.value || (DAY_SET.has(short) ? short : null);
    if (canonical && !out.includes(canonical)) out.push(canonical);
  }
  return out;
}

export function normalizePulseDraft(raw: unknown, fallback?: Partial<PulseDraft>): PulseDraft {
  const src = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const statusRaw = String(src.status ?? fallback?.status ?? "").trim();
  const abilityRaw = String(src.ability ?? fallback?.ability ?? "").trim();
  const timeAwayRaw = String(src.timeAway ?? src.time_away ?? fallback?.timeAway ?? "").trim();
  const status = STATUS_SET.has(statusRaw) ? (statusRaw as PulseStatusAnswer) : "";
  const ability = PULSE_ABILITY_OPTIONS.some((o) => o.value === abilityRaw)
    ? (abilityRaw as PulseAbilityAnswer)
    : "";
  const timeAway = TIME_AWAY_SET.has(timeAwayRaw) ? (timeAwayRaw as PulseTimeAway) : "";
  const acknowledgedRaw = src.acknowledged ?? src.acknowledge ?? fallback?.acknowledged;
  return {
    status,
    ability,
    abilityNote: String(src.abilityNote ?? src.ability_note ?? fallback?.abilityNote ?? "").slice(0, 500),
    timeAway,
    acknowledged: acknowledgedRaw === true || acknowledgedRaw === "true" || acknowledgedRaw === 1,
    preferredWorkDays: asDays(src.preferredWorkDays ?? src.preferred_work_days ?? fallback?.preferredWorkDays),
    noWorkAfter: String(src.noWorkAfter ?? src.no_work_after ?? fallback?.noWorkAfter ?? "").trim().slice(0, 32),
    noWorkBefore: String(src.noWorkBefore ?? src.no_work_before ?? fallback?.noWorkBefore ?? "").trim().slice(0, 32),
  };
}

export function pulseDraftComplete(draft: PulseDraft): boolean {
  if (draft.status === "still_active") {
    if (!draft.ability) return false;
    if (draft.ability === "blocked" && !draft.abilityNote.trim()) return false;
    return true;
  }
  if (draft.status === "step_away") {
    if (!draft.timeAway) return false;
    if (draft.timeAway === "1_month" && !draft.acknowledged) return false;
    return true;
  }
  if (draft.status === "leave") {
    return Boolean(draft.acknowledged);
  }
  return false;
}

export function rosterActionFromDraft(draft: PulseDraft): PulseRosterAction {
  if (draft.status === "leave") return "terminate";
  if (draft.status === "step_away" && draft.timeAway === "1_month") return "terminate";
  if (draft.status === "step_away" && (draft.timeAway === "1_week" || draft.timeAway === "2_weeks")) {
    return "inactive";
  }
  return "none";
}

export function timeAwayDays(timeAway: PulseTimeAway | "" | null | undefined): number | null {
  const opt = PULSE_TIME_AWAY_OPTIONS.find((o) => o.value === timeAway);
  return opt ? opt.days : null;
}

export function outcomeFromAnswers(draft: PulseDraft): Exclude<PulseOutcome, "pending" | "no_response"> {
  if (draft.status === "still_active" && draft.ability === "able") return "completed";
  if (rosterActionFromDraft(draft) !== "none") return "completed";
  return "needs_review";
}

/** Availability writes never include roster/score fields. Roster changes go through applyPulseRosterChange. */
export const PULSE_FORBIDDEN_CLEANER_FIELDS = [
  "status",
  "available_for_bookings",
  "approved",
  "novara_score",
  "quality_score",
  "overall_score",
  "weighted_score",
  "inactive_until",
  "reapply_eligible_at",
  "terminated_at",
  "rehire_status",
] as const;

export function availabilityChanged(
  draft: PulseDraft,
  onFile: { preferredWorkDays: string[]; noWorkAfter: string; noWorkBefore: string },
): boolean {
  const a = [...draft.preferredWorkDays].sort().join(",");
  const b = [...onFile.preferredWorkDays].sort().join(",");
  return (
    a !== b ||
    draft.noWorkAfter.trim() !== onFile.noWorkAfter.trim() ||
    draft.noWorkBefore.trim() !== onFile.noWorkBefore.trim()
  );
}

export function availabilityPatch(
  draft: PulseDraft,
  existingConstraints: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const constraints = {
    ...(existingConstraints && typeof existingConstraints === "object" ? existingConstraints : {}),
    no_work_after: draft.noWorkAfter.trim() || null,
    no_work_before: draft.noWorkBefore.trim() || null,
  };
  return {
    preferred_work_days: draft.preferredWorkDays,
    constraints,
  };
}

export function staleOutcome(args: {
  submitted: boolean;
  claimedCount: number;
}): PulseOutcome {
  if (args.submitted) {
    return "completed";
  }
  if (args.claimedCount > 0) return "completed";
  return "no_response";
}

export function claimTakenMessage(reason: string | null | undefined): string {
  const r = String(reason || "").toLowerCase();
  if (r === "taken" || r === "already_taken" || r.includes("no longer available")) {
    return "That job was just claimed by someone else. It's been removed from your list.";
  }
  if (r === "overlap") {
    return "You already accepted another job that overlaps this time window.";
  }
  if (r === "buffer_conflict") {
    return "This starts too soon after another job on your schedule. We've told the office.";
  }
  if (r === "expired") {
    return "That job is no longer available.";
  }
  return "That job is no longer available. It's been removed from your list.";
}

export function pulseAnswersPayload(draft: PulseDraft, extra?: Record<string, unknown>): Record<string, unknown> {
  return {
    status: draft.status,
    ability: draft.ability,
    abilityNote: draft.abilityNote,
    timeAway: draft.timeAway,
    acknowledged: draft.acknowledged,
    preferredWorkDays: draft.preferredWorkDays,
    noWorkAfter: draft.noWorkAfter,
    noWorkBefore: draft.noWorkBefore,
    rosterAction: rosterActionFromDraft(draft),
    ...extra,
  };
}
