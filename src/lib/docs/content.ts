// ─── Admin workspace documentation — content loader ────────────────────────
//
// The guides live as markdown files in docs/admin-workspace/. They are read
// from disk at request time on the server, never bundled to the client, and
// never served to anyone who has not passed the admin gate.
//
// Keeping them as plain files (rather than rows in a table) is deliberate:
//   • they version with the code they describe, so a pull request that
//     changes a screen and a pull request that updates its guide are the
//     same review;
//   • the screenshots sit beside them and are recaptured in the same pass;
//   • the Ops Assistant ingests exactly these files, so the assistant and
//     the site cannot drift into two versions of the truth.

import "server-only";

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const DOCS_DIR = join(process.cwd(), "docs/admin-workspace");
const SCREENSHOT_DIR = join(DOCS_DIR, "screenshots");

export interface DocFrontMatter {
  title: string;
  /** Functional area the guide covers, used for grouping in the sidebar. */
  area: string;
  /** "How the Tool Works" — kept distinct from the policy/pricing docs. */
  category: string;
  summary: string;
  /** Which roles can actually open this screen in the workspace. */
  whoCanSee: string;
  /** The workspace path this guide describes, e.g. /admin/bookings. */
  where: string;
  /** ISO date this guide was last checked against the code. */
  lastVerified: string;
  /** Sidebar ordering. */
  order: number;
}

export interface Doc extends DocFrontMatter {
  slug: string;
  body: string;
  /** Section headings, for the in-page contents and the search index. */
  headings: Array<{ id: string; text: string; level: number }>;
}

export interface ScreenshotEntry {
  id: string;
  doc: string;
  caption: string;
  url: string;
  file: string | null;
  callouts: Array<{ n: number; label: string }>;
  problems: string[];
  capturedAt: string;
}

interface Manifest {
  generatedAt: string;
  shots: ScreenshotEntry[];
}

/**
 * Minimal front-matter parser. The guides only ever use `key: value`, so
 * pulling in a YAML dependency to read nine scalar fields would be more
 * surface area than the job needs.
 */
function parseFrontMatter(raw: string): { data: Record<string, string>; body: string } {
  if (!raw.startsWith("---")) return { data: {}, body: raw };
  const end = raw.indexOf("\n---", 3);
  if (end === -1) return { data: {}, body: raw };

  const block = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, "");
  const data: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body };
}

/**
 * Which markdown files are published guides. README.md is the maintainer's
 * runbook and underscore-prefixed files are data — neither is VA-facing, and
 * both would otherwise show up in the sidebar.
 */
export function isGuideFile(name: string): boolean {
  return name.endsWith(".md") && !name.startsWith("_") && name !== "README.md";
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function extractHeadings(body: string) {
  const headings: Array<{ id: string; text: string; level: number }> = [];
  let inFence = false;
  for (const line of body.split("\n")) {
    if (line.trimStart().startsWith("```")) inFence = !inFence;
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.*)$/.exec(line);
    if (!m) continue;
    const text = m[2].replace(/[*_`]/g, "").trim();
    headings.push({ id: slugify(text), text, level: m[1].length });
  }
  return headings;
}

let cache: Doc[] | null = null;

export function getAllDocs(): Doc[] {
  // Cache in production only — in development a doc edit should show up on
  // reload without restarting the server.
  if (cache && process.env.NODE_ENV === "production") return cache;
  if (!existsSync(DOCS_DIR)) return [];

  const docs = readdirSync(DOCS_DIR)
    .filter(isGuideFile)
    .map((file) => {
      const raw = readFileSync(join(DOCS_DIR, file), "utf8");
      const { data, body } = parseFrontMatter(raw);
      return {
        slug: file.replace(/\.md$/, ""),
        title: data.title || file,
        area: data.area || "Other",
        category: data.category || "How the Tool Works",
        summary: data.summary || "",
        whoCanSee: data.whoCanSee || "Admins and VAs",
        where: data.where || "",
        lastVerified: data.lastVerified || "",
        order: Number(data.order || 999),
        body,
        headings: extractHeadings(body),
      } satisfies Doc;
    })
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  cache = docs;
  return docs;
}

export function getDoc(slug: string): Doc | null {
  return getAllDocs().find((d) => d.slug === slug) ?? null;
}

let manifestCache: Manifest | null = null;

export function getScreenshotManifest(): Manifest {
  if (manifestCache && process.env.NODE_ENV === "production") return manifestCache;
  const path = join(SCREENSHOT_DIR, "manifest.json");
  if (!existsSync(path)) return { generatedAt: "", shots: [] };
  manifestCache = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  return manifestCache;
}

export function getScreenshot(id: string): ScreenshotEntry | null {
  return getScreenshotManifest().shots.find((s) => s.id === id) ?? null;
}

/** Read a screenshot from disk. Only ever called behind the admin gate. */
export function readScreenshotFile(file: string): Buffer | null {
  // Defend against traversal: the name must be a plain PNG in the folder.
  if (!/^[a-z0-9-]+\.png$/i.test(file)) return null;
  const path = join(SCREENSHOT_DIR, file);
  if (!existsSync(path)) return null;
  return readFileSync(path);
}

export interface PricingExamples {
  generatedAt: string;
  snapshotCapturedAt: string;
  configVersion: number;
  floorInputs: {
    minEffectiveHourly: string;
    soloFoundationPercent: number;
    crewFoundationPercent: number;
  };
  demand: { enabled: boolean; shadowMode: boolean; resolvedMode: string; note: string };
  floorTable: Array<{
    bandId: string;
    label: string;
    hours: number;
    crewSize: number;
    singleVisit: string;
    combo: string;
  }>;
  examples: Array<{
    id: string;
    scenario: string;
    zone: { code: string; name: string; multiplier: number };
    steps: Array<{ label: string; reason: string; amount: string; multiplier: number | null; kind: string }>;
    totals: Record<string, unknown> & { total: string; floor: string; floorClamped: boolean };
  }>;
}

export function getPricingExamples(): PricingExamples | null {
  const path = join(DOCS_DIR, "_data/pricing-examples.generated.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as PricingExamples;
}
