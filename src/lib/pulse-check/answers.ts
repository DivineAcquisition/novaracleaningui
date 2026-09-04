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
    label: "Yes, still active",
    hint: "I'm interested in taking jobs with NovaraCleaning",
  },
  {
    value: "step_away",
    label: "No, I need to step away for now",
    hint: "We'll flag this for the office — nothing changes automatically",
  },
  {
    value: "not_sure",
    label: "I'm not sure, I'd like to talk to someone",
    hint: "Someone from the office will follow up",
  },
] as const;

export const PULSE_ABILITY_OPTIONS = [
  { value: "able", label: "No, I'm able to work" },
  { value: "blocked", label: "Yes — something is preventing me right now" },
] as const;

export type PulseStatusAnswer = (typeof PULSE_STATUS_OPTIONS)[number]["value"];
export type PulseAbilityAnswer = (typeof PULSE_ABILITY_OPTIONS)[number]["value"];
export type PulseOutcome = "pending" | "completed" | "needs_review" | "no_response";

export interface PulseDraft {
  status: PulseStatusAnswer | "";
  ability: PulseAbilityAnswer | "";
  abilityNote: string;
  preferredWorkDays: string[];
  noWorkAfter: string;
  noWorkBefore: string;
}

export const EMPTY_PULSE_DRAFT: PulseDraft = {
  status: "",
  ability: "",
  abilityNote: "",
  preferredWorkDays: [],
  noWorkAfter: "",
  noWorkBefore: "",
};

const DAY_SET = new Set<string>(PULSE_DAYS.map((d) => d.value));

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
  const status = PULSE_STATUS_OPTIONS.some((o) => o.value === statusRaw)
    ? (statusRaw as PulseStatusAnswer)
    : "";
  const ability = PULSE_ABILITY_OPTIONS.some((o) => o.value === abilityRaw)
    ? (abilityRaw as PulseAbilityAnswer)
    : "";
  return {
    status,
    ability,
    abilityNote: String(src.abilityNote ?? src.ability_note ?? fallback?.abilityNote ?? "").slice(0, 500),
    preferredWorkDays: asDays(src.preferredWorkDays ?? src.preferred_work_days ?? fallback?.preferredWorkDays),
    noWorkAfter: String(src.noWorkAfter ?? src.no_work_after ?? fallback?.noWorkAfter ?? "").trim().slice(0, 32),
    noWorkBefore: String(src.noWorkBefore ?? src.no_work_before ?? fallback?.noWorkBefore ?? "").trim().slice(0, 32),
  };
}

export function pulseDraftComplete(draft: PulseDraft): boolean {
  if (!draft.status || !draft.ability) return false;
  if (draft.ability === "blocked" && !draft.abilityNote.trim()) return false;
  return true;
}

export function outcomeFromAnswers(draft: PulseDraft): Exclude<PulseOutcome, "pending" | "no_response"> {
  if (draft.status === "still_active" && draft.ability === "able") return "completed";
  return "needs_review";
}

/** Roster / score fields this flow is forbidden from writing. */
export const PULSE_FORBIDDEN_CLEANER_FIELDS = [
  "status",
  "available_for_bookings",
  "approved",
  "novara_score",
  "quality_score",
  "overall_score",
  "weighted_score",
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
