// Drive, Airtable, email, Discord — all best-effort after the PDF exists.
// A failed mirror is recorded for retry; it does not discard the report.

import { Resend } from "https://esm.sh/resend@2.0.0";
import { resolveSecret } from "../app-secrets.ts";
import { notifyDiscord } from "../discord.ts";
import {
  driveConfigured,
  ensureFolder,
  findChild,
  fileUrl,
  getDriveToken,
  shareReadableByLink,
  updateFile,
  uploadFile,
} from "../google-drive.ts";
import { formatRangeLabel } from "./period.ts";
import { reportFilename } from "./pdf.ts";
import type { WeeklyReportSettings } from "./types.ts";

// deno-lint-ignore no-explicit-any
type SB = any;

export async function mirrorWeeklyPdfToDrive(
  sb: SB,
  settings: WeeklyReportSettings,
  periodStart: string,
  bytes: Uint8Array,
): Promise<{ ok: boolean; fileId?: string; url?: string; folderId?: string; error?: string; skipped?: string }> {
  try {
    if (!driveConfigured()) return { ok: false, skipped: "service_account_not_configured" };
    const rootFolderId =
      (await resolveSecret(sb, "GDRIVE_WEEKLY_REPORT_ROOT_FOLDER_ID")) ||
      settings.drive_root_folder_id;
    if (!rootFolderId) return { ok: false, skipped: "root_folder_not_configured" };

    const impersonate = await resolveSecret(sb, "GOOGLE_DRIVE_IMPERSONATE_EMAIL");
    const token = await getDriveToken(impersonate || undefined);
    if (!token) return { ok: false, error: "Could not mint a Drive token." };

    const yearFolder = await ensureFolder(token, rootFolderId, periodStart.slice(0, 4));
    const filename = reportFilename(periodStart);
    const existing = await findChild(token, yearFolder, filename, "application/pdf");
    let fileId: string;
    if (existing) {
      await updateFile(token, existing.id, bytes, "application/pdf");
      fileId = existing.id;
    } else {
      fileId = await uploadFile(token, yearFolder, filename, bytes, "application/pdf");
    }
    await shareReadableByLink(token, fileId);
    return { ok: true, fileId, url: fileUrl(fileId), folderId: yearFolder };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function syncWeeklyReportToAirtable(
  sb: SB,
  row: {
    period_start: string;
    period_end: string;
    status: string;
    executive_summary: string | null;
    insight_model: string | null;
    drive_url: string | null;
    pdf_path: string | null;
    generated_at: string | null;
  },
): Promise<{ ok: boolean; reason?: string }> {
  try {
    const apiKey = (await resolveSecret(sb, "AIRTABLE_API_KEY")) || (await resolveSecret(sb, "AIRTABLE_PAT"));
    const baseId = (await resolveSecret(sb, "AIRTABLE_BASE_ID")) ||
      (await resolveSecret(sb, "AIRTABLE_REVENUE_OPS_BASE_ID"));
    const table = (await resolveSecret(sb, "AIRTABLE_WEEKLY_REPORTS_TABLE")) || "Weekly Reports";
    if (!apiKey || !baseId) return { ok: false, reason: "Airtable credentials not configured" };

    const fields: Record<string, unknown> = {
      "Period Start": row.period_start,
      "Period End": row.period_end,
      "Status": row.status,
      "Executive Summary": row.executive_summary,
      "Insight Model": row.insight_model,
      "Drive URL": row.drive_url,
      "Generated At": row.generated_at,
    };
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      if (v !== undefined && v !== null && v !== "") clean[k] = v;
    }
    const res = await fetch(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(table)}`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        performUpsert: { fieldsToMergeOn: ["Period Start"] },
        typecast: true,
        records: [{ fields: clean }],
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

export async function notifyWeeklyReport(
  sb: SB,
  kind: "ready" | "failed",
  settings: WeeklyReportSettings,
  payload: {
    periodStart: string;
    periodEnd: string;
    driveUrl?: string | null;
    error?: string | null;
    summary?: string | null;
  },
): Promise<void> {
  const range = formatRangeLabel(payload.periodStart, payload.periodEnd);
  const title = kind === "ready"
    ? `Weekly report ready — ${range}`
    : `Weekly report FAILED — ${range}`;
  const description = kind === "ready"
    ? (payload.summary || "The weekly sales, retention & growth PDF is ready.") +
      (payload.driveUrl ? `\n${payload.driveUrl}` : "")
    : `Generation failed: ${payload.error || "unknown error"}. The function will retry; this is not silent.`;

  await notifyDiscord(sb, {
    title,
    description,
    color: kind === "ready" ? 5793266 : 0xc0392b,
    fields: payload.driveUrl ? [{ name: "Drive", value: payload.driveUrl, inline: false }] : undefined,
  });

  try {
    await sb.from("events").insert({
      event_type: kind === "ready" ? "weekly.report.ready" : "weekly.report.failed",
      source: "weekly-report-generate",
      summary: title,
      data: payload,
    });
  } catch {
    /* events insert is best-effort */
  }

  const apiKey = await resolveSecret(sb, "RESEND_API_KEY");
  if (!apiKey || !settings.recipients.length) return;
  try {
    const resend = new Resend(apiKey);
    await resend.emails.send({
      from: "Novara Cleaning <hello@novaracleaning.com>",
      to: settings.recipients,
      subject: title,
      html: `<p>${description.replace(/\n/g, "<br/>")}</p>
             <p style="color:#64748b;font-size:12px">This report is read-only. It does not change budgets, zones, or pricing.</p>`,
    });
  } catch (err) {
    console.warn("[weekly-report] email failed", err instanceof Error ? err.message : String(err));
  }
}
