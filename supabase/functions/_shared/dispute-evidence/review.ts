// Dispute-time review, lost-dispute tags, the weekly report, and the
// withdrawal draft. The draft is never sent by this module.

import type { DisputeEvidenceSet } from "./build.ts";
import { packetOrder } from "./build.ts";

export const LOSS_CAUSES = [
  "reason_code_not_answered",
  "evidence_not_tied_to_customer",
  "photos_unreadable",
  "authorization_evidence_missing",
  "evidence_missing_or_late",
  "other",
] as const;

export type LossCause = (typeof LOSS_CAUSES)[number];

const LEAD_NAME: Record<string, string> = {
  completion: "Completion Summary",
  communication: "Customer communication",
  acceptance: "Acceptance Record",
  policy: "Refund and cancellation policy",
  receipt: "Receipt and charge breakdown",
  other: "Other evidence",
};

export function validateLossReview(cause: string, note: string): { ok: true; cause: LossCause } | { ok: false; error: string } {
  const match = LOSS_CAUSES.find((item) => item === cause);
  if (!match) return { ok: false, error: "Choose a loss cause." };
  if (!note.trim()) return { ok: false, error: "A note is required." };
  return { ok: true, cause: match };
}

export interface ReviewCheck {
  id: string;
  ok: boolean;
  label: string;
}

export function reviewChecklist(
  set: DisputeEvidenceSet,
  budget?: { ok: boolean; errors?: string[] },
): { ok: boolean; items: ReviewCheck[] } {
  const leadId = packetOrder(set.reason).find((id) => set.packets.some((packet) => packet.id === id));
  const leadName = LEAD_NAME[leadId || ""] || "the lead packet";
  const narrative = set.narrative || "";
  const sentences = narrative.split(/(?<=\.)\s+/).slice(0, 2).join(" ");
  const items: ReviewCheck[] = [
    {
      id: "lead_answers_reason",
      ok: sentences.includes(leadName),
      label: `The first two sentences answer the dispute reason and name ${leadName}.`,
    },
    {
      id: "pages_identified",
      ok: set.packets.every((packet) => {
        const id = packet.identity;
        return Boolean(id?.customerName && id.serviceDate && id.recordId && id.chargeAmount && id.packetName);
      }),
      label: "Every packet carries the customer name, service date, job or charge id, and charge amount.",
    },
    {
      id: "photos_readable",
      ok: !set.warnings.some((warning) => /shrunk|thumbnail/i.test(warning)),
      label: "Included photos meet the minimum readable size. Extra photos are dropped, not shrunk.",
    },
    {
      id: "budget",
      ok: budget ? budget.ok : true,
      label: "Pages, file size, and text fit the Stripe budget, with one file per evidence type.",
    },
  ];
  return { ok: items.every((item) => item.ok), items };
}

export interface DisputeOutcomeRow {
  reason?: string | null;
  outcome?: string | null;
  lossCause?: string | null;
  readyAtArrival?: boolean | null;
}

export function weeklyDisputeReport(rows: DisputeOutcomeRow[]): {
  decided: number;
  winRate: number;
  byReason: Record<string, { won: number; lost: number }>;
  byCause: Record<string, number>;
  shareReadyAtArrival: number;
} {
  const decided = rows.filter((row) => row.outcome === "won" || row.outcome === "lost");
  const won = decided.filter((row) => row.outcome === "won").length;
  const byReason: Record<string, { won: number; lost: number }> = {};
  for (const row of decided) {
    const key = row.reason?.trim() || "not recorded";
    const bucket = byReason[key] || { won: 0, lost: 0 };
    if (row.outcome === "won") bucket.won++;
    else bucket.lost++;
    byReason[key] = bucket;
  }
  const byCause: Record<string, number> = {};
  for (const row of rows.filter((item) => item.outcome === "lost")) {
    const key = row.lossCause?.trim() || "untagged";
    byCause[key] = (byCause[key] || 0) + 1;
  }
  const arrived = rows.filter((row) => row.readyAtArrival != null);
  const ready = arrived.filter((row) => row.readyAtArrival).length;
  return {
    decided: decided.length,
    winRate: decided.length ? won / decided.length : 0,
    byReason,
    byCause,
    shareReadyAtArrival: arrived.length ? ready / arrived.length : 0,
  };
}

export function withdrawalDraft(input: {
  customerName?: string | null;
  serviceDocumented: boolean;
  relationshipIntact: boolean;
  serviceDate?: string | null;
  serviceAddress?: string | null;
}): { draft: string; sentAutomatically: false } | null {
  if (!input.serviceDocumented || !input.relationshipIntact) return null;
  const name = input.customerName?.trim() || "there";
  const where = input.serviceAddress?.trim() || "the service address on the booking";
  const when = input.serviceDate?.trim() || "the service date on the booking";
  return {
    sentAutomatically: false,
    draft: [
      `Hello ${name},`,
      "",
      `Our records show the cleaning at ${where} on ${when} was completed. If this dispute was opened by mistake, your card issuer can withdraw it. You do not need to reply if you would rather leave the dispute as it is.`,
      "",
      "A person sends this note. It is not sent automatically.",
    ].join("\n"),
  };
}

export function withinLookback(iso: string | null | undefined, nowIso: string, lookbackDays: number): boolean {
  if (!iso) return false;
  const then = Date.parse(iso);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return false;
  return now - then <= lookbackDays * 24 * 60 * 60 * 1000 && then <= now;
}
