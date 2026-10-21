import { DEFAULT_INTAKE_SETTINGS, type IntakeSettings } from "./settings";

export interface ReliabilityRecord {
  active: boolean;
  inProbation: boolean;
  tenureDays: number;
  completedJobs: number;
  novaraScore: number;
  noShows: number;
  lateCancellations: number;
  openComplaints: number;
  openQcCases: number;
  vehicleVerified: boolean;
  kitConfirmed: boolean;
}

export function leadEligible(record: ReliabilityRecord, settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS): { ok: boolean; missed: string[] } {
  const missed: string[] = [];
  if (!record.active || record.inProbation) missed.push("Active and out of probation");
  if (record.tenureDays < settings.leadMinTenureDays) missed.push(`At least ${settings.leadMinTenureDays} days on the network`);
  if (record.completedJobs < settings.leadMinCompletedJobs) missed.push(`At least ${settings.leadMinCompletedJobs} completed jobs`);
  if (record.novaraScore < settings.leadMinScore) missed.push(`Novara Score of at least ${settings.leadMinScore}`);
  if (record.noShows > 0) missed.push("No no-shows in the review window");
  if (record.lateCancellations > settings.leadMaxLateCancellations) missed.push("Late cancellations within the allowed number");
  if (record.openComplaints > 0 || record.openQcCases > 0) missed.push("No unresolved complaints or open QC cases");
  if (!record.vehicleVerified || !record.kitConfirmed) missed.push("Verified vehicle and a confirmed supply kit");
  return { ok: missed.length === 0, missed };
}

export type SoloTier = "foundation" | "proven" | "elite";

const SOLO_RATES: Record<SoloTier, number> = { foundation: 35, proven: 40, elite: 45 };

export function soloRate(tier: SoloTier): number {
  return SOLO_RATES[tier];
}

export function leadJobRate(settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS): number {
  return settings.leadPayPercent;
}

export interface LeadAssignment {
  leadPercent: number;
  helperPercent: number;
  laborPercent: number;
  cap: number | null;
  needsAdmin: boolean;
  reason: string | null;
}

export function reviewLeadAssignment(settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS): LeadAssignment {
  const leadPercent = settings.leadPayPercent;
  const helperPercent = settings.helperPayPercent;
  const laborPercent = leadPercent + helperPercent;
  const cap = settings.laborCapPercent;
  if (cap == null) {
    return { leadPercent, helperPercent, laborPercent, cap, needsAdmin: true, reason: "The labor cap is not set. A person has to approve this lead job." };
  }
  if (laborPercent > cap) {
    return { leadPercent, helperPercent, laborPercent, cap, needsAdmin: true, reason: `Lead share plus helper share is ${laborPercent}%, above the ${cap}% labor cap.` };
  }
  return { leadPercent, helperPercent, laborPercent, cap, needsAdmin: false, reason: null };
}

export function leadPayCents(jobTotalCents: number, settings?: IntakeSettings): number {
  return Math.round(jobTotalCents * (leadJobRate(settings) / 100));
}

export function helperPayCents(jobTotalCents: number, settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS): number {
  return Math.round(jobTotalCents * (settings.helperPayPercent / 100));
}

export function leadStatusAfterReview(stillEligible: boolean): "lead" | "paused" {
  return stillEligible ? "lead" : "paused";
}

export function pauseMessage(missed: string[]): string {
  return `Lead status is paused. ${missed[0] || "A minimum was missed."} You are still an active cleaner. Lead jobs resume when the minimum is met.`;
}

export function canCloseLeadJob(input: { leadJob: boolean; checklistDone: boolean; photoCount: number }): { ok: boolean; reason: string | null } {
  if (!input.leadJob) return { ok: true, reason: null };
  if (!input.checklistDone || input.photoCount < 1) {
    return { ok: false, reason: "A lead job stays open until the walkthrough checklist and completion photos are done." };
  }
  return { ok: true, reason: null };
}

export function leadWalkthroughSummaryLines(input: { checklistDone: boolean; photoCount: number; note?: string | null }): string[] {
  return [
    `Lead walkthrough checklist: ${input.checklistDone ? "complete" : "not complete"}`,
    `Lead walkthrough photos: ${Math.max(0, input.photoCount)}`,
    `Lead walkthrough note: ${(input.note || "").trim() || "not recorded"}`,
  ];
}

/** A Lead Cleaner records facts. The outcome is not part of what they can set. */
export function trialReportForAdmin(input: {
  arrivedOnTime: boolean;
  checklistCompleted: string[];
  itemsDemonstrated: string[];
  photoCount: number;
  note: string;
  outcome?: string | null;
}): { arrivedOnTime: boolean; checklistCompleted: string[]; itemsDemonstrated: string[]; photoCount: number; note: string } {
  return {
    arrivedOnTime: input.arrivedOnTime,
    checklistCompleted: input.checklistCompleted,
    itemsDemonstrated: input.itemsDemonstrated,
    photoCount: input.photoCount,
    note: input.note.trim(),
  };
}

export function leadCanSetTrialOutcome(): false {
  return false;
}

export function nextLeadOffer<T extends { id: string }>(candidates: T[], declinedOrUnanswered: string[]): T | null {
  const skipped = new Set(declinedOrUnanswered);
  return candidates.find((row) => !skipped.has(row.id)) || null;
}

export function invitationsNeedAdminApproval(adminApproved: boolean): boolean {
  return adminApproved === true;
}

export function stepDownFromLead(): { leadStatus: null; stillActiveCleaner: true; log: string } {
  return { leadStatus: null, stillActiveCleaner: true, log: "Stepped down from lead status. Still an active cleaner." };
}

export function jobMargin(jobTotalCents: number, laborCents: number): { laborPercent: number; marginPercent: number } {
  const total = Math.max(0, Math.round(jobTotalCents));
  const labor = Math.max(0, Math.round(laborCents));
  if (total === 0) return { laborPercent: 0, marginPercent: 0 };
  const laborPercent = Math.round((labor / total) * 1000) / 10;
  return { laborPercent, marginPercent: Math.round((100 - laborPercent) * 10) / 10 };
}

export const LEAD_GUARDRAILS = [
  "You may accept or decline any lead job, trial job, or backup offer.",
  "You cannot approve, reject, discipline, set pay for, or remove another contractor.",
  "Walkthrough notes and trial reports are facts and photos. Novara decides the trial.",
  "Novara pays every contractor directly.",
];
