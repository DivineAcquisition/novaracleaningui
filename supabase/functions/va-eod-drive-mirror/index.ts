// ─── va-eod-drive-mirror ─────────────────────────────────────────────────────
//
// Puts a generated VA end-of-day PDF into Google Drive:
//
//   {root} / VA EOD Reports / {YYYY-MM} / {VA Name} - {YYYY-MM-DD}.pdf
//
// The Google service-account credentials are Supabase function secrets, so
// Drive isn't reachable from the Next.js runtime. This is the same split the
// QC mirror uses, and it reuses the very same helpers rather than growing a
// second Drive client.
//
// Exactly one file per VA per day: if the name already exists in the month
// folder we UPDATE it in place, so an edit before cutoff replaces the PDF
// instead of leaving two versions for someone to pick between.
//
// Never destructive and never fatal — the caller has already saved the
// submission, and a failure here just gets flagged for retry.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

import { resolveSecret } from "../_shared/app-secrets.ts";
import {
  driveConfigured,
  ensureFolder,
  findChild,
  fileUrl,
  getDriveToken,
  shareReadableByLink,
  updateFile,
  uploadFile,
} from "../_shared/google-drive.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...cors, "Content-Type": "application/json" },
    status,
  });
}

/** Drive rejects a few characters in names; keep it readable otherwise. */
function safeName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json().catch(() => ({}));
    const vaName = String(body.vaName || "VA");
    const workDate = String(body.workDate || "");
    const filename = safeName(String(body.filename || `${vaName} - ${workDate}.pdf`));
    const pdfBase64 = String(body.pdfBase64 || "");

    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate)) return json({ ok: false, error: "Bad workDate." }, 400);
    if (!pdfBase64) return json({ ok: false, error: "Missing pdfBase64." }, 400);

    if (!driveConfigured()) {
      return json({ ok: false, skipped: "service_account_not_configured" });
    }

    // Root folder: a dedicated one if set, otherwise share the QC archive root
    // so this works out of the box wherever that's already pointed.
    const rootFolderId =
      (await resolveSecret(supabase, "GDRIVE_VA_EOD_ROOT_FOLDER_ID")) ||
      (await resolveSecret(supabase, "GDRIVE_QC_ROOT_FOLDER_ID"));
    if (!rootFolderId) {
      return json({ ok: false, skipped: "root_folder_not_configured" });
    }

    const impersonate = await resolveSecret(supabase, "GOOGLE_DRIVE_IMPERSONATE_EMAIL");
    const token = await getDriveToken(impersonate || undefined);
    if (!token) return json({ ok: false, error: "Could not mint a Drive token." }, 502);

    const reportsFolder = await ensureFolder(token, rootFolderId, "VA EOD Reports");
    const monthFolder = await ensureFolder(token, reportsFolder, workDate.slice(0, 7));

    const bytes = decodeBase64(pdfBase64);

    // One file per VA per day — replace in place when it's already there.
    const existing = await findChild(token, monthFolder, filename, "application/pdf");
    let fileId: string;
    if (existing) {
      await updateFile(token, existing.id, bytes, "application/pdf");
      fileId = existing.id;
    } else {
      fileId = await uploadFile(token, monthFolder, filename, bytes, "application/pdf");
    }

    await shareReadableByLink(token, fileId);

    return json({ ok: true, fileId, url: fileUrl(fileId), folderId: monthFolder });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
