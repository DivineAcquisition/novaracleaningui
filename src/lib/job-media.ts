/** Before/after job media: photos and short videos live in the same URL arrays. */

const VIDEO_EXT = new Set(["mp4", "mov", "webm", "m4v", "avi", "3gp", "mkv", "qt"]);

export const MAX_VIDEO_BYTES = 80 * 1024 * 1024;

export function isVideoFile(file: File): boolean {
  if ((file.type || "").toLowerCase().startsWith("video/")) return true;
  const ext = (file.name.split(".").pop() || "").toLowerCase();
  return VIDEO_EXT.has(ext);
}

export function isVideoUrl(url: string): boolean {
  const path = url.split("?")[0].toLowerCase();
  const ext = path.split(".").pop() || "";
  return VIDEO_EXT.has(ext);
}

export function videoTooLargeMessage(file: File): string | null {
  if (!isVideoFile(file)) return null;
  if (file.size <= MAX_VIDEO_BYTES) return null;
  const mb = Math.round(file.size / (1024 * 1024));
  return `“${file.name}” is ${mb} MB. Keep videos under 80 MB — a short walkthrough clip is enough.`;
}
