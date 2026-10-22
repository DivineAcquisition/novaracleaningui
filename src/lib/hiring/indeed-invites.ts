// Sends the Field Cleaner application link when an Indeed application is for
// Maryland, Virginia, or DC. One link per Indeed relay address.
// Mail already in the inbox when this starts is left alone. Later mail is sent.

import type { SupabaseClient } from "@supabase/supabase-js";
import { deliverCompliantEmail } from "@/lib/email-compliance/deliver";
import { indeedApplicationLinkState, parseIndeedApplicant, splitPersonName, type IndeedApplicant } from "@/lib/hiring/indeed";
import { hiringApplyUrl, newHiringToken, sessionExpiry } from "@/lib/hiring/session";

const CURSOR_KEY = "indeed_link_cursor";

export function indeedApplicationEmail(input: { firstName: string; url: string }): { subject: string; html: string; text: string } {
  const name = input.firstName.trim() || "there";
  const subject = "Your Field Cleaner application";
  const text = [
    `Hi ${name},`,
    "",
    "You applied to clean with Novara. This link opens your Field Cleaner application. It asks one question at a time and saves as you go.",
    "",
    input.url,
    "",
    "NVC Operations",
    "operations@novaracleaning.com",
  ].join("\n");
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
    <h2 style="margin:0 0 8px;font-size:20px">Your Field Cleaner application</h2>
    <p style="margin:0 0 16px;color:#475569">Hi ${escapeHtml(name)},</p>
    <p style="margin:0 0 16px;color:#475569">You applied to clean with Novara. This link opens your Field Cleaner application. It asks one question at a time and saves as you go.</p>
    <p style="margin:24px 0;text-align:center"><a href="${escapeHtml(input.url)}" style="display:inline-block;background:#5C0FFE;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">Start your application</a></p>
  </div>`;
  return { subject, html, text };
}

/** True when the Indeed message arrived after the cursor. Undated mail is not sent. */
export function indeedLinkIsNew(appliedAt: string | null | undefined, afterMs: number): boolean {
  const when = Date.parse(String(appliedAt || ""));
  if (!Number.isFinite(when)) return false;
  return when > afterMs;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function alreadyOnFile(supabase: SupabaseClient, email: string): Promise<boolean> {
  const { data: applicants } = await supabase.from("cleaner_applicants").select("id").ilike("email", email).limit(1);
  if (applicants && applicants.length > 0) return true;
  const { data: cleaners } = await supabase.from("cleaners").select("id").ilike("email", email).limit(1);
  return Boolean(cleaners && cleaners.length > 0);
}

export async function sendIndeedApplicationLink(
  supabase: SupabaseClient,
  applicant: IndeedApplicant,
): Promise<"sent" | "skipped" | "failed"> {
  if (!indeedApplicationLinkState(applicant.jobTitle)) return "skipped";
  if (await alreadyOnFile(supabase, applicant.email)) return "skipped";

  const { data: existing } = await supabase
    .from("hiring_application_sessions")
    .select("id, token, invite_sent_at")
    .ilike("email", applicant.email)
    .eq("source", "indeed")
    .maybeSingle();
  if (existing?.invite_sent_at) return "skipped";

  const token = existing?.token || newHiringToken();
  if (!existing) {
    const { firstName, lastName } = splitPersonName(applicant.fullName);
    const inserted = await supabase.from("hiring_application_sessions").insert({
      token,
      email: applicant.email,
      full_name: applicant.fullName,
      source: "indeed",
      job_title: applicant.jobTitle,
      gmail_message_id: applicant.gmailMessageId || null,
      gmail_thread_id: applicant.gmailThreadId || null,
      answers: { firstName, lastName, state: indeedApplicationLinkState(applicant.jobTitle) },
      step_index: 0,
      status: "open",
      expires_at: sessionExpiry(),
    });
    if (inserted.error) return "failed";
  }

  const { data: secret } = await supabase.from("app_secrets").select("value").eq("key", "RESEND_API_KEY").maybeSingle();
  const apiKey = String(secret?.value || "").trim();
  if (!apiKey) return "failed";
  const { firstName } = splitPersonName(applicant.fullName);
  const mail = indeedApplicationEmail({ firstName, url: hiringApplyUrl(token) });
  const sent = await deliverCompliantEmail(supabase, {
    to: applicant.email,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    apiKey,
    declaredType: "contractor_operational",
    templateKey: "field_cleaner_application",
    idempotencyKey: `indeed-application/${applicant.gmailMessageId || applicant.email}`,
  });
  if (!sent.ok) return sent.blocked ? "skipped" : "failed";
  await supabase
    .from("hiring_application_sessions")
    .update({ invite_sent_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("token", token);
  return "sent";
}

interface ListedMessage {
  from?: string;
  subject?: string;
  snippet?: string;
  messageId?: string;
  threadId?: string;
  date?: string;
}

async function listViaEdge(supabase: SupabaseClient): Promise<{ configured: boolean; error: string; messages: ListedMessage[] }> {
  const { data: rows } = await supabase.from("app_secrets").select("key, value").in("key", [
    "SUPABASE_URL",
    "SUPABASE_ANON_KEY",
    "CRON_SECRET",
  ]);
  const secrets = new Map((rows || []).map((row) => [String(row.key), String(row.value || "").trim()]));
  const base = (secrets.get("SUPABASE_URL") || process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const anon = secrets.get("SUPABASE_ANON_KEY") || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const cron = secrets.get("CRON_SECRET") || "";
  if (!base || !anon || !cron) return { configured: false, error: "gmail_unavailable", messages: [] };
  const res = await fetch(`${base}/functions/v1/indeed-gmail-list`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${anon}`,
      apikey: anon,
      "x-cron-secret": cron,
    },
    body: "{}",
  });
  const body = await res.json().catch(() => null) as { configured?: boolean; error?: string; messages?: ListedMessage[] } | null;
  if (!res.ok || !body || body.configured !== true) {
    return { configured: false, error: body?.error || "gmail_unavailable", messages: [] };
  }
  return { configured: true, error: "", messages: Array.isArray(body.messages) ? body.messages : [] };
}

async function gmailRefreshToken(supabase: SupabaseClient): Promise<string | null> {
  const { data } = await supabase.from("app_secrets").select("key, value").in("key", [
    "GMAIL_CLIENT_ID",
    "GMAIL_CLIENT_SECRET",
    "GMAIL_REFRESH_TOKEN",
  ]);
  const secrets = new Map((data || []).map((row) => [String(row.key), String(row.value || "")]));
  const clientId = secrets.get("GMAIL_CLIENT_ID") || "";
  const clientSecret = secrets.get("GMAIL_CLIENT_SECRET") || "";
  const refreshToken = secrets.get("GMAIL_REFRESH_TOKEN") || "";
  if (!clientId || !clientSecret || !refreshToken) return null;
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const json = await res.json() as { access_token?: string };
  return json.access_token || null;
}

function header(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  return headers?.find((row) => row.name?.toLowerCase() === name.toLowerCase())?.value || "";
}

async function listViaRefreshToken(supabase: SupabaseClient): Promise<{ configured: boolean; error: string; messages: ListedMessage[] }> {
  const token = await gmailRefreshToken(supabase);
  if (!token) return { configured: false, error: "gmail_unavailable", messages: [] };
  const query = 'from:indeedemail.com subject:"New application" newer_than:7d';
  const listed = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=25&q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!listed.ok) return { configured: false, error: "gmail_list", messages: [] };
  const list = await listed.json() as { messages?: Array<{ id: string; threadId: string }> };
  const messages: ListedMessage[] = [];
  for (const item of list.messages || []) {
    const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${item.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) continue;
    const message = await res.json() as {
      snippet?: string;
      internalDate?: string;
      payload?: { headers?: Array<{ name?: string; value?: string }> };
    };
    const from = header(message.payload?.headers, "From");
    messages.push({
      from: from.match(/<([^>]+)>/)?.[1] || from,
      subject: header(message.payload?.headers, "Subject"),
      snippet: message.snippet || "",
      messageId: item.id,
      threadId: item.threadId,
      date: message.internalDate
        ? new Date(Number(message.internalDate)).toISOString()
        : header(message.payload?.headers, "Date"),
    });
  }
  return { configured: true, error: "", messages };
}

async function cursorAfter(supabase: SupabaseClient): Promise<number | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", CURSOR_KEY).maybeSingle();
  const value = data?.value as { primed?: boolean; afterMs?: number } | null;
  if (!value?.primed) return null;
  const afterMs = Number(value.afterMs || 0);
  return Number.isFinite(afterMs) ? afterMs : null;
}

async function primeCursor(supabase: SupabaseClient): Promise<void> {
  await supabase.from("app_settings").upsert({
    key: CURSOR_KEY,
    value: { primed: true, afterMs: Date.now() },
    description: "Indeed application links send only for mail that arrives after this time.",
    updated_at: new Date().toISOString(),
  }, { onConflict: "key" });
}

async function alreadySeen(supabase: SupabaseClient, messageId: string): Promise<boolean> {
  if (!messageId) return false;
  const { data } = await supabase.from("indeed_link_seen").select("gmail_message_id").eq("gmail_message_id", messageId).maybeSingle();
  return Boolean(data?.gmail_message_id);
}

async function markSeen(supabase: SupabaseClient, messageId: string, result: string): Promise<void> {
  if (!messageId) return;
  await supabase.from("indeed_link_seen").upsert({
    gmail_message_id: messageId,
    result,
  }, { onConflict: "gmail_message_id" });
}

export async function syncIndeedApplicationLinks(supabase: SupabaseClient): Promise<{ configured: boolean; sent: number; skipped: number; failed: number; primed?: boolean; error?: string }> {
  let listed = await listViaEdge(supabase);
  if (!listed.configured) listed = await listViaRefreshToken(supabase);
  if (!listed.configured) return { configured: false, sent: 0, skipped: 0, failed: 0, error: listed.error };

  const afterMs = await cursorAfter(supabase);
  if (afterMs === null) {
    await primeCursor(supabase);
    return { configured: true, sent: 0, skipped: 0, failed: 0, primed: true };
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const message of listed.messages) {
    const messageId = String(message.messageId || "");
    if (await alreadySeen(supabase, messageId)) {
      skipped += 1;
      continue;
    }
    if (!indeedLinkIsNew(message.date, afterMs)) {
      await markSeen(supabase, messageId, "before_start");
      skipped += 1;
      continue;
    }
    const from = String(message.from || "");
    const applicant = parseIndeedApplicant({
      sender: from.match(/<([^>]+)>/)?.[1] || from,
      subject: message.subject,
      snippet: message.snippet,
      messageId,
      threadId: message.threadId,
      date: message.date,
    });
    if (!applicant) {
      await markSeen(supabase, messageId, "skipped");
      skipped += 1;
      continue;
    }
    const result = await sendIndeedApplicationLink(supabase, applicant);
    if (result === "failed") {
      failed += 1;
      continue;
    }
    await markSeen(supabase, messageId, result);
    if (result === "sent") sent += 1;
    else skipped += 1;
  }
  return { configured: true, sent, skipped, failed };
}
