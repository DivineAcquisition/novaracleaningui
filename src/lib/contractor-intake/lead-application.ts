export const LEAD_EXPERIENCE_QUESTIONS = [
  { id: "years", prompt: "How many years have you cleaned professionally?", choices: ["Under 1", "1 to 2", "3 to 5", "More than 5"] },
  { id: "job_types", prompt: "Which job types have you done regularly?", choices: ["Standard", "Deep", "Move-in or move-out", "Short-term rental turnover", "Commercial", "Post-construction"] },
  { id: "led_team", prompt: "Have you led or worked as the lead on a 2-person or team cleaning job?" },
  { id: "split_work", prompt: "Describe how you split work with a second cleaner on a large deep clean so the job finishes on time." },
  { id: "showed_new", prompt: "Have you shown a new cleaner how to do the work before?" },
] as const;

export const LEAD_SCENARIOS = [
  { id: "upset_client", prompt: "At the final walkthrough, the client points out a spot you both missed and is upset. What do you do?" },
  { id: "helper_late", prompt: "Your helper is 30 minutes late and the client has a hard finish time. What do you do, and who do you tell?" },
  { id: "missed_item", prompt: "During your walkthrough you find a checklist item that was not done and the helper has already left. What do you do?" },
  { id: "skipped_step", prompt: "On a trial job, the new cleaner keeps skipping a step you showed them. How do you handle it, and what do you record?" },
] as const;

export const LEAD_RUBRIC = [
  "Puts the client experience first",
  "Communicates with Novara through the app",
  "Owns fixing the work",
  "Records facts, not opinions",
  "Stays respectful",
] as const;

export type RubricRating = "meets" | "does_not_meet";

export interface RubricMark {
  scenarioId: string;
  rating: RubricRating;
  note?: string | null;
}

export type LeadDecisionKind = "approve" | "decline" | "lead_track";

export function reviewLeadApplication(input: {
  decision: LeadDecisionKind;
  note: string;
  addendumSigned: boolean;
  rubric: RubricMark[];
}): { ok: true } | { ok: false; error: string } {
  if (!input.note.trim()) return { ok: false, error: "A note is required." };
  if (input.decision === "approve" && !input.addendumSigned) {
    return { ok: false, error: "Approval requires the signed Lead Cleaner addendum." };
  }
  const scenarios = new Set(LEAD_SCENARIOS.map((row) => row.id));
  for (const mark of input.rubric) {
    if (!scenarios.has(mark.scenarioId as (typeof LEAD_SCENARIOS)[number]["id"])) {
      return { ok: false, error: "The rubric has an unknown question." };
    }
    if (mark.rating !== "meets" && mark.rating !== "does_not_meet") {
      return { ok: false, error: "Each rubric mark is Meets or Does not meet." };
    }
  }
  return { ok: true };
}

export function outsideLeadRecordLabel(): string {
  return "No Novara record yet: Lead Track";
}
