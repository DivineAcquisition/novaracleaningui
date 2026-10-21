import { DEFAULT_INTAKE_SETTINGS, type IntakeSettings } from "./settings";
import { imagesOverdue, type ComplianceRecord } from "./onboarding";

export function identityPath(consented: boolean): "provider" | "manual_review" {
  return consented ? "provider" : "manual_review";
}

export function acceptVehiclePhoto(source: string, takenAt: string | null): { ok: boolean; error: string | null } {
  if (source !== "camera") {
    return { ok: false, error: "Take the vehicle photo in the app. A photo from your library is not accepted." };
  }
  if (!takenAt || Number.isNaN(Date.parse(takenAt))) {
    return { ok: false, error: "The vehicle photo needs a time and date." };
  }
  return { ok: true, error: null };
}

export function kitBlocksJobs(confirmed: boolean): boolean {
  return !confirmed;
}

export function householdVehicleRoute(applicantIsOwner: boolean, listedDriver: boolean, settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS): "clear" | "needs_review" {
  if (applicantIsOwner) return "clear";
  if (listedDriver && settings.householdVehicleNeedsReview) return "needs_review";
  if (listedDriver) return "clear";
  return "needs_review";
}

export interface IntakeAcceptanceInput {
  id: string;
  version: number;
  status: "draft" | "reviewed";
  wording: string;
  acceptedAt: string;
  ip: string | null;
  device: string | null;
}

export function acceptanceRecord(input: IntakeAcceptanceInput): IntakeAcceptanceInput {
  return { ...input, device: (input.device || "").slice(0, 500) || null };
}

export interface DashboardRow {
  id: string;
  active: boolean;
  consentDraft: boolean;
  adverseWaitOpen: boolean;
  reviewOverdue: boolean;
  imagesOverdue: boolean;
  complianceComplete: boolean;
}

export function complianceDashboard(rows: DashboardRow[]): {
  draftConsents: number;
  adverseWaiting: number;
  overdueReviews: number;
  imagesPastDeletion: number;
  activeMissingCompliance: number;
} {
  return {
    draftConsents: rows.filter((row) => row.consentDraft).length,
    adverseWaiting: rows.filter((row) => row.adverseWaitOpen).length,
    overdueReviews: rows.filter((row) => row.reviewOverdue).length,
    imagesPastDeletion: rows.filter((row) => row.imagesOverdue).length,
    activeMissingCompliance: rows.filter((row) => row.active && !row.complianceComplete).length,
  };
}

export function imageDeletionFlag(resultAt: string | null, deletedAt: string | null, now: Date, settings?: IntakeSettings): boolean {
  if (!resultAt) return false;
  return imagesOverdue(new Date(resultAt), Boolean(deletedAt), now, settings || DEFAULT_INTAKE_SETTINGS);
}

export function retentionDeleteOn(decidedAt: Date, settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS): Date {
  const copy = new Date(decidedAt.getTime());
  copy.setUTCMonth(copy.getUTCMonth() + settings.applicantRetentionMonths);
  return copy;
}

export const PIPELINE_STAGES = [
  "applied",
  "conditional_approval",
  "onboarding",
  "needs_review",
  "background_check",
  "pending_adverse_action",
  "trial",
  "active_probation",
  "not_a_fit",
  "waitlist",
  "expired",
] as const;

export function countByStage(stages: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const stage of PIPELINE_STAGES) counts[stage] = 0;
  for (const stage of stages) counts[stage] = (counts[stage] || 0) + 1;
  return counts;
}

export function activationBlockers(record: ComplianceRecord): string[] {
  const missing: string[] = [];
  if (!record.consents.length) missing.push("No consents are on file.");
  if (!record.backgroundClearOrReviewed) missing.push("The background check is not clear and has not been reviewed.");
  if (!record.identityResolved) missing.push("Identity is not resolved.");
  if (!record.vehicleResolved) missing.push("The vehicle is not resolved.");
  if (!record.kitConfirmed) missing.push("The supply kit is not confirmed.");
  if (!record.agreementSigned) missing.push("The agreement is not signed.");
  if (!record.w9Complete) missing.push("The W-9 is not complete.");
  if (!record.payoutSet) missing.push("A payout method is not set.");
  if (!record.trainingPassed) missing.push("Training is not passed.");
  if (!record.trialPassedByAdmin) missing.push("An admin has not passed the trial job.");
  if (record.nameMismatchOpen) missing.push("A name mismatch is still open.");
  return missing;
}
