// Indeed delivers applications to the employer inbox through a relay address
// (conversation-…@indeedemail.com). That address is the applicant's email for
// this pipeline: replies to it reach the person, and it is what we key their
// saved application session on.

import type { ApplicantState } from "./application";

export interface IndeedApplicant {
  email: string;
  fullName: string;
  jobTitle: string;
  gmailMessageId: string;
  gmailThreadId: string;
  appliedAt: string | null;
}

const RELAY = /@indeedemail\.com$/i;

function decode(value: string): string {
  return value
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * State named on the Indeed job in the application email.
 * Maryland cities and DMV postings with no other state are Maryland.
 * A city the email places in Virginia stays Virginia.
 * Texas and California are not service states, so those postings do not prefill.
 */
export function stateFromIndeedJob(jobTitle: string | null | undefined): ApplicantState | null {
  const title = String(jobTitle || "");
  if (!title.trim()) return null;
  if (/,\s*TX\b|\(Dallas\)|\(Texas\)/i.test(title)) return null;
  if (/,\s*CA\b|\(LA\)|\(California\)|Los Angeles/i.test(title)) return null;
  if (/,\s*MD\b|\(Maryland\)/i.test(title)) return "Maryland";
  if (/,\s*VA\b|\(Virginia\)/i.test(title)) return "Virginia";
  if (/,\s*DC\b|\(Washington,\s*DC\)/i.test(title)) return "DC";
  if (/,\s*NY\b|\(New York\)/i.test(title)) return "New York";
  if (/\(DMV\)|\bDMV\b/i.test(title)) return "Maryland";
  return null;
}

/** Indeed applications in these states get the Field Cleaner application link. */
export function indeedApplicationLinkState(jobTitle: string | null | undefined): ApplicantState | null {
  const state = stateFromIndeedJob(jobTitle);
  if (state === "Maryland" || state === "Virginia" || state === "DC") return state;
  return null;
}

export function splitPersonName(full: string): { firstName: string; lastName: string } {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: "", lastName: "" };
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function parseIndeedApplicant(input: {
  sender?: string | null;
  subject?: string | null;
  snippet?: string | null;
  messageId?: string | null;
  threadId?: string | null;
  date?: string | null;
}): IndeedApplicant | null {
  const email = String(input.sender || "").trim().toLowerCase();
  if (!RELAY.test(email)) return null;

  const subject = decode(String(input.subject || ""));
  const snippet = decode(String(input.snippet || ""));
  const isApplication = /new application/i.test(subject);
  const isMessage = /new message from/i.test(subject);
  if (!isApplication && !isMessage) return null;

  let fullName = "";
  let jobTitle = "";
  if (isApplication) {
    const named = snippet.match(/^(.+?) applied\b/i);
    fullName = named?.[1]?.trim() || "";
    const job = subject.match(/New application for (.+)$/i);
    jobTitle = job?.[1]?.trim() || "";
  } else {
    const named = subject.match(/New Message from (.+?)(?:\s[-–—]\s|\s*$)/i);
    fullName = named?.[1]?.trim() || "";
    const job = subject.match(/\s[-–—]\s(.+)$/);
    jobTitle = job?.[1]?.trim() || "";
  }
  if (!fullName) {
    const local = email.split("@")[0].replace(/^conversation-/, "").replace(/-[a-z0-9]+$/i, "");
    fullName = local.replace(/[0-9]/g, "").replace(/([a-z])([A-Z])/g, "$1 $2");
  }

  return {
    email,
    fullName: fullName.replace(/\s+/g, " ").trim(),
    jobTitle,
    gmailMessageId: String(input.messageId || "").trim(),
    gmailThreadId: String(input.threadId || "").trim(),
    appliedAt: input.date ? String(input.date) : null,
  };
}
