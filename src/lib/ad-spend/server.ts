import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

import { formatRangeLabel, mondayOnOrBefore, priorCompletedWeek, weeksInclusive } from "./period";
import { ALL_PLATFORMS, PAID_PLATFORMS, type ChannelEntry, type PaidPlatform } from "./platforms";

export { ALL_PLATFORMS, PAID_PLATFORMS, formatRangeLabel, priorCompletedWeek };
export type { ChannelEntry, PaidPlatform };

const FROM_ADDRESS = "Novara Team <hello@novaracleaning.com>";
const DEFAULT_PUBLIC_BASE = "https://try.novaracleaning.com";
export const OPERATIONS_START = "2026-05-18"; // Monday of the first booking week

export type AdSpendFormSettings = {
  enabled: boolean;
  timezone: string;
  recipients: string[];
  platforms: PaidPlatform[];
  operations_start: string;
};

export const DEFAULT_SETTINGS: AdSpendFormSettings = {
  enabled: true,
  timezone: "America/New_York",
  recipients: ["contact@novaracleaning.com", "dispatch@novaracleaning.com"],
  platforms: [...PAID_PLATFORMS],
  operations_start: OPERATIONS_START,
};

type TokenRow = {
  id: string;
  token: string;
  period_start: string;
  period_end: string;
  status: string;
  submitted_at: string | null;
  sent_at: string | null;
  sent_to: string[] | null;
  expires_at: string | null;
};

async function readSecret(key: string): Promise<string> {
  const fromEnv = (process.env[key] || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const { data } = await getAdminSupabase().from("app_secrets").select("value").eq("key", key).maybeSingle();
    return String((data as { value?: string } | null)?.value || "").trim();
  } catch {
    return "";
  }
}

export async function loadSettings(): Promise<AdSpendFormSettings> {
  const { data } = await getAdminSupabase()
    .from("app_settings")
    .select("value")
    .eq("key", "ad_spend_form_settings")
    .maybeSingle();
  const v = (data?.value && typeof data.value === "object" ? data.value : {}) as Record<string, unknown>;
  const recipients = Array.isArray(v.recipients)
    ? v.recipients.map((x) => String(x).trim()).filter(Boolean)
    : DEFAULT_SETTINGS.recipients;
  const platforms = Array.isArray(v.platforms)
    ? v.platforms.map((x) => String(x)).filter((p): p is PaidPlatform => (ALL_PLATFORMS as readonly string[]).includes(p))
    : DEFAULT_SETTINGS.platforms;
  return {
    enabled: v.enabled !== false,
    timezone: String(v.timezone || DEFAULT_SETTINGS.timezone),
    recipients: recipients.length ? recipients : DEFAULT_SETTINGS.recipients,
    platforms: platforms.length ? platforms : DEFAULT_SETTINGS.platforms,
    operations_start: mondayOnOrBefore(String(v.operations_start || DEFAULT_SETTINGS.operations_start)),
  };
}

export async function publicBaseUrl(): Promise<string> {
  const configured = await readSecret("AD_SPEND_PUBLIC_BASE_URL");
  return (configured || DEFAULT_PUBLIC_BASE).replace(/\/+$/, "");
}

export function formUrl(base: string, token: string): string {
  return `${base}/ad-spend/${token}`;
}

function mintToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function ensureToken(periodStart: string, periodEnd: string): Promise<TokenRow> {
  const sb = getAdminSupabase();
  const { data: existing } = await sb
    .from("ad_spend_form_tokens")
    .select("*")
    .eq("period_start", periodStart)
    .eq("period_end", periodEnd)
    .maybeSingle();
  if (existing?.token) return existing as TokenRow;

  const row = {
    token: mintToken(),
    period_start: periodStart,
    period_end: periodEnd,
    status: "pending",
    expires_at: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const { data, error } = await sb.from("ad_spend_form_tokens").insert(row).select("*").single();
  if (error) throw new Error(error.message);
  return data as TokenRow;
}

export async function loadToken(token: string): Promise<TokenRow | null> {
  const { data } = await getAdminSupabase()
    .from("ad_spend_form_tokens")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  return (data as TokenRow | null) || null;
}

export async function loadExistingEntries(
  periodStart: string,
  periodEnd: string,
): Promise<Partial<Record<PaidPlatform, ChannelEntry>>> {
  const { data } = await getAdminSupabase()
    .from("pl_ad_spend")
    .select("platform, spend_cents, leads_calls, booked_jobs, campaign_notes, date")
    .gte("date", periodStart)
    .lte("date", periodEnd)
    .limit(200);
  const out: Partial<Record<PaidPlatform, ChannelEntry>> = {};
  for (const row of (data || []) as Array<{
    platform: string;
    spend_cents: number | null;
    leads_calls: number | null;
    booked_jobs: number | null;
    campaign_notes: string | null;
  }>) {
    if (!(ALL_PLATFORMS as readonly string[]).includes(row.platform)) continue;
    const platform = row.platform as PaidPlatform;
    out[platform] = {
      platform,
      spend_dollars: row.spend_cents == null ? "" : String(row.spend_cents / 100),
      leads_calls: row.leads_calls == null ? "" : String(row.leads_calls),
      booked_jobs: row.booked_jobs == null ? "" : String(row.booked_jobs),
      campaign_notes: row.campaign_notes || "",
    };
  }
  return out;
}

function parseMoneyToCents(raw: string): number | null {
  const t = raw.trim().replace(/[$,]/g, "");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

function parseIntOrNull(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

export async function submitAdSpendForm(opts: {
  token: string;
  entries: ChannelEntry[];
  submittedByEmail?: string | null;
}): Promise<{ ok: true; platforms: string[]; sheet: unknown; airtable: unknown }> {
  const tok = await loadToken(opts.token);
  if (!tok) throw Object.assign(new Error("This link is invalid."), { status: 404 });
  if (tok.expires_at && new Date(tok.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error("This link has expired. Ask ops to resend the form."), { status: 410 });
  }

  const rows = opts.entries
    .map((entry) => {
      const spend_cents = parseMoneyToCents(entry.spend_dollars);
      if (spend_cents == null) return null;
      if (!(ALL_PLATFORMS as readonly string[]).includes(entry.platform)) return null;
      return {
        date: tok.period_start,
        platform: entry.platform,
        spend_cents,
        leads_calls: parseIntOrNull(entry.leads_calls),
        booked_jobs: parseIntOrNull(entry.booked_jobs),
        campaign_notes: entry.campaign_notes.trim() || null,
      };
    })
    .filter(Boolean) as Array<{
      date: string;
      platform: PaidPlatform;
      spend_cents: number;
      leads_calls: number | null;
      booked_jobs: number | null;
      campaign_notes: string | null;
    }>;

  if (!rows.length) {
    throw Object.assign(new Error("Enter spend for at least one paid channel (0 is fine if it ran but cost nothing)."), {
      status: 400,
    });
  }

  const sb = getAdminSupabase();
  const { error } = await sb.from("pl_ad_spend").upsert(rows, { onConflict: "date,platform" });
  if (error) throw new Error(`Could not save spend: ${error.message}`);

  await sb
    .from("ad_spend_form_tokens")
    .update({
      status: "submitted",
      submitted_at: new Date().toISOString(),
      submitted_by_email: opts.submittedByEmail || null,
    })
    .eq("id", tok.id);

  const [airtable, sheet] = await Promise.all([
    syncAdSpendToAirtable(tok.period_start, tok.period_end, rows),
    triggerSheetSync(),
  ]);

  try {
    await sb.from("events").insert({
      event_type: "ad_spend.form.submitted",
      source: "ad-spend-form",
      summary: `Ad spend logged for ${formatRangeLabel(tok.period_start, tok.period_end)} — ${rows.map((r) => r.platform).join(", ")}`,
      data: {
        period_start: tok.period_start,
        period_end: tok.period_end,
        platforms: rows.map((r) => r.platform),
      },
    });
  } catch {
    /* best-effort */
  }

  return { ok: true, platforms: rows.map((r) => r.platform), sheet, airtable };
}

async function triggerSheetSync(): Promise<unknown> {
  try {
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return { ok: false, reason: "missing supabase url/key" };
    const res = await fetch(`${url.replace(/\/+$/, "")}/functions/v1/pl-sheet-sync`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ source: "ad-spend-form" }),
    });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, ...body };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function syncAdSpendToAirtable(
  periodStart: string,
  periodEnd: string,
  rows: Array<{
    platform: string;
    spend_cents: number;
    leads_calls: number | null;
    booked_jobs: number | null;
    campaign_notes: string | null;
  }>,
): Promise<unknown> {
  try {
    const apiKey = (await readSecret("AIRTABLE_API_KEY")) || (await readSecret("AIRTABLE_PAT"));
    const baseId = (await readSecret("AIRTABLE_REVENUE_OPS_BASE_ID")) || (await readSecret("AIRTABLE_BASE_ID"));
    const table = (await readSecret("AIRTABLE_AD_SPEND_TABLE")) || "Ad Spend Logs";
    if (!apiKey || !baseId) return { ok: false, reason: "Airtable credentials not configured" };

    const records = rows.map((row) => ({
      fields: {
        "Period Start": periodStart,
        "Period End": periodEnd,
        Platform: row.platform,
        Spend: row.spend_cents / 100,
        "Leads / Calls": row.leads_calls,
        "Booked Jobs": row.booked_jobs,
        "Campaign Notes": row.campaign_notes,
        Status: "submitted",
      },
    }));
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: ["Period Start", "Platform"] },
        typecast: true,
        records,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, reason: `Airtable ${res.status}: ${body.slice(0, 220)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderSingleWeekEmail(range: string, url: string, platforms: string[]): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#FAFAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%);padding:20px 24px;">
        <p style="margin:0;color:#fff;font-size:16px;font-weight:700;">Weekly ad spend log — ${escapeHtml(range)}</p>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">Log last week's paid spend so the P&amp;L sheet, Airtable, and Monday morning weekly report stay accurate.</p>
        <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#475569;">Channels: ${escapeHtml(platforms.join(", "))}. Leave a channel blank if it wasn't running. Enter 0 if it ran but spent nothing.</p>
        <p style="margin:0 0 24px;">
          <a href="${url}" style="display:inline-block;background:#5C0FFE;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px;">Open this week's form</a>
        </p>
        <p style="margin:0;font-size:12px;line-height:1.5;color:#94A3B8;word-break:break-all;">${url}</p>
      </div>
    </div>
  </body>
</html>`;
}

function renderBackfillEmail(weeks: Array<{ range: string; url: string }>): string {
  const buttons = weeks
    .map(
      (w) =>
        `<p style="margin:0 0 10px;"><a href="${w.url}" style="display:inline-block;background:#5C0FFE;color:#fff;text-decoration:none;font-weight:600;font-size:14px;padding:10px 18px;border-radius:10px;">${escapeHtml(w.range)}</a></p>`,
    )
    .join("");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#FAFAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#0F172A;">
    <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E2E8F0;border-radius:16px;overflow:hidden;">
      <div style="background:linear-gradient(135deg,#5C0FFE 0%,#8F7BFD 100%);padding:20px 24px;">
        <p style="margin:0;color:#fff;font-size:16px;font-weight:700;">Ad spend catch-up — ${weeks.length} weeks</p>
      </div>
      <div style="padding:24px;">
        <p style="margin:0 0 12px;font-size:15px;line-height:1.55;">These are the weekly paid-channel logs from the start of operations through last completed week. Each link is one Mon–Sun form. Submitting writes the P&amp;L Google Sheet and Airtable.</p>
        <p style="margin:0 0 18px;font-size:14px;line-height:1.55;color:#475569;">Facebook, LSA, Google, and Instagram. Leave a channel blank if it wasn't running.</p>
        ${buttons}
      </div>
    </div>
  </body>
</html>`;
}

async function sendEmail(to: string[], subject: string, html: string): Promise<boolean> {
  const key = await readSecret("RESEND_API_KEY");
  if (!key || !to.length) return false;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM_ADDRESS, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("[ad-spend] email failed", res.status, body.slice(0, 300));
  }
  return res.ok;
}

async function markSent(ids: string[], recipients: string[]) {
  const sb = getAdminSupabase();
  await sb
    .from("ad_spend_form_tokens")
    .update({ sent_at: new Date().toISOString(), sent_to: recipients })
    .in("id", ids);
}

export async function sendWeekForm(opts?: {
  periodStart?: string;
  periodEnd?: string;
  force?: boolean;
}): Promise<{ ok: boolean; emailed: boolean; url: string; range: string; skipped?: string }> {
  const settings = await loadSettings();
  if (!settings.enabled && !opts?.force) return { ok: false, emailed: false, url: "", range: "", skipped: "disabled" };

  const week = opts?.periodStart && opts?.periodEnd
    ? { start: opts.periodStart, end: opts.periodEnd }
    : priorCompletedWeek(new Date(), settings.timezone);

  const tok = await ensureToken(week.start, week.end);
  const base = await publicBaseUrl();
  const url = formUrl(base, tok.token);
  const range = formatRangeLabel(week.start, week.end);
  const emailed = await sendEmail(
    settings.recipients,
    `Weekly ad spend log — ${range}`,
    renderSingleWeekEmail(range, url, settings.platforms),
  );
  if (emailed) await markSent([tok.id], settings.recipients);

  try {
    await getAdminSupabase().from("events").insert({
      event_type: "ad_spend.form.sent",
      source: "ad-spend-form",
      summary: `Ad spend form sent for ${range}${emailed ? "" : " (email failed)"}`,
      data: { period_start: week.start, period_end: week.end, emailed, recipients: settings.recipients },
    });
  } catch {
    /* best-effort */
  }

  return { ok: emailed, emailed, url, range };
}

export async function sendBackfillForms(opts?: { force?: boolean }): Promise<{
  ok: boolean;
  emailed: boolean;
  weeks: number;
  ranges: string[];
}> {
  const settings = await loadSettings();
  if (!settings.enabled && !opts?.force) return { ok: false, emailed: false, weeks: 0, ranges: [] };

  const prior = priorCompletedWeek(new Date(), settings.timezone);
  const weeks = weeksInclusive(settings.operations_start, prior.start);
  const base = await publicBaseUrl();
  const packed: Array<{ id: string; range: string; url: string }> = [];
  for (const w of weeks) {
    const tok = await ensureToken(w.start, w.end);
    packed.push({ id: tok.id, range: formatRangeLabel(w.start, w.end), url: formUrl(base, tok.token) });
  }
  const emailed = await sendEmail(
    settings.recipients,
    `Ad spend catch-up — ${packed.length} weeks since ${formatRangeLabel(settings.operations_start, addDaysSafe(settings.operations_start, 6))}`,
    renderBackfillEmail(packed.map((p) => ({ range: p.range, url: p.url }))),
  );
  if (emailed) await markSent(packed.map((p) => p.id), settings.recipients);

  try {
    await getAdminSupabase().from("events").insert({
      event_type: "ad_spend.form.backfill_sent",
      source: "ad-spend-form",
      summary: `Ad spend catch-up sent (${packed.length} weeks)${emailed ? "" : " — email failed"}`,
      data: { weeks: packed.length, ranges: packed.map((p) => p.range), emailed, recipients: settings.recipients },
    });
  } catch {
    /* best-effort */
  }

  return { ok: emailed, emailed, weeks: packed.length, ranges: packed.map((p) => p.range) };
}

function addDaysSafe(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
