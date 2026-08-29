// ─── Integrity check for the admin workspace guides ────────────────────────
//
//   npm run docs:verify
//
// Documentation rots quietly. These checks make the common failures loud:
//
//   • a guide referencing a screenshot that was never captured
//   • a captured screenshot no guide uses (usually a renamed section)
//   • a screenshot filed against a guide that doesn't exist
//   • a callout that couldn't be located during capture, which means the
//     screen moved and the matching step probably needs rewriting
//   • missing or malformed front matter, including the "last verified" date
//   • guides whose screenshots are older than the guide itself — a stale
//     image is worse than none, because it misleads rather than just
//     failing to help
//
// It also prints the consolidated drift punch list, so the set of places
// where an existing document and the live code disagree can be read in one
// go rather than hunted for across sixteen files.

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/** README.md is the maintainer runbook, not a published guide. */
function isGuideFile(name: string): boolean {
  return name.endsWith(".md") && !name.startsWith("_") && name !== "README.md";
}

const ROOT = resolve(__dirname, "../..");
const DOCS_DIR = join(ROOT, "docs/admin-workspace");
const SHOTS_DIR = join(DOCS_DIR, "screenshots");

const REQUIRED_FIELDS = [
  "title",
  "area",
  "category",
  "summary",
  "whoCanSee",
  "where",
  "lastVerified",
  "order",
];

interface ShotEntry {
  id: string;
  doc: string;
  file: string | null;
  problems: string[];
  capturedAt: string;
}

const problems: string[] = [];
const warnings: string[] = [];

function parseFrontMatter(raw: string) {
  if (!raw.startsWith("---")) return { data: {} as Record<string, string>, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {} as Record<string, string>, body: raw };
  const data: Record<string, string> = {};
  for (const line of raw.slice(4, end).split("\n")) {
    const i = line.indexOf(":");
    if (i === -1) continue;
    data[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { data, body: raw.slice(end + 4) };
}

function main() {
  if (!existsSync(DOCS_DIR)) {
    console.error(`No docs directory at ${DOCS_DIR}`);
    process.exit(1);
  }

  const files = readdirSync(DOCS_DIR).filter(isGuideFile);
  if (files.length === 0) problems.push("No guides found.");

  const manifestPath = join(SHOTS_DIR, "manifest.json");
  const manifest: { shots: ShotEntry[] } = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : { shots: [] };

  const shotsById = new Map(manifest.shots.map((s) => [s.id, s]));
  const referenced = new Set<string>();
  const slugs = new Set(files.map((f) => f.replace(/\.md$/, "")));
  const drift: Array<{ doc: string; title: string; text: string }> = [];
  const unverified: Array<{ doc: string; text: string }> = [];

  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const raw = readFileSync(join(DOCS_DIR, file), "utf8");
    const { data, body } = parseFrontMatter(raw);

    for (const field of REQUIRED_FIELDS) {
      if (!data[field]) problems.push(`${slug}: front matter is missing "${field}"`);
    }
    if (data.lastVerified && !/^\d{4}-\d{2}-\d{2}$/.test(data.lastVerified)) {
      problems.push(`${slug}: lastVerified "${data.lastVerified}" is not YYYY-MM-DD`);
    }

    // Screenshot references
    const docMtime = statSync(join(DOCS_DIR, file)).mtimeMs;
    for (const m of body.matchAll(/^@screenshot\s+([a-z0-9-]+)\s*$/gim)) {
      const id = m[1];
      referenced.add(id);
      const shot = shotsById.get(id);
      if (!shot) {
        problems.push(`${slug}: references screenshot "${id}" which has never been captured`);
        continue;
      }
      if (!shot.file) {
        problems.push(`${slug}: screenshot "${id}" failed to capture`);
        continue;
      }
      if (!existsSync(join(SHOTS_DIR, shot.file))) {
        problems.push(`${slug}: screenshot file ${shot.file} is missing from disk`);
        continue;
      }
      if (shot.problems.length) {
        warnings.push(
          `${slug}: screenshot "${id}" had ${shot.problems.length} unlocated callout(s) — the screen may have moved`,
        );
      }
      const shotTime = new Date(shot.capturedAt).getTime();
      if (Number.isFinite(shotTime) && shotTime < docMtime - 7 * 86_400_000) {
        warnings.push(
          `${slug}: screenshot "${id}" was captured more than a week before the guide was last edited — recapture it`,
        );
      }
    }

    // Collect the drift and unverified callouts for the punch list.
    const lines = body.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const open = /^:::(drift|unverified)(?:\s+(.*))?$/.exec(lines[i].trim());
      if (!open) continue;
      const title = open[2]?.trim() || "";
      const inner: string[] = [];
      i++;
      while (i < lines.length && lines[i].trim() !== ":::") inner.push(lines[i++]);
      const text = inner.join(" ").replace(/\s+/g, " ").trim();
      if (open[1] === "drift") drift.push({ doc: slug, title, text });
      else unverified.push({ doc: slug, text });
    }
  }

  for (const shot of manifest.shots) {
    if (!slugs.has(shot.doc)) {
      problems.push(`screenshot "${shot.id}" is filed against guide "${shot.doc}", which does not exist`);
    }
    if (!referenced.has(shot.id)) {
      warnings.push(`screenshot "${shot.id}" was captured but no guide uses it`);
    }
  }

  // ── Report ──
  console.log(`Guides:      ${files.length}`);
  console.log(`Screenshots: ${manifest.shots.length} captured, ${referenced.size} referenced`);
  console.log(`Drift notes: ${drift.length}`);
  console.log(`Unverified:  ${unverified.length}\n`);

  if (drift.length) {
    console.log("── Drift punch list (existing docs vs live code) ──");
    for (const d of drift) {
      console.log(`  [${d.doc}] ${d.title}`);
      console.log(`      ${d.text.slice(0, 160)}${d.text.length > 160 ? "…" : ""}`);
    }
    console.log();
  }

  if (unverified.length) {
    console.log("── Needs human confirmation ──");
    for (const u of unverified) {
      console.log(`  [${u.doc}] ${u.text.slice(0, 160)}${u.text.length > 160 ? "…" : ""}`);
    }
    console.log();
  }

  if (warnings.length) {
    console.log("── Warnings ──");
    for (const w of warnings) console.log(`  ${w}`);
    console.log();
  }

  if (problems.length) {
    console.log("── Problems ──");
    for (const p of problems) console.log(`  ${p}`);
    console.log(`\n${problems.length} problem(s).`);
    process.exitCode = 1;
    return;
  }

  console.log("All guides check out.");
}

main();
