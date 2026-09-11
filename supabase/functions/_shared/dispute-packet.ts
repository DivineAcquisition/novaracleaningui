// Shared dispute-packet copy and types.
//
// Policy citations included here are the ones that belong in a card-network
// representment. Clauses that call a chargeback "fraud", assess a $150 fee,
// demand 72 hours before a cardholder may dispute, or invoke arbitration
// are intentionally omitted — issuers ignore them and they read as an
// attempt to contract around dispute rights.

export interface PolicyRef {
  claim: string;
  cite: string;
}

export const POLICY_URLS: Array<{ label: string; url: string }> = [
  { label: "Terms of Service", url: "https://novaracleaning.com/terms" },
  { label: "Refund Policy", url: "https://novaracleaning.com/refund-policy" },
  { label: "Cancellation Policy", url: "https://novaracleaning.com/cancellation-policy" },
  { label: "Disclaimer", url: "https://novaracleaning.com/disclaimer" },
  { label: "Standard Clean checklist", url: "https://try.novaracleaning.com/checklist/standard-clean" },
];

export const POLICY_REFS: PolicyRef[] = [
  {
    claim: "Acceptance is binding on booking: clicking agree, submitting a booking, providing payment, or granting property access constitutes acceptance of all policies.",
    cite: "Terms of Service §1.2, §1.4",
  },
  {
    claim: "The customer purchased professional labor performed to a documented checklist standard, not a guaranteed subjective outcome.",
    cite: "Refund Policy §1.3 · Terms of Service §6.4",
  },
  {
    claim: "The primary and default remedy for a legitimate quality concern is a complimentary re-clean of the reported areas — not a refund of the completed visit.",
    cite: "Terms of Service §7.1, §7.3 · Refund Policy §1.2, §2.1",
  },
  {
    claim: "Declining the complimentary re-clean without a documented valid reason (such as relocation) waives further refund eligibility under the Refund Policy.",
    cite: "Refund Policy §2.5",
  },
  {
    claim: "Concerns must be reported in writing within 24 hours of completion, with specific itemized areas. The merchant reviews that report against retained before/after photographs and the service checklist.",
    cite: "Terms of Service §7.1 · Refund Policy §3.1–3.3",
  },
  {
    claim: "Subjective dissatisfaction, buyer's remorse, and services performed to the applicable checklist standard are not refundable. A single missed punch-list item is cured by re-clean, not reversal of the full charge.",
    cite: "Terms of Service §6.4 · Refund Policy §5.1–5.2, §6",
  },
  {
    claim: "Tasks not included in the purchased package are not refundable events.",
    cite: "Refund Policy §5.7",
  },
  {
    claim: "The customer consented to timestamped before/after photographs, checklists, and communication logs being retained and used to resolve service concerns.",
    cite: "Terms of Service §13.1–13.4 · Refund Policy §3.3 · Disclaimer §8.4",
  },
];

export const POLICY_HIGHLIGHTS: string[] = POLICY_REFS.map((r) => `${r.claim} (${r.cite}).`);

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

export interface ChecklistDelivery {
  confirmation_email_sent: boolean;
  emails: Array<{ kind: string; sent_at: string | null; recipient_email?: string | null }>;
  checklist_url: string;
}

export interface PacketMessage {
  at: string;
  direction: "inbound" | "outbound" | "unknown";
  channel: string;
  body: string;
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
        const allowed: FindingRuling[] = ["completed", "missed", "out_of_scope", "unverified"];
        return {
          claim,
          evidence,
          ruling: allowed.includes(ruling) ? ruling : "unverified",
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
