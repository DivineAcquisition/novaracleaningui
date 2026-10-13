// Tokenized hiring-application sessions.
//
// One unguessable link per person. The row holds their Indeed identity and the
// answers they have saved so far. The public form reads and writes that row;
// submitting the application marks the session complete.

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { splitPersonName, stateFromIndeedJob } from "./indeed";

export const HIRING_APPLY_ORIGIN = "https://hiring.novaracleaning.com";
export const SESSION_TTL_DAYS = 30;

export type HiringSessionStatus = "open" | "submitted";

export interface HiringSessionAnswers {
  role?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  zipCode?: string;
  state?: string;
  contractorType?: string;
  transportation?: string;
  authorizedToWork?: string;
  experience?: string;
  availability?: string;
  preferredDays?: string[];
  consent1099?: boolean;
  backgroundCheckConsent?: boolean;
  payConsent?: boolean;
  willingToGetSupplies?: string;
  suppliesOnHand?: string;
  reliabilityNote?: string;
  reasonNote?: string;
  idConfirmed?: boolean;
}

export interface HiringSessionRow {
  id: string;
  token: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  source: string;
  job_title: string | null;
  answers: HiringSessionAnswers | null;
  step_index: number | null;
  status: string;
  expires_at: string;
  submitted_at: string | null;
}

export interface PublicHiringSession {
  token: string;
  email: string;
  fullName: string | null;
  firstName: string;
  lastName: string;
  phone: string | null;
  source: string;
  jobTitle: string | null;
  answers: HiringSessionAnswers;
  stepIndex: number;
  status: HiringSessionStatus;
  expiresAt: string;
  preview: boolean;
}

export function newHiringToken(): string {
  return randomBytes(24).toString("hex");
}

export function hiringApplyUrl(token: string): string {
  return `${HIRING_APPLY_ORIGIN}/hiring/apply/${token}`;
}

export function isHiringToken(token: string): boolean {
  return /^[a-f0-9]{32,64}$/i.test(token);
}

export function sessionExpiry(from = new Date()): string {
  return new Date(from.getTime() + SESSION_TTL_DAYS * 86_400_000).toISOString();
}

export function sanitizeAnswers(input: unknown): HiringSessionAnswers {
  if (!input || typeof input !== "object") return {};
  const raw = input as Record<string, unknown>;
  const out: HiringSessionAnswers = {};
  const text = (key: keyof HiringSessionAnswers, max: number) => {
    if (typeof raw[key] !== "string") return;
    const value = String(raw[key]).slice(0, max);
    (out[key] as string) = value;
  };
  text("role", 80);
  text("firstName", 80);
  text("lastName", 80);
  text("email", 200);
  text("phone", 40);
  text("address", 200);
  text("zipCode", 10);
  text("state", 40);
  text("contractorType", 40);
  text("transportation", 40);
  text("authorizedToWork", 10);
  text("experience", 40);
  text("availability", 40);
  text("willingToGetSupplies", 10);
  text("suppliesOnHand", 2000);
  text("reliabilityNote", 1000);
  text("reasonNote", 1000);
  if (Array.isArray(raw.preferredDays)) {
    out.preferredDays = raw.preferredDays.map((d) => String(d)).slice(0, 7);
  }
  for (const key of ["consent1099", "backgroundCheckConsent", "payConsent", "idConfirmed"] as const) {
    if (typeof raw[key] === "boolean") out[key] = raw[key];
  }
  return out;
}

export function toPublicSession(row: HiringSessionRow): PublicHiringSession {
  const fromName = splitPersonName(row.full_name || "");
  const answers = sanitizeAnswers(row.answers);
  const status: HiringSessionStatus = row.status === "submitted" ? "submitted" : "open";
  const state =
    answers.state || (row.source === "indeed" ? stateFromIndeedJob(row.job_title) || "" : "");
  const relay = String(row.email || "").trim().toLowerCase();
  const typedEmail =
    answers.email && answers.email.trim().toLowerCase() !== relay ? answers.email : "";
  return {
    token: row.token,
    email: row.email,
    fullName: row.full_name,
    firstName: answers.firstName || fromName.firstName,
    lastName: answers.lastName || fromName.lastName,
    phone: row.phone,
    source: row.source,
    jobTitle: row.job_title,
    answers: {
      ...answers,
      firstName: answers.firstName || fromName.firstName,
      lastName: answers.lastName || fromName.lastName,
      email: typedEmail,
      phone: answers.phone || row.phone || "",
      ...(state ? { state } : {}),
    },
    stepIndex: Math.max(0, Number(row.step_index) || 0),
    status,
    expiresAt: row.expires_at,
    preview: row.source === "preview",
  };
}

export async function loadHiringSession(
  supabase: SupabaseClient,
  token: string,
): Promise<{ row: HiringSessionRow | null; expired: boolean }> {
  if (!isHiringToken(token)) return { row: null, expired: false };
  const { data, error } = await supabase
    .from("hiring_application_sessions")
    .select(
      "id, token, email, full_name, phone, source, job_title, answers, step_index, status, expires_at, submitted_at",
    )
    .eq("token", token)
    .maybeSingle();
  if (error || !data) return { row: null, expired: false };
  const row = data as HiringSessionRow;
  const expired =
    row.status !== "submitted" && new Date(row.expires_at).getTime() < Date.now();
  return { row, expired };
}
