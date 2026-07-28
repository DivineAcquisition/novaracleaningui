// ─── The VA's EOD link: mint, rotate, deliver ─────────────────────────────────
//
// Each VA gets a durable tokenized link to their own end-of-day form, sent to
// them by email and Discord. Nobody has to remember a URL, and — more to the
// point — nobody needs a workspace login, which most VAs don't have.
//
// ─── Where the token may and may not go ──────────────────────────────────────
//
// The token is a bearer credential. Whoever holds the link can file that VA's
// EOD, so it goes to the VA and nowhere else:
//
//   email    → always, to the address on their VA record
//   Discord  → only to a PRIVATE per-VA channel webhook, when one is set
//   shared   → the team channel gets a reminder that names the VA and carries
//   channel    NO token, so it can nudge without handing out credentials
//
// Discord exposes no DM API in this codebase (webhook-to-channel only, see
// supabase/functions/_shared/discord.ts), which is why the private webhook is
// per-VA rather than something we can derive.

import { randomBytes } from "node:crypto";

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { getEodSettings, localDate, primePerformanceSecrets } from "./settings";
import { listTrackedVas, type VaRecord } from "./vas";

const DEFAULT_PUBLIC_BASE = "https://eod.novaracleaning.com";
const FROM_ADDRESS = "Novara Team <hello@novaracleaning.com>";

/** 32 bytes → 64 hex. Longer than the 20-byte links elsewhere in the codebase. */
function mintToken(): string {
  return randomBytes(32).toString("hex");
}

async function readSecret(key: string): Promise<string> {
  const fromEnv = (process.env[key] || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return String((data as { value?: string } | null)?.value || "").trim();
  } catch {
    return "";
  }
}

export async function publicBaseUrl(): Promise<string> {
  const configured = await readSecret("EOD_PUBLIC_BASE_URL");
  return (configured || DEFAULT_PUBLIC_BASE).replace(/\/+$/, "");
}

export function eodUrl(base: string, token: string): string {
  return `${base}/eod/${token}`;
}

/**
 * Return the VA's token, minting one if they don't have it yet.
 * `rotate` issues a fresh token, which immediately invalidates the old link.
 */
export async function ensureEodToken(
  va: VaRecord,
  options: { rotate?: boolean } = {},
): Promise<string> {
  if (va.eodToken && !options.rotate) return va.eodToken;

  const token = mintToken();
  const supabase = getAdminSupabase();
  const { error } = await supabase
    .from("va_onboarding")
    .update({ eod_token: token, eod_token_issued_at: new Date().toISOString() })
    .eq("id", va.id);
  if (error) throw new Error(`Couldn't issue an EOD link: ${error.message}`);

  va.eodToken = token;
  return token;
}

// ─── Email ────────────────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Plain, branded HTML built inline. The React Email templates in
 * supabase/functions/_shared/email-templates are Deno-side and can't be
 * imported here, so this follows the direct-Resend pattern the other Next.js
 * routes use (see src/app/api/va/onboarding/route.ts).
 */
export function renderEodEmail(va: VaRecord, url: string, workDate: string): string {
  const name = escapeHtml(va.firstName || va.name || "there");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#FAFAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
    <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%);padding:20px 24px;">
        <p style="margin:0;color:#fff;font-size:16px;font-weight:700;letter-spacing:-0.01em;">End of day — ${escapeHtml(workDate)}</p>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Hi ${name},</p>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
          Your EOD is mostly filled in already — hours, calls, bookings and screens are pulled
          from the systems automatically. Review what we recorded, add the context we can't see,
          and you're done. It should take under five minutes.
        </p>
        <p style="margin:0 0 24px;">
          <a href="${url}" style="display:inline-block;background:#5C0FFE;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">Open your EOD</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#64748B;">
          This is your personal link — it signs you straight in, so please don't forward it.
          Bookmark it and it'll work every day.
        </p>
        <p style="margin:0;font-size:12px;line-height:1.5;color:#94A3B8;word-break:break-all;">${url}</p>
      </div>
    </div>
    <p style="max-width:520px;margin:14px auto 0;font-size:11px;line-height:1.5;color:#94A3B8;text-align:center;">
      Blockers and notes on this form are never scored. They're there so you can say what's actually going on.
    </p>
  </body>
</html>`;
}

async function sendEmail(va: VaRecord, url: string, workDate: string): Promise<boolean> {
  const key = await readSecret("RESEND_API_KEY");
  if (!key || !va.email) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [va.email],
        subject: `Your end-of-day report — ${workDate}`,
        html: renderEodEmail(va, url, workDate),
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Discord ──────────────────────────────────────────────────────────────────

/** Post the tokenized link to the VA's OWN private channel. Never shared. */
async function sendPrivateDiscord(va: VaRecord, url: string, workDate: string): Promise<boolean> {
  const webhook = (va.discordWebhookUrl || "").trim();
  if (!webhook.startsWith("https://discord.com/api/webhooks/")) return false;
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "Novara EOD",
        allowed_mentions: { parse: [] },
        embeds: [
          {
            title: `End of day — ${workDate}`,
            description:
              `Hours, calls, bookings and screens are already filled in. Review them, add the ` +
              `context we can't see, and you're done.\n\n[Open your EOD](${url})`,
            color: 5793266,
            footer: { text: "Your personal link — please don't share it." },
          },
        ],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Nudge the shared ops channel. Deliberately carries NO token — it names who
 * still owes an EOD and says where the link went, nothing more.
 */
async function announceReminder(
  workDate: string,
  delivered: DeliveryResult[],
): Promise<void> {
  if (!delivered.length) return;
  const supabase = getAdminSupabase();
  const lines = delivered.map((d) => {
    const channels = [d.emailed ? "email" : null, d.discorded ? "Discord" : null].filter(Boolean);
    return `${d.name}: ${channels.length ? channels.join(" + ") : "no channel available"}`;
  });
  try {
    await supabase.from("events").insert({
      event_type: "va.eod.reminder",
      source: "eod-link",
      summary: `EOD links sent for ${workDate} — ${lines.join("; ")}`,
      data: {
        work_date: workDate,
        // No token here, deliberately: this lands in a shared channel.
        recipients: delivered.map((d) => ({
          va_id: d.vaId,
          name: d.name,
          emailed: d.emailed,
          discorded: d.discorded,
        })),
      },
    });
  } catch {
    /* a notification failure must never fail the send */
  }
}

// ─── Orchestration ────────────────────────────────────────────────────────────

export interface DeliveryResult {
  vaId: string;
  name: string;
  email: string;
  url: string;
  emailed: boolean;
  discorded: boolean;
  skipped?: string;
}

/** Send one VA their link. Always mints a token first if they lack one. */
export async function sendEodLink(
  va: VaRecord,
  options: { workDate?: string; rotate?: boolean } = {},
): Promise<DeliveryResult> {
  await primePerformanceSecrets();
  const settings = await getEodSettings();
  const workDate = options.workDate || localDate(new Date(), settings.timezone);

  const token = await ensureEodToken(va, { rotate: options.rotate });
  const url = eodUrl(await publicBaseUrl(), token);

  const [emailed, discorded] = await Promise.all([
    sendEmail(va, url, workDate),
    sendPrivateDiscord(va, url, workDate),
  ]);

  if (emailed || discorded) {
    const supabase = getAdminSupabase();
    await supabase
      .from("va_onboarding")
      .update({ eod_link_last_sent_at: new Date().toISOString() })
      .eq("id", va.id);
  }

  return { vaId: va.id, name: va.name, email: va.email, url, emailed, discorded };
}

export interface SendAllReport {
  workDate: string;
  sent: DeliveryResult[];
  skipped: DeliveryResult[];
}

/**
 * Daily send to every tracked VA.
 *
 * Idempotent per day: a VA already sent today is skipped, so the cron can
 * retry after a partial failure without spamming the people it already
 * reached. `force` overrides that for a manual resend.
 */
export async function sendEodLinksToAll(
  options: { workDate?: string; force?: boolean } = {},
): Promise<SendAllReport> {
  await primePerformanceSecrets();
  const settings = await getEodSettings();
  const workDate = options.workDate || localDate(new Date(), settings.timezone);

  const vas = await listTrackedVas();
  const sent: DeliveryResult[] = [];
  const skipped: DeliveryResult[] = [];

  for (const va of vas) {
    const alreadyToday =
      va.eodLinkLastSentAt && localDate(new Date(va.eodLinkLastSentAt), settings.timezone) === workDate;
    if (alreadyToday && !options.force) {
      skipped.push({
        vaId: va.id,
        name: va.name,
        email: va.email,
        url: "",
        emailed: false,
        discorded: false,
        skipped: "already sent today",
      });
      continue;
    }

    const result = await sendEodLink(va, { workDate });
    if (result.emailed || result.discorded) sent.push(result);
    else
      skipped.push({
        ...result,
        skipped: va.email ? "no delivery channel succeeded" : "no email on file",
      });
  }

  await announceReminder(workDate, sent);
  return { workDate, sent, skipped };
}
