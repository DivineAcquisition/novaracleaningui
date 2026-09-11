// Browser/Node copy of the bank-safe dispute-packet types.
// Keep in sync with supabase/functions/_shared/dispute-packet.ts.

export type FindingRuling = "completed" | "missed" | "out_of_scope" | "unverified";

export interface RepresentmentFinding {
  claim: string;
  ruling: FindingRuling;
  evidence: string;
}

export interface DisputeRepresentment {
  headline: string;
  findings: RepresentmentFinding[];
  remedy: string;
  updated_at?: string;
  updated_by?: string;
}

export const FINDING_RULINGS: FindingRuling[] = [
  "completed",
  "missed",
  "out_of_scope",
  "unverified",
];

export function wrapPacketText(text: string, width = 98): string[] {
  const out: string[] = [];
  for (const rawLine of String(text || "").split(/\n+/)) {
    const words = rawLine.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > width && cur) {
        out.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) out.push(cur);
  }
  return out;
}

export function parseRepresentment(raw: unknown): DisputeRepresentment | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const headline = String(r.headline || "").trim();
  const remedy = String(r.remedy || "").trim();
  const findings = Array.isArray(r.findings)
    ? r.findings
      .map((f) => {
        if (!f || typeof f !== "object") return null;
        const row = f as Record<string, unknown>;
        const claim = String(row.claim || "").trim();
        const evidence = String(row.evidence || "").trim();
        const ruling = String(row.ruling || "unverified") as FindingRuling;
        if (!claim) return null;
        return {
          claim,
          evidence,
          ruling: FINDING_RULINGS.includes(ruling) ? ruling : "unverified",
        } satisfies RepresentmentFinding;
      })
      .filter((f): f is RepresentmentFinding => f !== null)
    : [];
  if (!headline && !remedy && findings.length === 0) return null;
  return {
    headline,
    findings,
    remedy,
    updated_at: r.updated_at ? String(r.updated_at) : undefined,
    updated_by: r.updated_by ? String(r.updated_by) : undefined,
  };
}
