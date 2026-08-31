// ─── Load the live How-the-Tool-Works pack ────────────────────────────────
//
// Reads the same markdown files the docs site publishes. Regenerating a
// guide updates what the assistant cites on the next request — there is no
// separate upload step and no window where the site and the assistant
// disagree.

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  buildKnowledgePack,
  isGuideFile,
  type GuideChunk,
  type KnowledgePack,
  type ShotInput,
} from "./guide-chunks";
import type { PolicyArticle } from "./types";
import { BUILTIN_ARTICLES } from "./policy-articles";

const DOCS_DIR = join(process.cwd(), "docs/admin-workspace");
const SHOTS = join(DOCS_DIR, "screenshots/manifest.json");

let cache: { pack: KnowledgePack; at: number } | null = null;
const TTL_MS = process.env.NODE_ENV === "production" ? 30_000 : 0;

export function loadGuideFiles(): { files: Array<{ slug: string; raw: string }>; shots: ShotInput[] } {
  if (!existsSync(DOCS_DIR)) return { files: [], shots: [] };
  const files = readdirSync(DOCS_DIR)
    .filter(isGuideFile)
    .map((name) => ({
      slug: name.replace(/\.md$/, ""),
      raw: readFileSync(join(DOCS_DIR, name), "utf8"),
    }));
  let shots: ShotInput[] = [];
  if (existsSync(SHOTS)) {
    try {
      const manifest = JSON.parse(readFileSync(SHOTS, "utf8")) as { shots?: ShotInput[] };
      shots = (manifest.shots || []).map((s) => ({
        id: s.id,
        doc: s.doc,
        caption: s.caption,
        callouts: s.callouts || [],
      }));
    } catch {
      shots = [];
    }
  }
  return { files, shots };
}

export function loadLiveKnowledgePack(): KnowledgePack {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.pack;
  const { files, shots } = loadGuideFiles();
  const pack = buildKnowledgePack(files, shots);
  cache = { pack, at: Date.now() };
  return pack;
}

export function loadGuideChunks(): GuideChunk[] {
  return loadLiveKnowledgePack().chunks;
}

export function seedArticles(): PolicyArticle[] {
  return BUILTIN_ARTICLES;
}
