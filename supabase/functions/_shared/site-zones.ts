// ─── Site zone map — proof of completion for large commercial facilities ───
//
// A Zone is a named physical section of a site (Loading Dock, Office Area).
// It is defined once at the walkthrough, stored on the Site, and reused on
// every later visit. Small sites stay on a single before/after pair.
//
// photo_zones jsonb accepts either string names (legacy) or
// { id, name, description } objects. Every reader goes through parseSiteZones.

export type ZoneStatus = "complete" | "partial" | "not_done";

export interface SiteZone {
  id: string;
  name: string;
  description: string;
}

export interface ZoneCompletion {
  zoneId: string;
  name: string;
  status: ZoneStatus;
  note: string;
  by?: string | null;
  at?: string | null;
}

const ZONE_STATUSES: ZoneStatus[] = ["complete", "partial", "not_done"];

export function isZoneStatus(v: unknown): v is ZoneStatus {
  return ZONE_STATUSES.includes(v as ZoneStatus);
}

export function newZoneId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `z-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function asName(v: unknown): string {
  return String(v ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
}

export function parseSiteZones(raw: unknown, max = 12): SiteZone[] {
  if (!Array.isArray(raw)) return [];
  const out: SiteZone[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (out.length >= max) break;
    let name = "";
    let description = "";
    let id = "";
    if (typeof entry === "string" || typeof entry === "number") {
      name = asName(entry);
    } else if (entry && typeof entry === "object") {
      const o = entry as Record<string, unknown>;
      name = asName(o.name ?? o.label ?? o.title);
      description = String(o.description ?? o.notes ?? "").trim().slice(0, 400);
      id = String(o.id ?? "").trim();
    }
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: id || newZoneId(), name, description });
  }
  return out;
}

export function siteZoneNames(raw: unknown, max = 12): string[] {
  return parseSiteZones(raw, max).map((z) => z.name);
}

export function serializeSiteZones(zones: SiteZone[], max = 12): SiteZone[] {
  return parseSiteZones(zones, max);
}

/** Independent of the walkthrough gate, but ships at the same default. */
export function zoneThresholdSqft(settings: {
  walkthrough_threshold_sqft?: number;
  photo_zone_threshold_sqft?: number;
  zone_threshold_sqft?: number;
} | null | undefined): number {
  const s = settings || {};
  const independent = Number(s.zone_threshold_sqft);
  if (Number.isFinite(independent) && independent > 0) return Math.round(independent);
  const photo = Number(s.photo_zone_threshold_sqft);
  if (Number.isFinite(photo) && photo > 0) return Math.round(photo);
  const walk = Number(s.walkthrough_threshold_sqft);
  return Number.isFinite(walk) && walk > 0 ? Math.round(walk) : 5000;
}

export function siteRequiresZones(
  sqft: number,
  settings?: {
    walkthrough_threshold_sqft?: number;
    photo_zone_threshold_sqft?: number;
    zone_threshold_sqft?: number;
  } | null,
): boolean {
  const n = Math.max(0, Math.round(Number(sqft) || 0));
  const threshold = zoneThresholdSqft(settings);
  return n > 0 && threshold > 0 && n >= threshold;
}

export function addZone(
  zones: SiteZone[],
  name: string,
  description = "",
  max = 12,
): SiteZone[] {
  const next = parseSiteZones(zones, max);
  const parsed = asName(name);
  if (!parsed) return next;
  if (next.some((z) => z.name.toLowerCase() === parsed.toLowerCase())) return next;
  if (next.length >= max) return next;
  next.push({ id: newZoneId(), name: parsed, description: description.trim().slice(0, 400) });
  return next;
}

export function renameZone(zones: SiteZone[], id: string, name: string, description?: string): SiteZone[] {
  const parsed = asName(name);
  return parseSiteZones(zones).map((z) => {
    if (z.id !== id) return z;
    return {
      ...z,
      name: parsed || z.name,
      description: description == null ? z.description : String(description).trim().slice(0, 400),
    };
  });
}

/** One zone becomes two. The original keeps leftName; a sibling is inserted after it. */
export function splitZone(
  zones: SiteZone[],
  id: string,
  leftName: string,
  rightName: string,
  rightDescription = "",
  max = 12,
): SiteZone[] {
  const list = parseSiteZones(zones, max);
  const idx = list.findIndex((z) => z.id === id);
  if (idx < 0 || list.length >= max) return list;
  const left = asName(leftName) || list[idx].name;
  const right = asName(rightName);
  if (!right) return list;
  list[idx] = { ...list[idx], name: left };
  list.splice(idx + 1, 0, {
    id: newZoneId(),
    name: right,
    description: rightDescription.trim().slice(0, 400),
  });
  return parseSiteZones(list, max);
}

/** Fold dropId into keepId. Descriptions concatenate; the dropped id is gone. */
export function mergeZones(zones: SiteZone[], keepId: string, dropId: string): SiteZone[] {
  if (!keepId || !dropId || keepId === dropId) return parseSiteZones(zones);
  const list = parseSiteZones(zones);
  const keep = list.find((z) => z.id === keepId);
  const drop = list.find((z) => z.id === dropId);
  if (!keep || !drop) return list;
  const description = [keep.description, drop.description].filter(Boolean).join(" · ").slice(0, 400);
  return list
    .filter((z) => z.id !== dropId)
    .map((z) => (z.id === keepId ? { ...z, description } : z));
}

export function parseZoneCompletions(raw: unknown): ZoneCompletion[] {
  if (!Array.isArray(raw)) return [];
  const out: ZoneCompletion[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const name = asName(o.name);
    const status = o.status;
    if (!name || !isZoneStatus(status)) continue;
    out.push({
      zoneId: String(o.zoneId || o.id || "").trim() || newZoneId(),
      name,
      status,
      note: String(o.note || "").trim().slice(0, 500),
      by: o.by == null ? null : String(o.by),
      at: o.at == null ? null : String(o.at),
    });
  }
  return out;
}

export function zoneCompletionGate(
  zoneNames: string[],
  completions: ZoneCompletion[],
): { ok: boolean; missing: string[]; unmarked: string[] } {
  const names = zoneNames.map((n) => n.trim()).filter(Boolean);
  const byName = new Map(parseZoneCompletions(completions).map((c) => [c.name.toLowerCase(), c]));
  const missing: string[] = [];
  const unmarked: string[] = [];
  for (const name of names) {
    const row = byName.get(name.toLowerCase());
    if (!row) missing.push(name);
    else if (!isZoneStatus(row.status)) unmarked.push(name);
  }
  return { ok: missing.length === 0 && unmarked.length === 0, missing, unmarked };
}

export function incompleteZoneCompletions(completions: ZoneCompletion[]): ZoneCompletion[] {
  return parseZoneCompletions(completions).filter((c) => c.status === "partial" || c.status === "not_done");
}

export function zoneFollowUpNote(zone: ZoneCompletion): string {
  const label = zone.status === "partial" ? "partially finished" : "not done";
  const why = zone.note ? ` — ${zone.note}` : "";
  return `${zone.name} was ${label}${why}. Return on the next visit (or a scheduled follow-up) and finish this zone.`;
}

export function customerZoneIncompleteMessage(
  firstName: string | null | undefined,
  zones: ZoneCompletion[],
  nextVisit?: string | null,
): string {
  const name = String(firstName || "").trim() || "there";
  const incomplete = incompleteZoneCompletions(zones);
  if (incomplete.length === 0) return "";
  const list = incomplete.map((z) => z.name).join(", ");
  const next = nextVisit
    ? ` We'll pick this up on ${nextVisit}.`
    : " We'll finish it on the next scheduled visit.";
  const one = incomplete.length === 1;
  return (
    `Hi ${name}, it's NovaraCleaning — today's visit wrapped, but ${one ? "one area wasn't" : "some areas weren't"} ` +
    `finished: ${list}.${next} Sorry for the extra trip; we'll make it right.`
  );
}

export function photosForZone(
  sectionMeta: Record<string, { before?: string[]; after?: string[] }> | null | undefined,
  sections: Array<{ zoneName?: string | null }>,
  zoneName: string,
): { before: string[]; after: string[] } {
  const want = zoneName.trim().toLowerCase();
  const idx = sections.findIndex((s) => String(s.zoneName || "").trim().toLowerCase() === want);
  if (idx < 0) return { before: [], after: [] };
  const meta = (sectionMeta || {})[String(idx)] || {};
  return {
    before: Array.isArray(meta.before) ? meta.before.map(String).filter(Boolean) : [],
    after: Array.isArray(meta.after) ? meta.after.map(String).filter(Boolean) : [],
  };
}

export interface LabeledZonePhoto {
  zoneName: string;
  kind: "before" | "after";
  url: string;
  label: string;
}

/** Flatten section_meta into a labeled sequence — the dispute packet's per-zone photos. */
export function labeledZonePhotos(
  sectionMeta: Record<string, { before?: string[]; after?: string[] }> | null | undefined,
  sections: Array<{ zoneName?: string | null; title?: string }>,
  restrictTo?: string[] | null,
): LabeledZonePhoto[] {
  const want = (restrictTo || []).map((n) => n.trim().toLowerCase()).filter(Boolean);
  const out: LabeledZonePhoto[] = [];
  sections.forEach((section, idx) => {
    const name = String(section.zoneName || "").trim();
    if (!name) return;
    if (want.length && !want.includes(name.toLowerCase())) return;
    const meta = (sectionMeta || {})[String(idx)] || {};
    const before = Array.isArray(meta.before) ? meta.before.map(String).filter(Boolean) : [];
    const after = Array.isArray(meta.after) ? meta.after.map(String).filter(Boolean) : [];
    before.forEach((url, i) => {
      out.push({ zoneName: name, kind: "before", url, label: `${name} BEFORE ${i + 1}` });
    });
    after.forEach((url, i) => {
      out.push({ zoneName: name, kind: "after", url, label: `${name} AFTER ${i + 1}` });
    });
  });
  return out;
}

/** Resolve requested names against the site's standing map. Never invents labels. */
export function matchNamedZones(
  requested: unknown,
  siteNames: string[],
  fallbackName?: string | null,
): string[] {
  const names = siteNames.map((n) => n.trim()).filter(Boolean);
  const byLower = new Map(names.map((n) => [n.toLowerCase(), n]));
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (raw: string) => {
    const hit = byLower.get(raw.trim().toLowerCase());
    if (!hit || seen.has(hit.toLowerCase())) return;
    seen.add(hit.toLowerCase());
    out.push(hit);
  };
  if (Array.isArray(requested)) {
    for (const entry of requested) {
      if (typeof entry === "string" || typeof entry === "number") add(String(entry));
      else if (entry && typeof entry === "object") {
        const o = entry as Record<string, unknown>;
        add(String(o.name ?? o.zoneName ?? o.label ?? o.title ?? ""));
      }
    }
  } else if (typeof requested === "string") {
    add(requested);
  }
  if (out.length === 0 && fallbackName) add(fallbackName);
  return out;
}

/** Targeted reclean pay on a zoned site: fraction of the original charge, never $0. */
export function assessedZoneRecleanCents(
  originalChargeCents: number,
  zoneCount: number,
  siteZoneCount: number,
): number {
  const charge = Math.max(0, Math.round(Number(originalChargeCents) || 0));
  const n = Math.max(1, Math.round(Number(zoneCount) || 0) || 1);
  const total = Math.max(n, Math.round(Number(siteZoneCount) || 0) || n);
  if (charge > 0) return Math.max(1, Math.round(charge * (n / total)));
  return n * 7500;
}
