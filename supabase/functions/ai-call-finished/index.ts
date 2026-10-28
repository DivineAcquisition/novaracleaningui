// Emails a detailed report, with a PDF transcript, when an AI voice call ends.
// Telnyx posts call.conversation.ended here. A two-minute sweep catches any
// call whose webhook did not arrive.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { deliverCompliantEmail } from "../_shared/email-compliance-send.ts";

const REPORT_URL = "https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/ai-call-finished";
const RECIPIENTS = [
  "ops@novaracleaning.com",
  "asannie74@gmail.com",
  "maliksannie7@gmail.com",
];
const OURS = new Set([
  "8337002611",
  "8337001210",
  "4433795670",
  "8334432004",
  "4433838055",
]);
const TEXML_APPS = [
  "3079051279368980425",
  "3079084359693633345",
  "3079087278048413653",
];
const ASSISTANTS = [
  "assistant-0ed80104-610b-4bc1-bdfe-fa41d760cf8d",
  "assistant-c6b6cf63-63c3-4a20-a827-6daadc96562f",
  "assistant-689983fe-f3bb-4207-8d2c-1013debefb4e",
];

const AGENTS: Record<string, { name: string; role: string }> = {
  "assistant-0ed80104-610b-4bc1-bdfe-fa41d760cf8d": { name: "Nova", role: "Booking" },
  "assistant-c6b6cf63-63c3-4a20-a827-6daadc96562f": { name: "Customer service", role: "Existing visits" },
  "assistant-689983fe-f3bb-4207-8d2c-1013debefb4e": { name: "Outbound leads", role: "Outbound" },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function digits(raw: unknown): string {
  return String(raw || "").replace(/\D/g, "");
}

function last10(raw: unknown): string {
  const d = digits(raw);
  return d.length >= 10 ? d.slice(-10) : "";
}

function displayPhone(raw: unknown): string {
  const d = last10(raw);
  if (d.length !== 10) return String(raw || "Unknown number");
  return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
}

function money(cents: unknown): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "";
  return `$${(n / 100).toFixed(2)}`;
}

function when(iso: unknown): string {
  const date = new Date(String(iso || ""));
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }) + " ET";
}

function durationLabel(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m <= 0) return `${rem} seconds`;
  return `${m} min ${rem} sec`;
}

function agentFor(assistantId: string): { name: string; role: string } {
  return AGENTS[assistantId] || { name: "AI assistant", role: assistantId || "Unknown" };
}

function callerFrom(meta: Record<string, unknown>, from: string, to: string): string {
  const endUser = String(meta.telnyx_end_user_target || "");
  if (last10(endUser) && !OURS.has(last10(endUser))) return endUser;
  if (last10(from) && !OURS.has(last10(from))) return from;
  if (last10(to) && !OURS.has(last10(to))) return to;
  return endUser || from || to;
}

function directionOf(from: string): string {
  return OURS.has(last10(from)) ? "Outbound" : "Inbound";
}

type Turn = { role: string; text: string; tools: string[]; at: string };

function toolNames(message: Record<string, unknown>): string[] {
  const calls = message.tool_calls;
  if (!Array.isArray(calls)) return [];
  return calls.map((call) => {
    if (typeof call === "string") return call;
    const row = call as Record<string, unknown>;
    const fn = row.function as Record<string, unknown> | undefined;
    return String(fn?.name || row.name || row.type || "");
  }).filter(Boolean);
}

function turnsFrom(messages: Record<string, unknown>[]): Turn[] {
  return messages
    .map((message) => ({
      role: String(message.role || "note"),
      text: String(message.text || message.content || "").trim(),
      tools: toolNames(message),
      at: String(message.created_at || message.sent_at || message.timestamp || ""),
    }))
    .filter((turn) => turn.text || turn.tools.length)
    .sort((a, b) => a.at.localeCompare(b.at));
}

function outcomeFor(tools: string[], quote: Record<string, unknown> | null, userTurns: number, duration: number, reason: string): string {
  const names = tools.map((name) => name.toLowerCase());
  const has = (...needles: string[]) => names.some((name) => needles.some((needle) => name.includes(needle)));
  if (has("opt_out", "do_not_call")) return "Opted out";
  if (has("escalate")) return "Escalated";
  if (has("create_booking", "voice_book", "book_visit") || quote?.booking_id) return "Booked";
  if (has("quote", "price") || Number(quote?.total_cents) > 0) return "Quoted";
  if (has("waitlist")) return "Waitlisted";
  if (/voicemail|machine|amd/i.test(reason)) return "Voicemail";
  if (userTurns === 0) return "No conversation";
  if (duration > 0 && duration < 20) return "Caller hung up";
  return "Finished";
}

function plainReason(reason: string): string {
  const value = reason.trim().toLowerCase().replace(/_/g, " ");
  if (!value) return "Call ended";
  if (value === "normal" || value === "completed") return "Call ended normally";
  if (value.includes("customer") || value.includes("caller")) return "Caller hung up";
  if (value.includes("assistant") || value.includes("agent")) return "Agent ended the call";
  if (value.includes("voicemail") || value.includes("machine")) return "Voicemail";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function quoteLines(quote: Record<string, unknown> | null): string[] {
  if (!quote) return ["No quote was saved for this number."];
  const lines = [];
  const name = [quote.first_name].filter(Boolean).join(" ");
  if (name) lines.push(`Name: ${name}`);
  if (quote.email) lines.push(`Email: ${quote.email}`);
  if (quote.service_type) lines.push(`Service: ${quote.service_type}`);
  if (quote.zip_code) lines.push(`ZIP: ${quote.zip_code}${quote.coverage_city ? ` (${quote.coverage_city}, ${quote.coverage_state || ""})` : ""}`);
  if (quote.dwelling_type) lines.push(`Home: ${quote.dwelling_type}`);
  const rooms = [quote.bedrooms ? `${quote.bedrooms} bed` : "", quote.bathrooms ? `${quote.bathrooms} bath` : ""].filter(Boolean).join(", ");
  if (rooms) lines.push(`Rooms: ${rooms}`);
  if (quote.sqft) lines.push(`Square feet: ${quote.sqft}`);
  if (quote.address) lines.push(`Address: ${quote.address}, ${quote.city || ""} ${quote.state || ""}`.trim());
  if (quote.total_cents) lines.push(`Quoted total: ${money(quote.total_cents)}`);
  if (quote.deposit_cents) lines.push(`Deposit: ${money(quote.deposit_cents)}`);
  if (quote.service_date || quote.time_slot) lines.push(`Visit: ${quote.service_date || ""} ${quote.time_slot || ""}`.trim());
  if (quote.booking_id) lines.push(`Booking id: ${quote.booking_id}`);
  if (!lines.length) lines.push("A quote session exists, but no details were saved.");
  return lines;
}

function transcriptLines(turns: Turn[]): string[] {
  const lines: string[] = [];
  for (const turn of turns) {
    if (turn.role === "system") continue;
    const who = turn.role === "user" ? "Caller" : turn.role === "assistant" ? "Agent" : "Tool";
    if (turn.tools.length) lines.push(`${who} used ${turn.tools.join(", ")}`);
    if (turn.text) lines.push(`${who}: ${turn.text}`);
  }
  return lines.length ? lines : ["No transcript was saved."];
}

function ascii(value: string): string {
  return value
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[—–]/g, "-")
    .replace(/…/g, "...")
    .replace(/[^\x09\x0a\x0d\x20-\x7e]/g, "");
}

function wrap(value: string, width: number): string[] {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > width) {
      if (line) lines.push(line);
      line = word.slice(0, width);
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [""];
}

async function buildPdf(input: {
  title: string;
  facts: string[];
  quote: string[];
  tools: string[];
  transcript: string[];
}): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage([612, 792]);
  let y = 750;
  const write = (text: string, size: number, heavy = false) => {
    const face = heavy ? bold : font;
    for (const line of wrap(text, heavy ? 70 : 90)) {
      if (y < 54) {
        page = doc.addPage([612, 792]);
        y = 750;
      }
      page.drawText(line, { x: 48, y, size, font: face, color: rgb(0.1, 0.1, 0.12) });
      y -= size + 5;
    }
  };
  write(input.title, 16, true);
  y -= 6;
  write("Call facts", 12, true);
  for (const line of input.facts) write(line, 10);
  y -= 8;
  write("Quote on file", 12, true);
  for (const line of input.quote) write(line, 10);
  y -= 8;
  write("Tools used", 12, true);
  write(input.tools.length ? input.tools.join(", ") : "None", 10);
  y -= 8;
  write("Transcript", 12, true);
  for (const line of input.transcript) write(line, 10);
  const bytes = await doc.save();
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function telnyx(apiKey: string, path: string, method = "GET", body?: unknown) {
  const res = await fetch(`https://api.telnyx.com/v2${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let payload: any = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = {}; }
  return { status: res.status, payload, text };
}

async function fetchMessages(apiKey: string, conversationId: string): Promise<Record<string, unknown>[]> {
  const collected: Record<string, unknown>[] = [];
  for (let page = 1; page <= 5; page += 1) {
    const res = await telnyx(apiKey, `/ai/conversations/${conversationId}/messages?page[size]=100&page[number]=${page}`);
    const rows = Array.isArray(res.payload?.data) ? res.payload.data : [];
    collected.push(...rows);
    if (rows.length < 100) break;
  }
  return collected;
}

async function ensureDelivery(apiKey: string) {
  for (const id of TEXML_APPS) {
    const current = await telnyx(apiKey, `/texml_applications/${id}`);
    const app = current.payload?.data || current.payload;
    if (app?.status_callback === REPORT_URL) continue;
    await telnyx(apiKey, `/texml_applications/${id}`, "PATCH", {
      status_callback: REPORT_URL,
      status_callback_method: "POST",
    });
  }
  for (const id of ASSISTANTS) {
    const current = await telnyx(apiKey, `/ai/assistants/${id}`);
    const assistant = current.payload?.data || current.payload;
    const telephony = { ...(assistant?.telephony_settings || {}) };
    if (telephony.conversation_ended_full_history === true) continue;
    telephony.conversation_ended_full_history = true;
    await telnyx(apiKey, `/ai/assistants/${id}`, "PATCH", { telephony_settings: telephony });
  }
}

type Report = {
  conversationId: string;
  callControlId: string;
  assistantId: string;
  agentName: string;
  agentRole: string;
  outcome: string;
  caller: string;
  from: string;
  to: string;
  direction: string;
  reason: string;
  startedAt: string;
  endedAt: string;
  duration: number;
  tools: string[];
  quote: string[];
  transcript: string[];
};

async function buildReport(supabase: ReturnType<typeof createClient>, apiKey: string, source: {
  conversationId: string;
  assistantId?: string;
  callControlId?: string;
  from?: string;
  to?: string;
  reason?: string;
  duration?: number;
  startedAt?: string;
  endedAt?: string;
  metadata?: Record<string, unknown>;
  messages?: Record<string, unknown>[];
}): Promise<Report | null> {
  const conversationId = source.conversationId;
  if (!conversationId) return null;
  let meta = source.metadata || {};
  let startedAt = source.startedAt || "";
  let endedAt = source.endedAt || "";
  if (!source.metadata) {
    const conversation = await telnyx(apiKey, `/ai/conversations/${conversationId}`);
    const row = conversation.payload?.data || conversation.payload;
    if (!row?.id) return null;
    meta = row.metadata || {};
    startedAt = startedAt || row.created_at || "";
    endedAt = endedAt || row.last_message_at || "";
  }
  const assistantId = String(source.assistantId || meta.assistant_id || "");
  const from = String(source.from || meta.from || meta.telnyx_agent_target || "");
  const to = String(source.to || meta.to || meta.telnyx_end_user_target || "");
  const caller = callerFrom(meta, from, to);
  const messages = source.messages?.length ? source.messages : await fetchMessages(apiKey, conversationId);
  const turns = turnsFrom(messages);
  const tools = turns.flatMap((turn) => turn.tools);
  const userTurns = turns.filter((turn) => turn.role === "user" && turn.text).length;
  const startMs = new Date(startedAt).getTime();
  const endMs = new Date(endedAt).getTime();
  const duration = source.duration && source.duration > 0
    ? source.duration
    : (Number.isFinite(startMs) && Number.isFinite(endMs) ? Math.max(0, Math.round((endMs - startMs) / 1000)) : 0);
  const ten = last10(caller);
  let quote: Record<string, unknown> | null = null;
  if (ten) {
    const { data } = await supabase.from("quote_sessions").select("*").eq("phone", ten).maybeSingle();
    quote = data || null;
  }
  const agent = agentFor(assistantId);
  const reason = plainReason(String(source.reason || ""));
  const outcome = outcomeFor(tools, quote, userTurns, duration, String(source.reason || ""));
  return {
    conversationId,
    callControlId: String(source.callControlId || meta.call_control_id || ""),
    assistantId,
    agentName: agent.name,
    agentRole: agent.role,
    outcome,
    caller,
    from,
    to,
    direction: directionOf(from),
    reason,
    startedAt,
    endedAt,
    duration,
    tools,
    quote: quoteLines(quote),
    transcript: transcriptLines(turns),
  };
}

function emailHtml(report: Report): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 10px;color:#52525b;width:140px;">${label}</td><td style="padding:6px 10px;color:#18181b;">${value}</td></tr>`;
  const tools = report.tools.length ? report.tools.join(", ") : "None";
  return `
    <h1 style="margin:0 0 8px;font-size:22px;">${report.agentName} · ${report.outcome}</h1>
    <p style="margin:0 0 16px;color:#3f3f46;">${report.direction} call with ${displayPhone(report.caller)} ended. The transcript is attached as a PDF.</p>
    <table style="border-collapse:collapse;width:100%;font-size:14px;">
      ${row("Agent", `${report.agentName} (${report.agentRole})`)}
      ${row("Outcome", report.outcome)}
      ${row("Caller", displayPhone(report.caller))}
      ${row("Direction", report.direction)}
      ${row("Started", when(report.startedAt) || "Unknown")}
      ${row("Ended", when(report.endedAt) || "Unknown")}
      ${row("Duration", durationLabel(report.duration))}
      ${row("How it ended", report.reason)}
      ${row("Tools", tools)}
    </table>
    <h2 style="margin:22px 0 8px;font-size:16px;">Quote on file</h2>
    <p style="margin:0;white-space:pre-wrap;">${report.quote.join("\n")}</p>`;
}

async function sendReport(supabase: ReturnType<typeof createClient>, apiKey: string, report: Report) {
  const { data: existing } = await supabase
    .from("ai_call_reports")
    .select("email_status, created_at")
    .eq("conversation_id", report.conversationId)
    .maybeSingle();
  if (existing?.email_status === "sent") return { skipped: true };
  if (existing?.email_status === "pending") {
    const age = Date.now() - new Date(existing.created_at).getTime();
    if (age < 90_000) return { skipped: true, reason: "in_progress" };
  }
  if (!existing) {
    const { error } = await supabase.from("ai_call_reports").insert({
      conversation_id: report.conversationId,
      call_control_id: report.callControlId,
      assistant_id: report.assistantId,
      agent_name: report.agentName,
      outcome: report.outcome,
      caller_phone: displayPhone(report.caller),
      started_at: report.startedAt || null,
      ended_at: report.endedAt || null,
      duration_sec: report.duration,
      email_status: "pending",
    });
    if (error?.code === "23505") return { skipped: true, reason: "already_claimed" };
    if (error) return { sent: 0, errors: [error.message] };
  }

  const resendKey = await resolveSecret(supabase, "RESEND_API_KEY");
  const pdf = await buildPdf({
    title: `${report.agentName} call · ${report.outcome}`,
    facts: [
      `Agent: ${report.agentName} (${report.agentRole})`,
      `Outcome: ${report.outcome}`,
      `Caller: ${displayPhone(report.caller)}`,
      `Direction: ${report.direction}`,
      `From: ${displayPhone(report.from)}`,
      `To: ${displayPhone(report.to)}`,
      `Started: ${when(report.startedAt) || "Unknown"}`,
      `Ended: ${when(report.endedAt) || "Unknown"}`,
      `Duration: ${durationLabel(report.duration)}`,
      `How it ended: ${report.reason}`,
    ],
    quote: report.quote,
    tools: report.tools,
    transcript: report.transcript,
  });
  const subject = `AI call ended · ${report.agentName} · ${report.outcome} · ${displayPhone(report.caller)}`;
  const html = emailHtml(report);
  const errors: string[] = [];
  let sent = 0;
  for (const to of RECIPIENTS) {
    const result = await deliverCompliantEmail(supabase, {
      apiKey: resendKey,
      to,
      subject,
      html,
      templateKey: "admin_internal_notice",
      declaredType: "internal_admin",
      staffRecipient: true,
      idempotencyKey: `ai-call-report/${report.conversationId}/${to}`,
      attachments: [{
        filename: `novara-call-${report.agentName.toLowerCase().replace(/\s+/g, "-")}.pdf`,
        content: pdf,
      }],
    });
    if (result.ok) sent += 1;
    else errors.push(`${to}: ${result.error}`);
  }
  await supabase.from("ai_call_reports").update({
    email_status: sent > 0 ? "sent" : "failed",
    email_error: errors.join(" | ").slice(0, 500),
    sent_at: sent > 0 ? new Date().toISOString() : null,
    outcome: report.outcome,
    agent_name: report.agentName,
  }).eq("conversation_id", report.conversationId);
  return { sent, errors };
}

function payloadOf(body: any): any {
  return body?.data?.payload || body?.payload || body?.data || body || {};
}

function eventType(body: any): string {
  return String(body?.data?.event_type || body?.event_type || body?.CallStatus || "").toLowerCase();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const cronSecret = await resolveSecret(supabase, "CRON_SECRET");
  const cron = Boolean(cronSecret) && req.headers.get("x-cron-secret") === cronSecret;
  const raw = await req.text();
  let body: any = {};
  const contentType = req.headers.get("content-type") || "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const form = new URLSearchParams(raw);
    body = Object.fromEntries(form.entries());
  } else {
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
  }
  if (body.sweep === true && !cron) return json({ error: "unauthorized" }, 401);

  const apiKey = Deno.env.get("TELNYX_API_KEY") || "";
  if (!apiKey) return json({ ok: false, reason: "telnyx_key_missing" }, 500);
  if (cron) {
    try { await ensureDelivery(apiKey); } catch { /* a missed webhook still gets the sweep */ }
  }

  if (body.sweep === true) {
    const lookbackHours = Math.min(72, Math.max(1, Number(body.lookbackHours) || 6));
    const limit = Math.min(5, Math.max(1, Number(body.limit) || 5));
    const listed = await telnyx(apiKey, "/ai/conversations?page[size]=30");
    const rows = Array.isArray(listed.payload?.data) ? listed.payload.data : [];
    const cutoff = Date.now() - lookbackHours * 60 * 60 * 1000;
    const quietBefore = Date.now() - 90_000;
    const results = [];
    for (const row of rows) {
      if (results.length >= limit) break;
      const meta = row.metadata || {};
      if (meta.telnyx_conversation_channel && meta.telnyx_conversation_channel !== "phone_call") continue;
      const ended = new Date(row.last_message_at || row.created_at || 0).getTime();
      const started = new Date(row.created_at || 0).getTime();
      if (!ended || ended < cutoff || ended > quietBefore || started < cutoff) continue;
      const report = await buildReport(supabase, apiKey, {
        conversationId: row.id,
        metadata: meta,
        startedAt: row.created_at,
        endedAt: row.last_message_at,
      });
      if (!report) continue;
      results.push({ id: row.id, ...(await sendReport(supabase, apiKey, report)) });
    }
    return json({ ok: true, checked: rows.length, results });
  }

  const type = eventType(body);
  const ended = type.includes("conversation.ended") || type.includes("call.analyzed") || type === "completed";
  if (!ended) return json({ ok: true, ignored: type || "empty" });
  const payload = payloadOf(body);
  let conversationId = String(payload.conversation_id || "");
  const callControlId = String(payload.call_control_id || payload.CallSid || "");
  if (!conversationId && callControlId) {
    const listed = await telnyx(apiKey, "/ai/conversations?page[size]=20");
    const match = (listed.payload?.data || []).find((row: any) => row?.metadata?.call_control_id === callControlId);
    conversationId = match?.id || "";
  }
  if (!conversationId) return json({ ok: true, ignored: "no_conversation" });
  const report = await buildReport(supabase, apiKey, {
    conversationId,
    assistantId: payload.assistant_id,
    callControlId,
    from: payload.from || payload.From,
    to: payload.to || payload.To,
    reason: payload.reason || payload.HangupCause || payload.CallStatus,
    duration: Number(payload.duration_sec || payload.CallDuration || 0),
    messages: Array.isArray(payload.messages) ? payload.messages : undefined,
  });
  if (!report) return json({ ok: true, ignored: "conversation_not_found" });
  const sent = await sendReport(supabase, apiKey, report);
  return json({ ok: true, agent: report.agentName, outcome: report.outcome, ...sent });
});
