import { DEFAULT_INTAKE_SETTINGS, type IntakeSettings } from "./settings";
import { imageDeleteOn } from "./onboarding";
import { retentionDeleteOn } from "./verification";

const NOT_APPROVED = new Set(["not_a_fit", "waitlist", "expired", "withdrawn"]);

export interface IdRetentionInput {
  stage: string;
  decidedAt: string | null;
  uploadedAt: string | null;
  hasHold: boolean;
  identityResultAt: string | null;
  now: Date;
  settings?: IntakeSettings;
}

export interface IdRetentionPlan {
  delete: boolean;
  reason: "hold" | "not_approved" | "undecided" | "approved_identity" | "keep";
  dueAt: string | null;
}

export function planIdDeletion(input: IdRetentionInput): IdRetentionPlan {
  const settings = input.settings || DEFAULT_INTAKE_SETTINGS;
  if (input.hasHold) return { delete: false, reason: "hold", dueAt: null };

  const decided = input.decidedAt ? new Date(input.decidedAt) : null;
  const uploaded = input.uploadedAt ? new Date(input.uploadedAt) : null;
  if (NOT_APPROVED.has(input.stage) && decided && !Number.isNaN(decided.getTime())) {
    const due = retentionDeleteOn(decided, settings);
    return { delete: input.now.getTime() >= due.getTime(), reason: "not_approved", dueAt: due.toISOString() };
  }
  if (input.identityResultAt) {
    const resultAt = new Date(input.identityResultAt);
    if (!Number.isNaN(resultAt.getTime())) {
      const due = imageDeleteOn(resultAt, settings);
      return { delete: input.now.getTime() >= due.getTime(), reason: "approved_identity", dueAt: due.toISOString() };
    }
  }
  if (uploaded && !Number.isNaN(uploaded.getTime()) && !NOT_APPROVED.has(input.stage) && input.stage !== "active" && input.stage !== "onboarding" && input.stage !== "conditional_approval") {
    const due = retentionDeleteOn(uploaded, settings);
    return { delete: input.now.getTime() >= due.getTime(), reason: "undecided", dueAt: due.toISOString() };
  }
  return { delete: false, reason: "keep", dueAt: null };
}
