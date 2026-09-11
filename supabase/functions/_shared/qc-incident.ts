// Serious-allegation QC helpers.
//
// Opening a case is evidence assembly, not a finding. Timeline construction
// lists recorded events and names gaps explicitly — it never infers what
// happened in an unrecorded period.

export const SERIOUS_ALLEGATION_TYPE = "serious_allegation";
export const SERIOUS_ALLEGATION_STATUS = "investigating";
export const SERIOUS_STATUS_LABEL = "Open — Under Investigation";

export const SUSPENSION_FLAGS = ["none", "pending_admin", "suspended", "cleared"] as const;
export type SuspensionFlag = (typeof SUSPENSION_FLAGS)[number];

export interface TimelineEventInput {
  at: string | null | undefined;
  source: string;
  label: string;
  raw?: unknown;
}

export interface TimelineEntry {
  at: string | null;
  source: string;
  label: string;
  kind: "event" | "gap" | "absent_record";
  gap_from?: string | null;
  gap_to?: string | null;
  raw?: unknown;
}

export interface ChecklistItemState {
  key: string;
  label: string;
  state: "completed" | "skipped" | "not_marked";
  skip_reason: string | null;
  at: string | null;
  by: string | null;
}

const DEFAULT_GAP_MS = 15 * 60 * 1000;

export function isSeriousAllegation(issueType: string | null | undefined): boolean {
  return String(issueType || "") === SERIOUS_ALLEGATION_TYPE;
}

export function qcStatusLabel(issueType: string | null | undefined, status: string | null | undefined): string {
  const s = String(status || "");
  if (isSeriousAllegation(issueType) && (s === "investigating" || s === "open")) {
    return SERIOUS_STATUS_LABEL;
  }
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Incident-day bounds in America/New_York for a YYYY-MM-DD service date. */
export function incidentDayBounds(serviceDate: string | null | undefined): { start: Date; end: Date } | null {
  const day = String(serviceDate || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  // Noon UTC on that calendar date, then walk to ET midnight via the offset
  // at noon (avoids DST edge cases of constructing ET midnight directly).
  const noonUtc = new Date(`${day}T16:00:00.000Z`);
  if (Number.isNaN(noonUtc.getTime())) return null;
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(noonUtc);
  const grab = (t: string) => etParts.find((p) => p.type === t)?.value || "";
  // Re-derive offset: format noonUtc in ET, parse as if UTC, compare.
  const asEt = Date.parse(
    `${grab("year")}-${grab("month")}-${grab("day")}T${grab("hour")}:${grab("minute")}:${grab("second")}Z`,
  );
  const offsetMs = asEt - noonUtc.getTime();
  const startUtcGuess = Date.parse(`${day}T00:00:00.000Z`) - offsetMs;
  const start = new Date(startUtcGuess);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  return { start, end };
}

function ts(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = Date.parse(String(iso));
  return Number.isFinite(n) ? n : null;
}

/**
 * Chronological incident-day timeline. Gaps longer than `gapMs` between
 * recorded events are inserted as explicit `gap` rows. Expected records that
 * were never written are listed as `absent_record` (no inferred timestamp).
 */
export function buildIncidentDayTimeline(opts: {
  serviceDate: string | null | undefined;
  events: TimelineEventInput[];
  absentRecords?: Array<{ source: string; label: string }>;
  gapMs?: number;
  now?: Date;
}): TimelineEntry[] {
  const bounds = incidentDayBounds(opts.serviceDate);
  const gapMs = opts.gapMs ?? DEFAULT_GAP_MS;
  const now = opts.now || new Date();

  const dated: Array<TimelineEventInput & { n: number }> = [];
  const undated: TimelineEntry[] = [];
  for (const e of opts.events || []) {
    const n = ts(e.at);
    if (n == null) {
      undated.push({
        at: null,
        source: e.source,
        label: `${e.label} (original timestamp not stored)`,
        kind: "absent_record",
        raw: e.raw,
      });
      continue;
    }
    if (bounds && (n < bounds.start.getTime() || n > bounds.end.getTime())) continue;
    dated.push({ ...e, n });
  }
  dated.sort((a, b) => a.n - b.n);

  const out: TimelineEntry[] = [];
  const startMs = bounds ? bounds.start.getTime() : dated[0]?.n;
  const endCap = bounds
    ? Math.min(bounds.end.getTime(), now.getTime())
    : now.getTime();

  if (bounds && dated.length === 0) {
    out.push({
      at: null,
      source: "systems",
      label: `No timestamped records on file for ${opts.serviceDate} (America/New_York).`,
      kind: "gap",
      gap_from: bounds.start.toISOString(),
      gap_to: new Date(endCap).toISOString(),
    });
  } else if (startMs != null && dated.length > 0) {
    if (dated[0].n - startMs > gapMs) {
      out.push({
        at: null,
        source: "systems",
        label: "No record in our systems for this period.",
        kind: "gap",
        gap_from: new Date(startMs).toISOString(),
        gap_to: new Date(dated[0].n).toISOString(),
      });
    }
    for (let i = 0; i < dated.length; i++) {
      const e = dated[i];
      out.push({
        at: new Date(e.n).toISOString(),
        source: e.source,
        label: e.label,
        kind: "event",
        raw: e.raw,
      });
      const next = dated[i + 1];
      const to = next ? next.n : endCap;
      if (to - e.n > gapMs) {
        out.push({
          at: null,
          source: "systems",
          label: "No record in our systems for this period.",
          kind: "gap",
          gap_from: new Date(e.n).toISOString(),
          gap_to: new Date(to).toISOString(),
        });
      }
    }
  }

  for (const a of opts.absentRecords || []) {
    out.push({
      at: null,
      source: a.source,
      label: a.label,
      kind: "absent_record",
    });
  }
  for (const u of undated) out.push(u);
  return out;
}

type ItemEntry = {
  done?: boolean;
  skipped?: boolean;
  skipReason?: string;
  at?: string;
  by?: string;
};

export function flattenChecklistItems(
  items: unknown,
  sections: Array<{ title?: string; items?: string[] }> | null | undefined,
): ChecklistItemState[] {
  const map = items && typeof items === "object" && !Array.isArray(items)
    ? items as Record<string, ItemEntry>
    : {};
  const out: ChecklistItemState[] = [];
  const secs = Array.isArray(sections) && sections.length
    ? sections
    : inferSectionsFromKeys(map);
  for (let s = 0; s < secs.length; s++) {
    const labels = Array.isArray(secs[s].items) ? secs[s].items as string[] : [];
    for (let i = 0; i < labels.length; i++) {
      const key = `${s}:${i}`;
      const entry = map[key] || {};
      const skipped = Boolean(entry.skipped && String(entry.skipReason || "").trim());
      const completed = Boolean(entry.done && !entry.skipped);
      out.push({
        key,
        label: `${secs[s].title ? `${secs[s].title}: ` : ""}${labels[i]}`,
        state: skipped ? "skipped" : completed ? "completed" : "not_marked",
        skip_reason: skipped ? String(entry.skipReason) : null,
        at: entry.at ? String(entry.at) : null,
        by: entry.by ? String(entry.by) : null,
      });
    }
  }
  return out;
}

function inferSectionsFromKeys(map: Record<string, ItemEntry>): Array<{ title: string; items: string[] }> {
  let maxS = -1;
  const maxI: Record<number, number> = {};
  for (const key of Object.keys(map)) {
    const m = key.match(/^(\d+):(\d+)$/);
    if (!m) continue;
    const s = Number(m[1]);
    const i = Number(m[2]);
    maxS = Math.max(maxS, s);
    maxI[s] = Math.max(maxI[s] || 0, i);
  }
  const sections: Array<{ title: string; items: string[] }> = [];
  for (let s = 0; s <= maxS; s++) {
    const count = (maxI[s] ?? -1) + 1;
    sections.push({
      title: `Section ${s + 1}`,
      items: Array.from({ length: count }, (_, i) => map[`${s}:${i}`] ? `Item ${i + 1}` : `Item ${i + 1}`),
    });
  }
  return sections;
}

export function last10Digits(phone: string | null | undefined): string | null {
  const d = String(phone || "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.slice(-10);
}

export function phonesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = last10Digits(a);
  const y = last10Digits(b);
  return Boolean(x && y && x === y);
}

/** Interpret a stored arrival window against the service date. Not an inferred event. */
export function scheduledWindowStartIso(
  serviceDate: string | null | undefined,
  window: string | null | undefined,
): string | null {
  const bounds = incidentDayBounds(serviceDate);
  if (!bounds) return null;
  const m = String(window || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return null;
  let hour = Number(m[1]);
  const min = Number(m[2]);
  const ap = (m[3] || "").toUpperCase();
  if (ap === "PM" && hour < 12) hour += 12;
  if (ap === "AM" && hour === 12) hour = 0;
  if (!ap && hour > 23) return null;
  return new Date(bounds.start.getTime() + hour * 3600_000 + min * 60_000).toISOString();
}
