import { SUPPORT_PHONE } from "@/config/brand-config";

// Thresholds for contractor intake and the Lead Cleaner role.
// Starting values only. Admin can replace them. Nothing here is a legal constant.

export interface IntakeSettings {
  minDaysAvailable: number;
  minJobsPerWeek: number;
  reapplyDays: number;
  reviewBusinessDays: number;
  onboardingStartHours: number;
  reminderHours: number[];
  /** Days from conditional approval. Time waiting on Novara is excluded. */
  onboardingDays: number;
  identityImageDeleteDays: number;
  adverseActionBusinessDays: number;
  applicantRetentionMonths: number;
  documentRetentionMonthsAfterActive: number;
  trainingPassScore: number;
  trainingRetakes: number;
  /** Null until the owner sets it. A lead job then needs admin approval. */
  laborCapPercent: number | null;
  leadPayPercent: number;
  /** Existing turnover cleaner share: 70% of the turnover price. */
  turnoverPayPercent: number;
  helperPayPercent: number;
  leadMinTenureDays: number;
  leadMinCompletedJobs: number;
  leadMinScore: number;
  leadMaxLateCancellations: number;
  leadReviewWindowDays: number;
  leadInternalWindowDays: number;
  leadSpots: number;
  leadReviewEveryDays: number;
  householdVehicleNeedsReview: boolean;
  leadRoleOpenToPublic: boolean;
  /** Shown for Field Cleaner. Empty means that role cannot be applied for. */
  fieldCleanerPayLabel: string;
  /** Null until the owner sets it. The role stays closed. */
  recurringHomeCleanerPayLabel: string | null;
  turnoverCleanerPayLabel: string | null;
  /** Off until counsel says a "No" should be handled differently. Default is needs review. */
  workAuthorizationRejectOnNo: boolean;
  legalName: string;
  legalAddress: string;
  applicantPhone: string;
  applicantEmail: string;
  /** Estimated minutes for each before-you-start step. Labels on the page say these are estimates. */
  beforeStartMinutes: Record<string, number>;
  /** Empty until counsel names the background-check company. Footers then say “named in your authorization.” */
  backgroundCheckCompany: string;
}

export const DEFAULT_INTAKE_SETTINGS: IntakeSettings = {
  minDaysAvailable: 2,
  minJobsPerWeek: 1,
  reapplyDays: 60,
  reviewBusinessDays: 2,
  onboardingStartHours: 72,
  reminderHours: [24, 48],
  onboardingDays: 10,
  identityImageDeleteDays: 30,
  adverseActionBusinessDays: 5,
  applicantRetentionMonths: 12,
  documentRetentionMonthsAfterActive: 24,
  trainingPassScore: 80,
  trainingRetakes: 2,
  laborCapPercent: null,
  leadPayPercent: 47,
  turnoverPayPercent: 70,
  helperPayPercent: 35,
  leadMinTenureDays: 90,
  leadMinCompletedJobs: 20,
  leadMinScore: 80,
  leadMaxLateCancellations: 1,
  leadReviewWindowDays: 90,
  leadInternalWindowDays: 14,
  leadSpots: 5,
  leadReviewEveryDays: 30,
  householdVehicleNeedsReview: true,
  leadRoleOpenToPublic: true,
  fieldCleanerPayLabel: "40–45%",
  recurringHomeCleanerPayLabel: null,
  turnoverCleanerPayLabel: null,
  workAuthorizationRejectOnNo: false,
  legalName: "Novara Cleaning LLC",
  legalAddress: "7404 Executive Place, Lanham, MD 20706",
  applicantPhone: SUPPORT_PHONE.display,
  applicantEmail: "operations@novaracleaning.com",
  beforeStartMinutes: {
    identity: 8,
    vehicle: 6,
    agreement: 10,
    phone: 3,
    supplies: 8,
    job_day: 5,
    dress_code: 3,
    background: 6,
    w9: 8,
    payouts: 8,
    training: 20,
    trial: 0,
  },
  backgroundCheckCompany: "",
};

export const INTAKE_SETTINGS_KEY = "contractor_intake_settings";
export const INTAKE_WORDING_KEY = "contractor_intake_wording";

export function mergeIntakeSettings(raw: Partial<IntakeSettings> | null | undefined): IntakeSettings {
  const merged = { ...DEFAULT_INTAKE_SETTINGS, ...(raw || {}) };
  merged.reminderHours = Array.isArray(raw?.reminderHours) && raw.reminderHours.length
    ? raw.reminderHours.map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0)
    : DEFAULT_INTAKE_SETTINGS.reminderHours;
  if (merged.laborCapPercent != null && !Number.isFinite(Number(merged.laborCapPercent))) {
    merged.laborCapPercent = null;
  }
  if (raw && "recurringHomeCleanerPayLabel" in raw && !String(raw.recurringHomeCleanerPayLabel || "").trim()) {
    merged.recurringHomeCleanerPayLabel = null;
  }
  if (raw && "turnoverCleanerPayLabel" in raw && !String(raw.turnoverCleanerPayLabel || "").trim()) {
    merged.turnoverCleanerPayLabel = null;
  }
  merged.workAuthorizationRejectOnNo = raw?.workAuthorizationRejectOnNo === true;
  const minutes = { ...DEFAULT_INTAKE_SETTINGS.beforeStartMinutes };
  const incoming = raw?.beforeStartMinutes;
  if (incoming && typeof incoming === "object") {
    for (const [key, value] of Object.entries(incoming)) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0 && n <= 180) minutes[key] = n;
    }
  }
  merged.beforeStartMinutes = minutes;
  merged.backgroundCheckCompany = String(raw?.backgroundCheckCompany || "").trim();
  return merged;
}

export function reapplyOn(from: Date, settings: IntakeSettings = DEFAULT_INTAKE_SETTINGS): string {
  const copy = new Date(from.getTime());
  copy.setUTCDate(copy.getUTCDate() + Math.max(1, settings.reapplyDays));
  return copy.toISOString().slice(0, 10);
}

export function addBusinessDays(from: Date, days: number): Date {
  const copy = new Date(from.getTime());
  let left = Math.max(0, Math.round(days));
  while (left > 0) {
    copy.setUTCDate(copy.getUTCDate() + 1);
    const day = copy.getUTCDay();
    if (day !== 0 && day !== 6) left -= 1;
  }
  return copy;
}
