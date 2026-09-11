// QC report photos & videos attached to a case — not job before/after.
// Stored in qc-statement-files (private, durable). Never cleaner-job-photos
// (those purge after 14 days unless the case is retain_permanently).

export const QC_ISSUE_MEDIA_BUCKET = "qc-statement-files";
export const QC_ISSUE_MEDIA_MAX_FILES = 20;
export const QC_ISSUE_MEDIA_MAX_PHOTO_BYTES = 20 * 1024 * 1024;
export const QC_ISSUE_MEDIA_MAX_VIDEO_BYTES = 80 * 1024 * 1024;
export const QC_ISSUE_MEDIA_PREFIX = "evidence/";

export type QcIssueMediaKind = "photo" | "video";
export type QcIssueMediaVia = "admin" | "cleaner_field";

export interface QcIssueMediaFile {
  id: string;
  filename: string;
  contentType: string;
  size: number;
  storagePath: string;
  kind: QcIssueMediaKind;
  uploadedAt: string;
  uploadedByName: string | null;
  uploadedVia: QcIssueMediaVia;
  driveFileId?: string | null;
  driveFileUrl?: string | null;
}

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "gif", "webp", "heic", "heif", "avif"]);
const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v", "avi", "3gp", "mkv", "qt"]);

function extOf(name: string): string {
  return (String(name || "").split(".").pop() || "").toLowerCase();
}

export function isVideoFilename(name: string, type?: string): boolean {
  const t = String(type || "").toLowerCase();
  if (t.startsWith("video/")) return true;
  return VIDEO_EXT.has(extOf(name));
}

export function safeMediaFilename(name: string): string {
  return String(name || "file")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80) || "file";
}

export function mediaKindFor(input: { name?: string; type?: string }): QcIssueMediaKind {
  return isVideoFilename(String(input.name || ""), input.type) ? "video" : "photo";
}

export function validateQcIssueMediaFile(input: {
  name: string;
  type?: string;
  size: number;
}): { ok: true; kind: QcIssueMediaKind } | { ok: false; error: string } {
  const name = String(input.name || "file");
  const type = String(input.type || "");
  const kind = mediaKindFor({ name, type });
  const ext = extOf(name);
  const allowedType =
    type.startsWith("image/") ||
    type.startsWith("video/") ||
    type === "application/octet-stream" ||
    type === "";
  const allowedExt = IMAGE_EXT.has(ext) || VIDEO_EXT.has(ext);
  if (!allowedType && !allowedExt) {
    return { ok: false, error: "Upload a photo or a short video." };
  }
  if (kind === "video") {
    if (input.size > QC_ISSUE_MEDIA_MAX_VIDEO_BYTES) {
      const mb = Math.round(input.size / (1024 * 1024));
      return { ok: false, error: `“${name}” is ${mb} MB. Keep videos under 80 MB — a short clip is enough.` };
    }
  } else if (input.size > QC_ISSUE_MEDIA_MAX_PHOTO_BYTES) {
    const mb = Math.round(input.size / (1024 * 1024));
    return { ok: false, error: `“${name}” is ${mb} MB. Keep photos under 20 MB.` };
  }
  if (input.size <= 0) return { ok: false, error: "That file is empty." };
  return { ok: true, kind };
}

export function qcIssueMediaStoragePath(opts: {
  issueId?: string | null;
  bookingId?: string | null;
  filename: string;
  id: string;
}): string {
  const filename = safeMediaFilename(opts.filename);
  if (opts.issueId) return `${QC_ISSUE_MEDIA_PREFIX}issue/${opts.issueId}/${opts.id}-${filename}`;
  if (opts.bookingId) return `${QC_ISSUE_MEDIA_PREFIX}booking/${opts.bookingId}/${opts.id}-${filename}`;
  throw new Error("issueId or bookingId required");
}

export function evidencePathAllowed(
  path: string,
  ctx: { issueId?: string | null; bookingId?: string | null },
): boolean {
  const p = String(path || "");
  if (!p.startsWith(QC_ISSUE_MEDIA_PREFIX)) return false;
  if (p.includes("..") || p.startsWith("/")) return false;
  if (ctx.issueId && p.startsWith(`${QC_ISSUE_MEDIA_PREFIX}issue/${ctx.issueId}/`)) return true;
  if (ctx.bookingId && p.startsWith(`${QC_ISSUE_MEDIA_PREFIX}booking/${ctx.bookingId}/`)) return true;
  return false;
}

export function parseQcIssueMediaItem(raw: unknown): QcIssueMediaFile | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as Record<string, unknown>;
  const storagePath = String(d.storagePath || d.storage_path || "");
  if (!storagePath.startsWith(QC_ISSUE_MEDIA_PREFIX) || storagePath.includes("..")) return null;
  const filename = safeMediaFilename(String(d.filename || storagePath.split("/").pop() || "file"));
  const contentType = String(d.contentType || d.content_type || "application/octet-stream").slice(0, 120);
  const kind: QcIssueMediaKind = d.kind === "video" || isVideoFilename(filename, contentType)
    ? "video"
    : "photo";
  const via = d.uploadedVia === "cleaner_field" || d.uploaded_via === "cleaner_field"
    ? "cleaner_field"
    : "admin";
  return {
    id: String(d.id || storagePath).slice(0, 80),
    filename,
    contentType,
    size: Math.max(0, Number(d.size) || 0),
    storagePath,
    kind,
    uploadedAt: String(d.uploadedAt || d.uploaded_at || new Date().toISOString()),
    uploadedByName: d.uploadedByName || d.uploaded_by_name
      ? String(d.uploadedByName || d.uploaded_by_name).slice(0, 120)
      : null,
    uploadedVia: via,
    driveFileId: d.driveFileId || d.drive_file_id ? String(d.driveFileId || d.drive_file_id) : null,
    driveFileUrl: d.driveFileUrl || d.drive_file_url ? String(d.driveFileUrl || d.drive_file_url) : null,
  };
}

export function normalizeQcIssueMedia(raw: unknown): QcIssueMediaFile[] {
  if (!Array.isArray(raw)) return [];
  const out: QcIssueMediaFile[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const parsed = parseQcIssueMediaItem(item);
    if (!parsed) continue;
    const key = parsed.storagePath;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(parsed);
    if (out.length >= QC_ISSUE_MEDIA_MAX_FILES) break;
  }
  return out;
}

export function appendQcIssueMedia(
  existing: unknown,
  incoming: unknown,
  ctx: { issueId?: string | null; bookingId?: string | null },
): { ok: true; files: QcIssueMediaFile[]; added: QcIssueMediaFile[] } | { ok: false; error: string } {
  const current = normalizeQcIssueMedia(existing);
  const addRaw = Array.isArray(incoming) ? incoming : incoming ? [incoming] : [];
  const added: QcIssueMediaFile[] = [];
  const seen = new Set(current.map((f) => f.storagePath));
  for (const item of addRaw) {
    const parsed = parseQcIssueMediaItem(item);
    if (!parsed) return { ok: false, error: "That attachment isn't a QC case photo or video." };
    if (!evidencePathAllowed(parsed.storagePath, ctx)) {
      return { ok: false, error: "That file doesn't belong to this QC case." };
    }
    if (seen.has(parsed.storagePath)) continue;
    if (current.length + added.length >= QC_ISSUE_MEDIA_MAX_FILES) {
      return { ok: false, error: `A case can hold ${QC_ISSUE_MEDIA_MAX_FILES} photos or videos.` };
    }
    seen.add(parsed.storagePath);
    added.push(parsed);
  }
  return { ok: true, files: [...current, ...added], added };
}

export function removeQcIssueMedia(
  existing: unknown,
  mediaId: string,
): { files: QcIssueMediaFile[]; removed: QcIssueMediaFile | null } {
  const current = normalizeQcIssueMedia(existing);
  const id = String(mediaId || "");
  const removed = current.find((f) => f.id === id || f.storagePath === id) || null;
  return {
    files: current.filter((f) => f.id !== id && f.storagePath !== id),
    removed,
  };
}

/** Legacy resolve() stored public http URLs. Show them next to case files, never mixed into job before/after. */
export function legacyResolutionHttpUrls(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(String).filter((u) => u.startsWith("http")).slice(0, QC_ISSUE_MEDIA_MAX_FILES);
}
