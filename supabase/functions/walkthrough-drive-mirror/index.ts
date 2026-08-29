// walkthrough-drive-mirror
//
// Best-effort: photos + branded PDF from a submitted walkthrough into a
// per-site dated Google Drive folder.
//   <root>/Walkthroughs/<YYYY-MM-DD>/<site — address>/
//
// Config: GDRIVE_WALKTHROUGH_ROOT_FOLDER_ID (falls back to GDRIVE_QC_ROOT_FOLDER_ID).
// Never blocks walkthrough submit — a Drive outage just leaves storage URLs.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  driveConfigured,
  ensureFolder,
  folderUrl,
  getDriveToken,
  listChildNames,
  shareReadableByLink,
  uploadFile,
} from "../_shared/google-drive.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}
const log = (m: string, d?: unknown) =>
  console.log(`[walkthrough-drive-mirror] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

async function resolveSecret(supabase: SB, key: string): Promise<string | null> {
  const env = Deno.env.get(key);
  if (env) return env;
  const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
  return data?.value ? String(data.value) : null;
}

function mimeFor(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "webp") return "image/webp";
  if (ext === "mp4") return "video/mp4";
  if (ext === "mov") return "video/quicktime";
  if (ext === "webm") return "video/webm";
  return "image/jpeg";
}

function filenameFromUrl(url: string, i: number): string {
  try {
    const path = new URL(url).pathname;
    const base = path.split("/").pop() || `file-${i}.jpg`;
    return decodeURIComponent(base).slice(0, 120);
  } catch {
    return `file-${i}.jpg`;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    if (!driveConfigured()) return json({ ok: false, skipped: "drive_not_configured" });
    const body = await req.json().catch(() => ({}));
    const walkthroughId = String(body.walkthroughId || "");
    if (!walkthroughId) return json({ error: "walkthroughId required" }, 400);

    const rootId =
      (await resolveSecret(supabase, "GDRIVE_WALKTHROUGH_ROOT_FOLDER_ID")) ||
      (await resolveSecret(supabase, "GDRIVE_QC_ROOT_FOLDER_ID"));
    if (!rootId) {
      log("skipped — no walkthrough/QC Drive root folder");
      return json({ ok: false, skipped: "no_root_folder" });
    }

    const { data: wt } = await supabase
      .from("commercial_walkthroughs")
      .select("id, photos, pdf_url, site_address, business_site_id, conducted_on, scheduled_for")
      .eq("id", walkthroughId)
      .maybeSingle();
    if (!wt) return json({ error: "Walkthrough not found" }, 404);

    const { data: site } = await supabase
      .from("business_sites")
      .select("nickname, address, city, state")
      .eq("id", wt.business_site_id)
      .maybeSingle();

    const impersonate = await resolveSecret(supabase, "GOOGLE_DRIVE_IMPERSONATE_EMAIL");
    const token = await getDriveToken(impersonate || undefined);
    if (!token) return json({ ok: false, skipped: "no_drive_token" });

    const date = String(wt.conducted_on || wt.scheduled_for || new Date().toISOString().slice(0, 10));
    const label = [site?.nickname, site?.address || wt.site_address].filter(Boolean).join(" — ").slice(0, 120)
      || walkthroughId.slice(0, 8);
    const walkthroughsRoot = await ensureFolder(token, rootId, "Walkthroughs");
    const dayFolder = await ensureFolder(token, walkthroughsRoot, date);
    const siteFolder = await ensureFolder(token, dayFolder, label);
    await shareReadableByLink(token, siteFolder);

    const existing = await listChildNames(token, siteFolder);
    const photos: string[] = Array.isArray(wt.photos) ? wt.photos : [];
    let uploaded = 0;
    for (let i = 0; i < photos.length; i++) {
      const url = String(photos[i]);
      const name = filenameFromUrl(url, i);
      if (existing.has(name)) continue;
      try {
        const res = await fetch(url);
        if (!res.ok) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        await uploadFile(token, siteFolder, name, buf, mimeFor(name));
        uploaded += 1;
      } catch (e) {
        log("photo upload failed", { name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    if (wt.pdf_url) {
      const pdfName = `Novara-walkthrough-${date}.pdf`;
      if (!existing.has(pdfName)) {
        try {
          const res = await fetch(String(wt.pdf_url));
          if (res.ok) {
            const buf = new Uint8Array(await res.arrayBuffer());
            await uploadFile(token, siteFolder, pdfName, buf, "application/pdf");
            uploaded += 1;
          }
        } catch (e) {
          log("pdf upload failed", { error: e instanceof Error ? e.message : String(e) });
        }
      }
    }

    const url = folderUrl(siteFolder);
    await supabase.from("commercial_walkthroughs").update({
      drive_folder_id: siteFolder,
      drive_folder_url: url,
    }).eq("id", walkthroughId);

    log("ok", { walkthroughId, uploaded, folder: siteFolder });
    return json({ ok: true, folderId: siteFolder, url, uploaded });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("failed", { error: msg });
    return json({ error: msg }, 500);
  }
});
