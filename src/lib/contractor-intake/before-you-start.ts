// The page between conditional approval and the first onboarding step.
// Step names come from the live onboarding lists. Minutes come from settings.

import { cleanerSetupSteps, type CleanerSetupState } from "@/lib/cleaner-supplies";
import { ONBOARDING_PANELS } from "./onboarding";
import { wordingById, type WordingVersion } from "./wording";
import type { IntakeSettings } from "./settings";

export type ReadinessAnswer = "yes" | "not_yet";

export interface BeforeStep {
  id: string;
  name: string;
  detail: string;
  minutes: number;
  waitsOnNovara: boolean;
}

export interface ReadinessEvent {
  answer: ReadinessAnswer | "viewed";
  at: string;
}

export interface ReadinessRecord {
  viewedAt: string | null;
  answer: ReadinessAnswer | null;
  answeredAt: string | null;
  history: ReadinessEvent[];
  remindersSent: number[];
}

const STEP_ORDER = [
  "identity",
  "vehicle",
  "agreement",
  "phone",
  "supplies",
  "job_day",
  "dress_code",
  "background",
  "w9",
  "payouts",
  "training",
  "trial",
] as const;

const WAITS_ON_NOVARA = new Set(["background", "trial"]);

const DETAIL: Record<string, string> = {
  identity: "ID photo and selfie",
  vehicle: "Driver's license and a vehicle photo taken in the app, with the plate visible",
  agreement: "Sign the Independent Contractor Agreement",
  phone: "Verify your phone number",
  supplies: "Check off what you already have, and photograph your kit",
  job_day: "Read how a job works",
  dress_code: "Read the dress code",
  background: "A separate disclosure and signed authorization",
  w9: "Legal name, taxpayer ID type, ID number, and address",
  payouts: "Choose how you get paid",
  training: "Training videos",
  trial: "A person at Novara reviews your trial job",
};

const READY = [
  "Your phone with a working camera, in good light",
  "Your government-issued photo ID (unexpired)",
  "Your driver's license and the vehicle you will drive, with its plate visible",
  "Proof the vehicle is insured (card or policy page showing your name)",
  "Your supplies, ready to photograph",
  "Your taxpayer ID number (SSN, EIN, or ITIN) for the W-9, and a mailing address",
  "Your payout details (Stripe, Cash App, Zelle, or Chime)",
];

export function emptyReadiness(): ReadinessRecord {
  return { viewedAt: null, answer: null, answeredAt: null, history: [], remindersSent: [] };
}

export function parseReadiness(value: unknown): ReadinessRecord {
  const raw = value && typeof value === "object" ? value as Partial<ReadinessRecord> : {};
  const answer = raw.answer === "yes" || raw.answer === "not_yet" ? raw.answer : null;
  const history = Array.isArray(raw.history)
    ? raw.history.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const item = row as Partial<ReadinessEvent>;
      if (item.answer !== "yes" && item.answer !== "not_yet" && item.answer !== "viewed") return [];
      if (!item.at) return [];
      return [{ answer: item.answer, at: String(item.at) }];
    }).slice(-20)
    : [];
  return {
    viewedAt: raw.viewedAt ? String(raw.viewedAt) : null,
    answer,
    answeredAt: raw.answeredAt ? String(raw.answeredAt) : null,
    history,
    remindersSent: Array.isArray(raw.remindersSent) ? raw.remindersSent.map((n) => Number(n)).filter((n) => Number.isFinite(n)) : [],
  };
}

export function markViewed(record: ReadinessRecord, at: string): ReadinessRecord {
  if (record.viewedAt) return record;
  return { ...record, viewedAt: at, history: [...record.history, { answer: "viewed", at }] };
}

export function recordReadiness(record: ReadinessRecord, answer: ReadinessAnswer, at: string): ReadinessRecord {
  if (record.answer === answer) return { ...record, viewedAt: record.viewedAt || at };
  return {
    ...record,
    viewedAt: record.viewedAt || at,
    answer,
    answeredAt: at,
    history: [...record.history, { answer, at }],
  };
}

/** Reminders that are due. Answering yes stops them. Passing the deadline stops them. */
export function dueReminderHours(input: {
  answer: ReadinessAnswer | null;
  launchedAt: string | null;
  deadlineAt: string | null;
  hours: number[];
  sent: number[];
  now: Date;
}): number[] {
  if (input.answer !== "not_yet" || !input.launchedAt) return [];
  const start = Date.parse(input.launchedAt);
  const deadline = input.deadlineAt ? Date.parse(input.deadlineAt) : NaN;
  if (!Number.isFinite(start)) return [];
  if (Number.isFinite(deadline) && input.now.getTime() > deadline) return [];
  const sent = new Set(input.sent);
  return input.hours.filter((hours) => {
    if (sent.has(hours)) return false;
    return input.now.getTime() >= start + hours * 60 * 60 * 1000;
  });
}

export function beforeYouStartSteps(minutes: Record<string, number>): BeforeStep[] {
  const portal = new Map<string, string>(cleanerSetupSteps({} as CleanerSetupState).map((step) => [step.id, step.title]));
  const panels = new Map(ONBOARDING_PANELS.filter((row) => row.step !== "welcome").map((row) => [row.step === "payout" ? "payouts" : row.step === "kit" ? "supplies" : row.step, row]));
  return STEP_ORDER.filter((id) => portal.has(id) || panels.has(id)).map((id) => ({
    id,
    name: portal.get(id) || panels.get(id)?.step || id,
    detail: DETAIL[id] || panels.get(id)?.collects || "",
    minutes: Number(minutes[id] ?? 0),
    waitsOnNovara: WAITS_ON_NOVARA.has(id),
  }));
}

export function beforeYouStartTotal(steps: BeforeStep[]): number {
  return steps.reduce((sum, step) => sum + Math.max(0, step.minutes), 0);
}

export function readyItemsForRole(role: string | null | undefined): string[] {
  const items = [...READY];
  if (/lead/i.test(String(role || ""))) items.push("For Lead Field Cleaner: contact details for one reference");
  return items;
}

export function fillBeforeCopy(body: string, values: { deadline?: string; days?: number }): string {
  return body
    .replaceAll("{deadline}", values.deadline || "the date on your link")
    .replaceAll("{days}", String(values.days ?? ""));
}

export function beforeCopy(id: string, versions?: WordingVersion[]): string {
  return wordingById(id, versions)?.body || "";
}
