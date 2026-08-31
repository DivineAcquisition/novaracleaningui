// ─── Published crew-list templates (job token, not walkthrough) ──────────
//
// Property types still store a published /checklist template so Commercial
// hub Checklists and the assigned-cleaner job token can start from the
// right family. STR may resemble residential; commercial types do not.
//
// The walkthrough token never ticks these sections. Site findings live in
// proposal-request.ts and feed firm price.

import {
  CHECKLISTS,
  CHECKLIST_SLUGS,
  type ChecklistSlug,
} from "@/lib/checklists";

export type ScopeTemplateKey = ChecklistSlug;

export interface ScopeChecklistSection {
  title: string;
  items: string[];
  photoRequired?: boolean;
}

export interface ScopeItemState {
  done?: boolean;
  skipped?: boolean;
  skipReason?: string;
}

/** Stored on walkthrough `checklist_answers` so it never collides with a field key. */
export const SCOPE_PROGRESS_ANSWER_KEY = "scope_progress";

export const SCOPE_TEMPLATE_LABEL: Record<ScopeTemplateKey, string> = {
  "standard-clean": "Standard Clean (residential)",
  "deep-clean": "Deep Clean (residential)",
  "move-in-out": "Move In / Out (residential)",
  recurring: "Recurring Clean (residential)",
  "commercial-light": "Commercial Light",
  "commercial-standard": "Commercial Standard",
  "commercial-detailed": "Commercial Detailed",
  office: "Office Clean",
};

export function isScopeTemplate(raw: unknown): raw is ScopeTemplateKey {
  return typeof raw === "string" && (CHECKLIST_SLUGS as string[]).includes(raw);
}

export function defaultScopeTemplateForType(
  typeKey: string,
  accountKind?: string,
): ScopeTemplateKey {
  if (typeKey === "str" || accountKind === "str") return "standard-clean";
  if (typeKey === "office" || accountKind === "office") return "office";
  return "commercial-standard";
}

export function scopeSectionsFromTemplate(slug: ScopeTemplateKey): ScopeChecklistSection[] {
  const list = CHECKLISTS[slug];
  return (list?.sections || []).map((section) => ({
    title: section.title,
    items: [...section.items],
  }));
}

export function cloneScopeSections(sections: ScopeChecklistSection[]): ScopeChecklistSection[] {
  return sections.map((section) => ({
    title: section.title,
    items: [...section.items],
    photoRequired: section.photoRequired,
  }));
}

export function sanitizeScopeSections(raw: unknown): ScopeChecklistSection[] {
  if (!Array.isArray(raw)) return [];
  const out: ScopeChecklistSection[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const title = String(row.title || "").trim().slice(0, 80);
    const items = Array.isArray(row.items)
      ? row.items.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 80)
      : [];
    if (!title && items.length === 0) continue;
    out.push({
      title: title || "Section",
      items,
      photoRequired: Boolean(row.photoRequired),
    });
  }
  return out;
}

/** Missing saved scope falls back to the published template. An explicit [] is kept. */
export function mergeScopeSections(
  defaults: ScopeChecklistSection[],
  saved?: unknown,
): ScopeChecklistSection[] {
  if (saved === undefined || saved === null) return cloneScopeSections(defaults);
  return sanitizeScopeSections(saved);
}

export function scopeProgressKey(sectionIdx: number, itemIdx: number): string {
  return `${sectionIdx}:${itemIdx}`;
}

export function parseScopeProgress(raw: unknown): Record<string, ScopeItemState> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, ScopeItemState> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const row = value as ScopeItemState;
    out[key] = {
      done: Boolean(row.done),
      skipped: Boolean(row.skipped),
      skipReason: row.skipReason ? String(row.skipReason).slice(0, 400) : undefined,
    };
  }
  return out;
}

export function scopeProgressStats(
  sections: ScopeChecklistSection[],
  progress: Record<string, ScopeItemState>,
): { total: number; completed: number; pct: number } {
  let total = 0;
  let completed = 0;
  sections.forEach((section, sectionIdx) => {
    section.items.forEach((_, itemIdx) => {
      total += 1;
      const entry = progress[scopeProgressKey(sectionIdx, itemIdx)];
      if (entry?.done || (entry?.skipped && entry.skipReason)) completed += 1;
    });
  });
  return {
    total,
    completed,
    pct: total === 0 ? 0 : Math.round((completed / total) * 100),
  };
}

export function itemIsComplete(entry: ScopeItemState | undefined): boolean {
  return Boolean(entry?.done || (entry?.skipped && entry.skipReason));
}
