// Policy tests for QC case photos & videos.
// Append never replaces. Paths must belong to the case. Videos are allowed.
import {
  QC_ISSUE_MEDIA_MAX_FILES,
  QC_ISSUE_MEDIA_MAX_VIDEO_BYTES,
  appendQcIssueMedia,
  evidencePathAllowed,
  legacyResolutionHttpUrls,
  mediaKindFor,
  normalizeQcIssueMedia,
  qcIssueMediaStoragePath,
  removeQcIssueMedia,
  validateQcIssueMediaFile,
} from "../supabase/functions/_shared/qc-issue-media.ts";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  ", msg);
  }
}

assert(mediaKindFor({ name: "clip.mp4", type: "video/mp4" }) === "video", "mp4 is a video");
assert(mediaKindFor({ name: "yard.MOV" }) === "video", "mov extension is a video");
assert(mediaKindFor({ name: "damage.jpg", type: "image/jpeg" }) === "photo", "jpeg is a photo");
assert(validateQcIssueMediaFile({ name: "ok.jpg", type: "image/jpeg", size: 1200 }).ok === true, "small photo allowed");
assert(validateQcIssueMediaFile({ name: "walk.mp4", type: "video/mp4", size: 5 * 1024 * 1024 }).ok === true, "5 MB video allowed");
assert(validateQcIssueMediaFile({ name: "huge.mp4", type: "video/mp4", size: QC_ISSUE_MEDIA_MAX_VIDEO_BYTES + 1 }).ok === false, "video over 80 MB rejected");
assert(validateQcIssueMediaFile({ name: "notes.pdf", type: "application/pdf", size: 1000 }).ok === false, "PDF is not case media");

const issueId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const bookingId = "11111111-2222-3333-4444-555555555555";
const path = qcIssueMediaStoragePath({ issueId, filename: "Kitchen sink.jpg", id: "abc123" });
assert(path.startsWith("evidence/issue/") && path.includes(issueId) && path.endsWith("Kitchen-sink.jpg"), "issue storage path");
assert(evidencePathAllowed(path, { issueId, bookingId }) === true, "path belongs to this issue");
assert(evidencePathAllowed(path, { issueId: "other" }) === false, "path rejected for a different issue");
assert(evidencePathAllowed("../etc/passwd", { issueId }) === false, "path traversal rejected");
assert(evidencePathAllowed("bookings/x/photo.jpg", { bookingId }) === false, "job-photo bucket paths are not case media");

const bookingPath = qcIssueMediaStoragePath({ bookingId, filename: "clip.mp4", id: "f1" });
assert(evidencePathAllowed(bookingPath, { bookingId }) === true, "field-report booking prefix allowed");
assert(evidencePathAllowed(bookingPath, { issueId }) === false, "booking path is not an issue path");

const file = {
  id: "abc123",
  filename: "Kitchen-sink.jpg",
  contentType: "image/jpeg",
  size: 1200,
  storagePath: path,
  kind: "photo" as const,
  uploadedAt: "2026-09-11T12:00:00.000Z",
  uploadedByName: "Kimberly",
  uploadedVia: "admin" as const,
};

const first = appendQcIssueMedia([], file, { issueId, bookingId });
assert(first.ok === true && first.ok && first.files.length === 1, "first file appends");
const secondPath = qcIssueMediaStoragePath({ issueId, filename: "walkthrough.mp4", id: "vid1" });
const second = appendQcIssueMedia(first.ok ? first.files : [], {
  ...file,
  id: "vid1",
  filename: "walkthrough.mp4",
  contentType: "video/mp4",
  storagePath: secondPath,
  kind: "video",
}, { issueId, bookingId });
assert(second.ok === true && second.ok && second.files.length === 2, "append does not replace existing files");
assert(second.ok && second.files.some((f) => f.kind === "video"), "video stays on the case");

const dup = appendQcIssueMedia(second.ok ? second.files : [], file, { issueId, bookingId });
assert(dup.ok === true && dup.ok && dup.added.length === 0 && dup.files.length === 2, "duplicate path is a no-op, not a replace");

const foreign = appendQcIssueMedia([], { ...file, storagePath: "evidence/issue/nope/x.jpg" }, { issueId, bookingId });
assert(foreign.ok === false, "cannot attach another case's file");

const removed = removeQcIssueMedia(second.ok ? second.files : [], "abc123");
assert(removed.removed?.id === "abc123" && removed.files.length === 1 && removed.files[0].kind === "video",
  "remove drops one file and leaves the rest");

assert(legacyResolutionHttpUrls(["https://cdn.example/a.jpg", "not-a-url"]).length === 1,
  "legacy resolution_photos http URLs still display");
assert(normalizeQcIssueMedia([{ storage_path: path, filename: "x.jpg" }]).length === 1,
  "snake_case rows from jsonb still parse");

const many = Array.from({ length: QC_ISSUE_MEDIA_MAX_FILES + 1 }, (_, i) => ({
  ...file,
  id: `n${i}`,
  storagePath: qcIssueMediaStoragePath({ issueId, filename: `f${i}.jpg`, id: `n${i}` }),
}));
const overflow = appendQcIssueMedia([], many, { issueId, bookingId });
assert(overflow.ok === false, "21st file is rejected");

if (failed) {
  console.error(`\n${failed} failing check(s)`);
  // deno-lint-ignore no-explicit-any
  const exit = (globalThis as any).Deno?.exit || ((code: number) => { (globalThis as any).process?.exit(code); });
  exit(1);
}
console.log("\nall qc issue media checks passed");
