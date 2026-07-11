// qc-drive-mirror
//
// Async worker that mirrors each completed job's documentation to Google
// Drive. Runs every 10 minutes from pg_cron (and on demand from the QC
// console). Supabase is written first by the ensure_job_documentation
// trigger; this worker NEVER blocks job completion — a Drive outage just
// leaves the row pending/failed for the next pass.
//
// Per job it:
//   1. Refreshes the documentation snapshot (photos, checklist, cleaners).
//   2. Builds the Drive folder tree:
//        <QC root>/<YYYY>/<MM - Month>/<NOV-xxxxx — Client — date>/{before,after}
//   3. Uploads every ORIGINAL photo (deterministic filenames → retries dedupe).
//   4. Generates the completion-summary PDF (job details, checklist,
//      before/after photos) — the one-file dispute/chargeback packet.
//   5. Marks the row mirrored, then pushes the Drive link + documented flag
//      to the job's Airtable record via the existing sync webhook.
//
// Failure → mirror_status='failed' with exponential backoff; after
// MAX_ATTEMPTS a qc.documentation.failed event alerts admin via Discord.
//
// Config: GDRIVE_QC_ROOT_FOLDER_ID (app_secrets or env) + the Google service
// account env vars shared with the Calendar integration.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import {
  driveConfigured,
  ensureFolder,
  fileUrl,
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
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}
const log = (s: string, d?: unknown) =>
  console.log(`[qc-drive-mirror] ${s}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

const BATCH_SIZE = 4;
const MAX_ATTEMPTS = 8;
const MAX_PDF_PHOTOS = 24;
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

async function resolveSecret(supabase: SB, key: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return ((data?.value as string) || Deno.env.get(key) || "").trim();
  } catch {
    return (Deno.env.get(key) || "").trim();
  }
}

function backoffMinutes(attempts: number): number {
  // 10m, 20m, 40m, 80m … capped at 6h
  return Math.min(10 * 2 ** Math.max(0, attempts - 1), 360);
}

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120);
}

function extFromUrl(url: string): string {
  const m = url.split("?")[0].match(/\.(jpe?g|png|webp|gif|heic)$/i);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "jpg";
}

interface DocRow {
  id: string;
  booking_id: string;
  job_id: string | null;
  booking_ref: string | null;
  client_name: string | null;
  client_email: string | null;
  service_type: string | null;
  service_date: string | null;
  address: string | null;
  cleaner_names: string | null;
  before_photos: string[];
  after_photos: string[];
  notes: string | null;
  completed_at: string | null;
  mirror_attempts: number;
  drive_folder_id: string | null;
  drive_pdf_id: string | null;
}

// ─── Snapshot enrichment (checklist + cleaners) ──────────────────────────────

async function enrichSnapshot(supabase: SB, doc: DocRow): Promise<{
  checklist: { name?: string; progress_pct?: number; completed_items?: number; total_items?: number; completed_at?: string | null } | null;
  cleanerNames: string;
  agreementRef: string | null;
}> {
  let checklist = null;
  let cleanerNames = doc.cleaner_names || "";
  let agreementRef: string | null = null;

  if (doc.job_id) {
    const { data: cl } = await supabase
      .from("job_checklists")
      .select("service_type, items, total_items, completed_items, progress_pct, completed_at")
      .eq("job_id", doc.job_id)
      .maybeSingle();
    if (cl) {
      checklist = {
        name: `${String(cl.service_type || "standard")} checklist`,
        progress_pct: Number(cl.progress_pct) || 0,
        completed_items: Number(cl.completed_items) || 0,
        total_items: Number(cl.total_items) || 0,
        completed_at: cl.completed_at || null,
        items: cl.items || {},
      };
    }
    if (!cleanerNames) {
      const { data: assigns } = await supabase
        .from("job_assignments")
        .select("status, cleaners(first_name, last_name)")
        .eq("job_id", doc.job_id);
      const names = (assigns || [])
        .filter((a: { status?: string }) => ["confirmed", "accepted", "completed", "in progress"].includes(String(a.status || "").toLowerCase()))
        .map((a: { cleaners?: unknown }) => {
          const c = Array.isArray(a.cleaners) ? a.cleaners[0] : a.cleaners;
          return c ? `${(c as { first_name?: string }).first_name || ""} ${(c as { last_name?: string }).last_name || ""}`.trim() : "";
        })
        .filter(Boolean);
      cleanerNames = [...new Set(names)].join(", ");
    }
  }

  try {
    const { data: agr } = await supabase
      .from("service_agreements")
      .select("id, created_at")
      .eq("booking_id", doc.booking_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (agr?.id) agreementRef = `Agreement ${String(agr.id).slice(0, 8)} · signed ${String(agr.created_at).slice(0, 10)}`;
  } catch { /* table may not have rows */ }

  return { checklist, cleanerNames, agreementRef };
}

// ─── Completion summary PDF ──────────────────────────────────────────────────

async function buildSummaryPdf(doc: DocRow, extras: {
  checklist: { name?: string; progress_pct?: number; completed_items?: number; total_items?: number } | null;
  cleanerNames: string;
  agreementRef: string | null;
  photos: Array<{ label: string; bytes: Uint8Array }>;
}): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const violet = rgb(0.33, 0, 1);
  const gray = rgb(0.32, 0.36, 0.42);
  const dark = rgb(0.07, 0.09, 0.15);

  const PAGE_W = 612, PAGE_H = 792, MARGIN = 54;
  let page = pdf.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H - MARGIN;

  const line = (text: string, opts: { size?: number; font?: typeof font; color?: ReturnType<typeof rgb>; gap?: number } = {}) => {
    const size = opts.size ?? 11;
    if (y < MARGIN + size) { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
    page.drawText(text.slice(0, 110), { x: MARGIN, y, size, font: opts.font ?? font, color: opts.color ?? dark });
    y -= size + (opts.gap ?? 6);
  };

  line("NOVARA CLEANING", { size: 20, font: bold, color: violet, gap: 2 });
  line("Job Completion & Documentation Summary", { size: 13, color: gray, gap: 16 });

  const rows: Array<[string, string]> = [
    ["Booking", doc.booking_ref || doc.booking_id],
    ["Client", `${doc.client_name || "—"}${doc.client_email ? ` <${doc.client_email}>` : ""}`],
    ["Service", `${doc.service_type || "—"} on ${doc.service_date || "—"}`],
    ["Address", doc.address || "—"],
    ["Cleaner(s)", extras.cleanerNames || "—"],
    ["Completed at", doc.completed_at ? new Date(doc.completed_at).toUTCString() : "—"],
    ["Photos", `${doc.before_photos.length} before · ${doc.after_photos.length} after`],
  ];
  if (extras.agreementRef) rows.push(["Signed agreement", extras.agreementRef]);
  if (extras.checklist) {
    rows.push(["Checklist", `${extras.checklist.completed_items ?? 0}/${extras.checklist.total_items ?? 0} items (${extras.checklist.progress_pct ?? 0}%)`]);
  }
  for (const [k, v] of rows) {
    if (y < MARGIN + 12) { page = pdf.addPage([PAGE_W, PAGE_H]); y = PAGE_H - MARGIN; }
    page.drawText(`${k}:`, { x: MARGIN, y, size: 11, font: bold, color: gray });
    page.drawText(String(v).slice(0, 90), { x: MARGIN + 110, y, size: 11, font, color: dark });
    y -= 18;
  }

  if (doc.notes) {
    y -= 8;
    line("Notes", { size: 12, font: bold, color: violet, gap: 8 });
    for (const chunk of doc.notes.split(/\n+/).flatMap((p) => p.match(/.{1,100}(\s|$)/g) || [])) {
      line(chunk.trim(), { size: 10, color: gray, gap: 4 });
    }
  }

  y -= 6;
  line(`Generated ${new Date().toUTCString()} — Novara QC Documentation Hub`, { size: 8, color: gray });

  // Photo pages — 2 per page, labelled, preserving aspect ratio.
  const photos = extras.photos.slice(0, MAX_PDF_PHOTOS);
  for (let i = 0; i < photos.length; i += 2) {
    const photoPage = pdf.addPage([PAGE_W, PAGE_H]);
    for (let slot = 0; slot < 2; slot++) {
      const p = photos[i + slot];
      if (!p) break;
      try {
        const isPng = p.bytes[0] === 0x89 && p.bytes[1] === 0x50;
        const img = isPng ? await pdf.embedPng(p.bytes) : await pdf.embedJpg(p.bytes);
        const maxW = PAGE_W - MARGIN * 2;
        const maxH = (PAGE_H - MARGIN * 2 - 60) / 2;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const w = img.width * scale, h = img.height * scale;
        const topY = slot === 0 ? PAGE_H - MARGIN : PAGE_H / 2 - 10;
        photoPage.drawText(p.label, { x: MARGIN, y: topY - 12, size: 10, font: bold, color: violet });
        photoPage.drawImage(img, { x: MARGIN, y: topY - 20 - h, width: w, height: h });
      } catch (e) {
        photoPage.drawText(`${p.label} — could not embed (${e instanceof Error ? e.message : "error"})`, {
          x: MARGIN, y: slot === 0 ? PAGE_H - MARGIN - 12 : PAGE_H / 2 - 22, size: 9, font, color: gray,
        });
      }
    }
  }

  return await pdf.save();
}

// ─── Mirror one documentation row ────────────────────────────────────────────

async function mirrorOne(supabase: SB, token: string, rootFolderId: string, doc: DocRow): Promise<void> {
  const before = (Array.isArray(doc.before_photos) ? doc.before_photos : []).map(String).filter(Boolean);
  const after = (Array.isArray(doc.after_photos) ? doc.after_photos : []).map(String).filter(Boolean);

  const extras = await enrichSnapshot(supabase, doc);

  // Folder tree: root / YYYY / "MM - Month" / "NOV-xxxxx — Client — date — service"
  const dateStr = doc.service_date || (doc.completed_at || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  const [yy, mm] = dateStr.split("-");
  const monthName = MONTHS[Math.max(0, Math.min(11, Number(mm) - 1))];
  const yearFolder = await ensureFolder(token, rootFolderId, yy);
  const monthFolder = await ensureFolder(token, yearFolder, `${mm} - ${monthName}`);
  const jobFolderName = safeName(
    `${doc.booking_ref || doc.booking_id.slice(0, 8)} — ${doc.client_name || "Client"} — ${dateStr} — ${doc.service_type || "clean"}`,
  );
  const jobFolder = doc.drive_folder_id || await ensureFolder(token, monthFolder, jobFolderName);
  await shareReadableByLink(token, jobFolder);

  const beforeFolder = await ensureFolder(token, jobFolder, "before");
  const afterFolder = await ensureFolder(token, jobFolder, "after");

  // Upload originals with deterministic names so retries skip existing files.
  const existingBefore = await listChildNames(token, beforeFolder);
  const existingAfter = await listChildNames(token, afterFolder);
  const photoBytes: Array<{ label: string; bytes: Uint8Array }> = [];
  let uploaded = 0;
  const failures: string[] = [];

  const uploadSet = async (urls: string[], folderId: string, prefix: string, existing: Set<string>) => {
    for (let i = 0; i < urls.length; i++) {
      const url = urls[i];
      const name = `${prefix}-${String(i + 1).padStart(2, "0")}.${extFromUrl(url)}`;
      try {
        const res = await fetch(url);
        if (!res.ok) { failures.push(`${name}: fetch ${res.status}`); continue; }
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length === 0) { failures.push(`${name}: empty`); continue; }
        if (photoBytes.length < MAX_PDF_PHOTOS) {
          photoBytes.push({ label: `${prefix.toUpperCase()} ${i + 1} — ${doc.booking_ref || ""}`, bytes });
        }
        if (!existing.has(name)) {
          const mime = name.endsWith(".png") ? "image/png" : "image/jpeg";
          await uploadFile(token, folderId, name, bytes, mime);
          uploaded++;
        }
      } catch (e) {
        failures.push(`${name}: ${e instanceof Error ? e.message : "error"}`);
      }
    }
  };
  await uploadSet(before, beforeFolder, "before", existingBefore);
  await uploadSet(after, afterFolder, "after", existingAfter);

  // Any photo that failed to land in Drive = mirror not complete. Retry later.
  if (failures.length > 0) {
    throw new Error(`photo mirror incomplete (${failures.length}): ${failures.slice(0, 3).join("; ")}`);
  }

  // Completion summary PDF (regenerated on re-mirror so it includes new photos).
  const pdfBytes = await buildSummaryPdf(doc, { ...extras, photos: photoBytes });
  const pdfName = `${safeName(doc.booking_ref || doc.booking_id.slice(0, 8))} — Completion Summary.pdf`;
  const pdfFiles = await listChildNames(token, jobFolder);
  let pdfId = doc.drive_pdf_id;
  if (!pdfId || !pdfFiles.has(pdfName)) {
    pdfId = await uploadFile(token, jobFolder, pdfName, pdfBytes, "application/pdf");
  }

  const nowIso = new Date().toISOString();
  await supabase.from("job_documentation").update({
    mirror_status: "mirrored",
    mirrored_at: nowIso,
    mirror_last_error: null,
    mirror_next_attempt_at: null,
    drive_folder_id: jobFolder,
    drive_folder_url: folderUrl(jobFolder),
    drive_pdf_id: pdfId,
    drive_pdf_url: pdfId ? fileUrl(pdfId) : null,
    drive_file_count: before.length + after.length + 1,
    checklist_snapshot: extras.checklist,
    checklist_progress_pct: extras.checklist?.progress_pct ?? null,
    cleaner_names: extras.cleanerNames || doc.cleaner_names,
    photo_count: before.length + after.length,
    documented: before.length > 0 && after.length > 0,
    updated_at: nowIso,
  }).eq("id", doc.id);

  log("mirrored", { docId: doc.id, ref: doc.booking_ref, uploaded, folder: jobFolder });
}

// ─── Airtable push (Drive link + documented ✓) ───────────────────────────────

async function pushAirtable(supabase: SB, bookingId: string): Promise<void> {
  try {
    const syncUrl = await resolveSecret(supabase, "AIRTABLE_SYNC_URL");
    const secret = await resolveSecret(supabase, "AIRTABLE_SYNC_WEBHOOK_SECRET");
    if (!syncUrl || !secret) return;
    await fetch(syncUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-airtable-sync-secret": secret },
      body: JSON.stringify({ type: "job", id: bookingId }),
    });
  } catch (e) {
    log("airtable push failed (non-blocking)", { bookingId, error: e instanceof Error ? e.message : String(e) });
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const body = await req.json().catch(() => ({}));
    const onlyDocId = body?.docId ? String(body.docId) : null;

    if (!driveConfigured()) {
      log("skipped — Google service account not configured");
      return json({ ok: true, skipped: "drive_not_configured" });
    }
    const rootFolderId = await resolveSecret(supabase, "GDRIVE_QC_ROOT_FOLDER_ID");
    if (!rootFolderId) {
      log("skipped — GDRIVE_QC_ROOT_FOLDER_ID not set");
      return json({ ok: true, skipped: "root_folder_not_configured" });
    }

    const nowIso = new Date().toISOString();
    let query = supabase
      .from("job_documentation")
      .select("id, booking_id, job_id, booking_ref, client_name, client_email, service_type, service_date, address, cleaner_names, before_photos, after_photos, notes, completed_at, mirror_attempts, drive_folder_id, drive_pdf_id")
      .lt("mirror_attempts", MAX_ATTEMPTS)
      .order("completed_at", { ascending: true })
      .limit(BATCH_SIZE);
    if (onlyDocId) {
      query = query.eq("id", onlyDocId).in("mirror_status", ["pending", "failed", "mirrored"]);
    } else {
      query = query.or(`mirror_status.eq.pending,and(mirror_status.eq.failed,mirror_next_attempt_at.lte.${nowIso})`);
    }
    const { data: docs, error } = await query;
    if (error) throw error;
    if (!docs || docs.length === 0) return json({ ok: true, processed: 0 });

    const token = await getDriveToken();
    if (!token) {
      log("drive token failed — leaving queue untouched");
      return json({ ok: false, error: "drive_token_failed" }, 200);
    }

    let mirrored = 0, failed = 0;
    for (const doc of docs as DocRow[]) {
      // Claim the row so overlapping runs don't double-process.
      const { data: claimed } = await supabase
        .from("job_documentation")
        .update({ mirror_status: "mirroring", updated_at: nowIso })
        .eq("id", doc.id)
        .neq("mirror_status", "mirroring")
        .select("id")
        .maybeSingle();
      if (!claimed) continue;

      try {
        await mirrorOne(supabase, token, rootFolderId, doc);
        await pushAirtable(supabase, doc.booking_id);
        mirrored++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        const attempts = (doc.mirror_attempts || 0) + 1;
        const next = new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString();
        await supabase.from("job_documentation").update({
          mirror_status: "failed",
          mirror_attempts: attempts,
          mirror_last_error: msg.slice(0, 500),
          mirror_next_attempt_at: next,
          updated_at: new Date().toISOString(),
        }).eq("id", doc.id);
        failed++;
        log("mirror failed", { docId: doc.id, ref: doc.booking_ref, attempts, error: msg });

        // Loud alert once retries are exhausted — an unmirrored job is an
        // undefendable one and its photos will NOT be purged.
        if (attempts >= MAX_ATTEMPTS) {
          await supabase.from("events").insert({
            event_type: "qc.documentation.failed",
            booking_id: doc.booking_id,
            job_id: doc.job_id,
            source: "qc-drive-mirror",
            summary: `${doc.booking_ref || doc.booking_id} — Google Drive mirror FAILED after ${attempts} attempts. Photos remain in Supabase (retention paused) — fix Drive access and retry from the QC console. Last error: ${msg.slice(0, 200)}`,
            data: { documentation_id: doc.id, attempts, error: msg.slice(0, 300) },
          }).then(() => undefined, () => undefined);
        }
      }
    }

    return json({ ok: true, processed: docs.length, mirrored, failed });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
