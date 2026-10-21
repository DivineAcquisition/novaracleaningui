import { DEFAULT_INTAKE_SETTINGS, reapplyOn, type IntakeSettings } from "./settings";

export type IntakeOutcome = "pass" | "not_a_fit" | "waitlist" | "needs_review";

export interface ApplicationAnswers {
  role: "cleaner" | "lead_cleaner";
  email: string;
  phone: string;
  name: string;
  zip: string;
  zipInServiceArea: boolean;
  daysAvailable: number;
  age18: boolean;
  hasSmartphone: boolean;
  hasVehicle: boolean;
  willHaveKit: boolean;
  understandsContractorWork: boolean;
  understandsVerification: boolean;
  smsConsent: boolean;
  emailConsent: boolean;
  /** Omitted answers are treated as meeting the jobs minimum. The form always sends a number. */
  jobsPerWeek?: number;
  duplicate: boolean;
  incomplete: boolean;
  /** Why a person has to look, when duplicate is not the reason. */
  reviewReason?: string | null;
}

export interface ApplicationDecision {
  outcome: IntakeOutcome;
  /** Stage written on the applicant. */
  stage: "conditional_approval" | "not_a_fit" | "waitlist" | "needs_review";
  requirement: string | null;
  message: string;
  reapplyOn: string | null;
  openOnboarding: boolean;
  countsAsRejection: boolean;
  /** Outside applicants who pass start as cleaners and wait for a person to decide lead status. */
  leadTrack: boolean;
}

const REQUIREMENTS: Array<{ key: keyof ApplicationAnswers; label: string }> = [
  { key: "age18", label: "You need to be 18 or older." },
  { key: "hasSmartphone", label: "You need a smartphone that can run the Novara app and take photos." },
  { key: "hasVehicle", label: "You need a personal vehicle you can drive to jobs with your supplies." },
  { key: "willHaveKit", label: "You need a cleaning supply kit before your first job." },
  { key: "understandsContractorWork", label: "This work is as an independent contractor, and onboarding includes a W-9." },
  { key: "understandsVerification", label: "A pass continues only if identity, vehicle, and a background check are completed in onboarding." },
];

export function decideApplication(
  answers: ApplicationAnswers,
  settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS,
  now = new Date(),
): ApplicationDecision {
  const again = reapplyOn(now, settings);

  if (answers.incomplete) {
    return {
      outcome: "needs_review",
      stage: "needs_review",
      requirement: null,
      message: `Your application is being reviewed. You can expect an answer within ${settings.reviewBusinessDays} business days.`,
      reapplyOn: null,
      openOnboarding: false,
      countsAsRejection: false,
      leadTrack: false,
    };
  }

  if (answers.duplicate || answers.reviewReason) {
    const why = answers.reviewReason
      || "We already have an application or contractor record with these contact details.";
    return {
      outcome: "needs_review",
      stage: "needs_review",
      requirement: null,
      message: `${why} A person will review it. You can expect an answer within ${settings.reviewBusinessDays} business days.`,
      reapplyOn: null,
      openOnboarding: false,
      countsAsRejection: false,
      leadTrack: false,
    };
  }

  if (!answers.zipInServiceArea) {
    return {
      outcome: "waitlist",
      stage: "waitlist",
      requirement: null,
      message: "Your ZIP is outside the area we cover today. We will contact you if that area opens. This is not a rejection.",
      reapplyOn: null,
      openOnboarding: false,
      countsAsRejection: false,
      leadTrack: false,
    };
  }

  if (!answers.smsConsent && !answers.emailConsent) {
    return {
      outcome: "needs_review",
      stage: "needs_review",
      requirement: null,
      message: "We need one way to reach you. Agree to application email, or to texts, and submit again.",
      reapplyOn: null,
      openOnboarding: false,
      countsAsRejection: false,
      leadTrack: false,
    };
  }

  const missed = REQUIREMENTS.find((row) => answers[row.key] !== true);
  if (missed) {
    return {
      outcome: "not_a_fit",
      stage: "not_a_fit",
      requirement: missed.label,
      message: `${missed.label} You can apply again after ${again}.`,
      reapplyOn: again,
      openOnboarding: false,
      countsAsRejection: true,
      leadTrack: false,
    };
  }

  if (answers.daysAvailable < settings.minDaysAvailable) {
    return {
      outcome: "not_a_fit",
      stage: "not_a_fit",
      requirement: `Availability needs at least ${settings.minDaysAvailable} days.`,
      message: `Availability needs at least ${settings.minDaysAvailable} days. You can apply again after ${again}.`,
      reapplyOn: again,
      openOnboarding: false,
      countsAsRejection: true,
      leadTrack: false,
    };
  }

  if (typeof answers.jobsPerWeek === "number" && answers.jobsPerWeek < settings.minJobsPerWeek) {
    const jobs = `${settings.minJobsPerWeek} ${settings.minJobsPerWeek === 1 ? "job" : "jobs"}`;
    return {
      outcome: "not_a_fit",
      stage: "not_a_fit",
      requirement: `Availability needs at least ${jobs} per week.`,
      message: `Availability needs at least ${jobs} per week. You can apply again after ${again}.`,
      reapplyOn: again,
      openOnboarding: false,
      countsAsRejection: true,
      leadTrack: false,
    };
  }

  if (answers.role === "lead_cleaner" && !settings.leadRoleOpenToPublic) {
    return {
      outcome: "needs_review",
      stage: "needs_review",
      requirement: null,
      message: `Lead Cleaner is not open to new applicants right now. A person will review this. You can expect an answer within ${settings.reviewBusinessDays} business days.`,
      reapplyOn: null,
      openOnboarding: false,
      countsAsRejection: false,
      leadTrack: false,
    };
  }

  return {
    outcome: "pass",
    stage: "conditional_approval",
    requirement: null,
    message: "You are conditionally approved. Approval depends on finishing onboarding, including identity and vehicle verification and a background check. No phone call is required.",
    reapplyOn: null,
    openOnboarding: true,
    countsAsRejection: false,
    leadTrack: answers.role === "lead_cleaner",
  };
}

export const FORBIDDEN_APPLICANT_LANGUAGE = /\b(hires?|hired|employees?|staff|shifts?|managers?|supervisors?|salary|pay stubs?)\b/i;

export function usesForbiddenApplicantLanguage(value: string): boolean {
  return FORBIDDEN_APPLICANT_LANGUAGE.test(value);
}
