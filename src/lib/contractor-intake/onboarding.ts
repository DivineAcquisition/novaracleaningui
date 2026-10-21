import { addBusinessDays, DEFAULT_INTAKE_SETTINGS, type IntakeSettings } from "./settings";
import { INTAKE_WORDING, type WordingVersion } from "./wording";

export interface CompliancePanel {
  step: string;
  collects: string;
  why: string;
  whoSees: string;
  retention: string;
  rights: string;
  wordingId: string;
}

export const ONBOARDING_PANELS: CompliancePanel[] = [
  { step: "welcome", collects: "Nothing new. This is the checklist.", why: "So you can see every step and its deadline before you start.", whoSees: "You and Novara admins.", retention: "Kept with your application.", rights: "Email operations@novaracleaning.com with a question or an accommodation request.", wordingId: "application_privacy" },
  { step: "identity", collects: "A government ID and a live selfie, or a secure upload reviewed by a person.", why: "To confirm you are the person who applied.", whoSees: "Novara admins and the identity verification provider.", retention: "Images are deleted after the result. The pass or fail result and date are kept.", rights: "You can decline the face match and use manual review instead.", wordingId: "identity_consent" },
  { step: "vehicle", collects: "Driver's license, registration or insurance, and an in-app photo of the vehicle with the plate.", why: "Jobs require driving between homes with a full supply kit.", whoSees: "Novara admins.", retention: "Kept while you are active, then for the retention period in settings.", rights: "A name mismatch is reviewed by a person. It is not an automatic rejection.", wordingId: "vehicle_reason" },
  { step: "kit", collects: "A checklist and an in-app photo of your supply kit.", why: "You bring your own products and equipment.", whoSees: "Novara admins.", retention: "The photo is kept with your contractor record while you are active.", rights: "You can finish the other steps with an incomplete kit. Jobs stay blocked until the kit is confirmed.", wordingId: "why_supplies" },
  { step: "background", collects: "Authorization for a consumer report. No criminal-history question is on the application.", why: "People on the network enter clients' homes.", whoSees: "Novara admins and the background check company.", retention: "The report is stored only as the provider requires. Views are logged.", rights: "Anything other than a clear result is reviewed by a person. You can explain or dispute it before a decision.", wordingId: "background_disclosure" },
  { step: "agreement", collects: "Your signature on the Independent Contractor Agreement.", why: "It is the contract for the work.", whoSees: "Novara admins.", retention: "Kept with the signed agreement.", rights: "You get a copy by email after you sign.", wordingId: "independent_contractor" },
  { step: "w9", collects: "Legal name, tax classification, and taxpayer ID.", why: "Required to pay you and to file a 1099-NEC when the IRS threshold is met.", whoSees: "Novara payroll admins.", retention: "Kept for tax records. The number is masked everywhere else.", rights: "The taxpayer ID is never sent in a message.", wordingId: "independent_contractor" },
  { step: "payout", collects: "The payout method you choose.", why: "So completed jobs can be paid.", whoSees: "Novara payroll admins and the payout provider.", retention: "Kept while the method is on file.", rights: "Stripe, Cash App, Zelle, and Chime are the methods already offered.", wordingId: "application_privacy" },
  { step: "training", collects: "Which modules you finished and your quiz result.", why: "So the first job follows the same checklist.", whoSees: "Novara admins.", retention: "Kept with your contractor record.", rights: "You can retake up to the number of times in settings.", wordingId: "application_privacy" },
  { step: "trial", collects: "Check-in, photos, and checklist completion on the first job.", why: "The first job is a trial. An admin, not an automated rule, marks the result.", whoSees: "Novara admins. A Lead Field Cleaner on a shadow job records facts only.", retention: "Kept with the job record.", rights: "The Lead Field Cleaner does not decide the trial outcome.", wordingId: "application_privacy" },
];

export function compliancePanel(step: string): CompliancePanel | null {
  return ONBOARDING_PANELS.find((row) => row.step === step) || null;
}

export function applicantDeadline(start: Date, settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS, novaraWaitMs = 0): Date {
  const raw = new Date(start.getTime() + settings.onboardingDays * 24 * 60 * 60 * 1000 + Math.max(0, novaraWaitMs));
  return raw;
}

export function startDeadline(approvedAt: Date, settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS): Date {
  return new Date(approvedAt.getTime() + settings.onboardingStartHours * 60 * 60 * 1000);
}

export function imageDeleteOn(resultAt: Date, settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS): Date {
  return new Date(resultAt.getTime() + settings.identityImageDeleteDays * 24 * 60 * 60 * 1000);
}

export function imagesOverdue(resultAt: Date, deleted: boolean, now: Date, settings?: IntakeSettings): boolean {
  if (deleted) return false;
  return now.getTime() > imageDeleteOn(resultAt, settings).getTime();
}

export function normalizePersonName(value: string): string {
  return value.toLowerCase().replace(/[^a-z]+/g, " ").replace(/\s+/g, " ").trim();
}

export function namesMatch(left: string, right: string): boolean {
  const a = normalizePersonName(left);
  const b = normalizePersonName(right);
  return Boolean(a) && a === b;
}

export interface NameSources {
  identity: string;
  license: string;
  vehicle: string;
  background: string;
  agreement: string;
  w9: string;
  payout: string;
}

export function nameMismatches(sources: NameSources): string[] {
  const identity = sources.identity;
  const pairs: Array<[string, string]> = [
    ["license", sources.license],
    ["vehicle", sources.vehicle],
    ["background", sources.background],
    ["agreement", sources.agreement],
    ["w9", sources.w9],
    ["payout", sources.payout],
  ];
  return pairs.filter(([, value]) => value && !namesMatch(identity, value)).map(([label]) => label);
}

export interface ComplianceRecord {
  consents: Array<{ id: string; status: WordingVersion["status"] }>;
  backgroundClearOrReviewed: boolean;
  identityResolved: boolean;
  vehicleResolved: boolean;
  kitConfirmed: boolean;
  agreementSigned: boolean;
  w9Complete: boolean;
  payoutSet: boolean;
  trainingPassed: boolean;
  trialPassedByAdmin: boolean;
  nameMismatchOpen: boolean;
}

export function complianceComplete(record: ComplianceRecord): boolean {
  return record.consents.length > 0
    && record.consents.every((row) => row.status === "draft" || row.status === "reviewed")
    && record.backgroundClearOrReviewed
    && record.identityResolved
    && record.vehicleResolved
    && record.kitConfirmed
    && record.agreementSigned
    && record.w9Complete
    && record.payoutSet
    && record.trainingPassed
    && record.trialPassedByAdmin
    && !record.nameMismatchOpen;
}

export function canActivate(record: ComplianceRecord): boolean {
  return complianceComplete(record);
}

export type BackgroundResult = "clear" | "consider" | "incomplete";

export interface AdverseAction {
  phase: "none" | "pre_adverse" | "waiting" | "final";
  preAdverseSentAt: string | null;
  finalAllowedAt: string | null;
  finalSentAt: string | null;
}

export function backgroundNext(result: BackgroundResult): "continue" | "person_review" {
  return result === "clear" ? "continue" : "person_review";
}

export function openPreAdverse(now: Date, settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS): AdverseAction {
  const finalAllowedAt = addBusinessDays(now, settings.adverseActionBusinessDays);
  return {
    phase: "waiting",
    preAdverseSentAt: now.toISOString(),
    finalAllowedAt: finalAllowedAt.toISOString(),
    finalSentAt: null,
  };
}

export function canSendFinalAdverse(action: AdverseAction, now: Date): boolean {
  if (action.phase !== "waiting" || !action.finalAllowedAt || action.finalSentAt) return false;
  return now.getTime() >= new Date(action.finalAllowedAt).getTime();
}

export function wordingForPanel(panel: CompliancePanel): WordingVersion | null {
  return INTAKE_WORDING.find((row) => row.id === panel.wordingId) || null;
}
