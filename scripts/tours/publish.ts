/**
 * Publish the generated walkthrough recordings to the training platform.
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run tours:publish
 *   TOURS_PUBLISH_DRY_RUN=1 npm run tours:publish    # list, upload nothing
 *
 * Run `npm run tours:record` first — this only moves what that produced.
 *
 * Where things live and why:
 *
 *   docs/contractor-tours/recordings/*.webm|*.vtt   local output, gitignored
 *   contractor-tour-recordings bucket (private)     what the app serves
 *   src/lib/tours/recordings.manifest.json          committed, the index
 *
 * The bucket is private. training.novaracleaning.com and the contractor
 * training page both reach the clips through short-lived signed URLs, so
 * "published" never means "publicly addressable" — the clips are captured
 * against a demo account and contain nothing real, but an internal training
 * clip sitting on a guessable public URL is still an avoidable mistake.
 *
 * Uploads use a stable path per walkthrough and overwrite in place. There's no
 * versioning scheme on the objects on purpose: the committed manifest is what
 * answers "is this current?", and a pile of dated object names would just be a
 * second, worse answer to the same question.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { TOURS_BY_ID, type TourId } from "../../src/lib/tours/catalog";

const REPO_ROOT = resolve(__dirname, "../..");
const RECORDINGS_DIR = resolve(REPO_ROOT, "docs/contractor-tours/recordings");
const MANIFEST = resolve(REPO_ROOT, "src/lib/tours/recordings.manifest.json");
const BUCKET = "contractor-tour-recordings";
const DRY_RUN = process.env.TOURS_PUBLISH_DRY_RUN === "1";

interface ManifestEntry {
  id: TourId;
  title: string;
  file: string;
  captionFile: string;
  durationSeconds: number;
  generatedAt: string;
  problems?: string[];
}

const CONTENT_TYPE: Record<string, string> = {
  webm: "video/webm",
  vtt: "text/vtt",
};

function contentTypeFor(name: string): string {
  const ext = name.split(".").pop() || "";
  return CONTENT_TYPE[ext] || "application/octet-stream";
}

async function main(): Promise<void> {
  if (!existsSync(MANIFEST)) {
    console.error("No manifest. Run `npm run tours:record` first.");
    process.exit(1);
  }

  const manifest = JSON.parse(readFileSync(MANIFEST, "utf8")) as {
    recordings?: ManifestEntry[];
  };
  const recordings = (manifest.recordings || []).filter((r) => r.file);

  if (!recordings.length) {
    console.error(
      "The manifest has no recordings. Start the dev server and run `npm run tours:record`.",
    );
    process.exit(1);
  }

  // A clip whose recording run reported problems is usually a clip of a
  // half-rendered screen. Publishing it would put a broken video in front of
  // contractors, which is worse than having no video at all.
  const broken = recordings.filter((r) => (r.problems || []).length);
  if (broken.length) {
    console.error("These recordings had problems and won't be published:");
    for (const r of broken) {
      console.error(`  ${r.id}: ${(r.problems || []).join("; ")}`);
    }
    console.error("Re-record them, then publish.");
    process.exit(1);
  }

  const uploads: Array<{ path: string; local: string; bytes: number }> = [];
  for (const recording of recordings) {
    if (!TOURS_BY_ID[recording.id]) {
      console.error(
        `${recording.id} is in the manifest but not in the catalog. Re-record.`,
      );
      process.exit(1);
    }
    for (const name of [recording.file, recording.captionFile]) {
      if (!name) continue;
      const local = resolve(RECORDINGS_DIR, name);
      if (!existsSync(local)) {
        console.error(`Missing ${name} on disk. Re-record before publishing.`);
        process.exit(1);
      }
      uploads.push({ path: name, local, bytes: statSync(local).size });
    }
  }

  console.log(
    `${recordings.length} walkthrough recording(s), ${uploads.length} file(s) → ${BUCKET}`,
  );
  for (const upload of uploads) {
    console.log(`  ${upload.path}  ${(upload.bytes / 1024 / 1024).toFixed(2)} MB`);
  }

  if (DRY_RUN) {
    console.log("\nDry run — nothing uploaded.");
    return;
  }

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "\nSet SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to publish (or TOURS_PUBLISH_DRY_RUN=1 to preview).",
    );
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, { auth: { persistSession: false } });

  let failed = 0;
  for (const upload of uploads) {
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(upload.path, readFileSync(upload.local), {
        contentType: contentTypeFor(upload.path),
        upsert: true,
      });

    if (error) {
      console.error(`  ✗ ${upload.path}: ${error.message}`);
      failed += 1;
    } else {
      console.log(`  ✓ ${upload.path}`);
    }
  }

  if (failed) {
    console.error(`\n${failed} upload(s) failed.`);
    process.exit(1);
  }

  console.log(
    "\nPublished. Commit src/lib/tours/recordings.manifest.json so the app knows " +
      "what's available and when it was captured.",
  );
}

void main().catch((err) => {
  console.error(err);
  process.exit(1);
});
