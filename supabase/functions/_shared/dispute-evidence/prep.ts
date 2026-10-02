// Prepared evidence is filed when the facts happen. A dispute pulls those
// frozen pieces, checks their fingerprints, and only rebuilds the pieces
// that change (communication and other evidence).

import { buildDisputeEvidence, NOT_RECORDED, type DisputeBuildInput, type EvidenceMessage, type PacketDoc } from "./build.ts";
import { lineBudget, STRIPE_EVIDENCE_LIMITS } from "./limits.ts";

export type PieceKind = "acceptance" | "policy" | "receipt" | "completion" | "communication" | "other";

export interface FrozenPiece {
  id: string;
  clientKey: string;
  bookingId: string | null;
  chargeKey: string | null;
  kind: PieceKind;
  seriesId: string;
  version: number;
  eventId: string;
  reason: string;
  fingerprint: string;
  generatedAt: string;
  backfill: boolean;
  superseded: boolean;
  lines: string[];
  gaps: string[];
}

export interface PrepRequest {
  clientKey: string;
  bookingId: string | null;
  chargeKey: string | null;
  kind: PieceKind;
  seriesId: string;
  eventId: string;
  lines: string[];
  now: string;
  backfill: boolean;
  correctionReason?: string | null;
  gaps?: string[];
}

export function fingerprintPiece(kind: PieceKind, lines: string[]): string {
  const text = `${kind}\n${lines.join("\n")}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${(hash >>> 0).toString(16).padStart(8, "0")}:${text.length}`;
}

function sameSlot(a: FrozenPiece, req: PrepRequest): boolean {
  return a.clientKey === req.clientKey
    && a.bookingId === req.bookingId
    && a.chargeKey === req.chargeKey
    && a.kind === req.kind
    && a.seriesId === req.seriesId;
}

export function preparePiece(existing: FrozenPiece[], req: PrepRequest): {
  pieces: FrozenPiece[];
  created: FrozenPiece | null;
  duplicate: boolean;
  rejected?: string;
} {
  if (existing.some((piece) => piece.eventId === req.eventId)) {
    return { pieces: existing, created: null, duplicate: true };
  }
  const fingerprint = fingerprintPiece(req.kind, req.lines);
  const current = existing
    .filter((piece) => sameSlot(piece, req) && !piece.superseded)
    .sort((a, b) => b.version - a.version)[0];
  if (current && current.fingerprint === fingerprint) {
    return { pieces: existing, created: null, duplicate: true };
  }
  if (current && !req.correctionReason) {
    return {
      pieces: existing,
      created: null,
      duplicate: false,
      rejected: "This piece is frozen. A correction needs a reason and creates a new version.",
    };
  }
  const created: FrozenPiece = {
    id: `${req.eventId}:v${current ? current.version + 1 : 1}`,
    clientKey: req.clientKey,
    bookingId: req.bookingId,
    chargeKey: req.chargeKey,
    kind: req.kind,
    seriesId: req.seriesId,
    version: current ? current.version + 1 : 1,
    eventId: req.eventId,
    reason: req.correctionReason || (req.backfill ? "prepared from existing records" : "prepared when the fact was recorded"),
    fingerprint,
    generatedAt: req.now,
    backfill: req.backfill,
    superseded: false,
    lines: req.backfill
      ? [`Prepared from existing records on ${req.now.slice(0, 10)}.`, ...req.lines]
      : req.lines,
    gaps: req.gaps || [],
  };
  if (req.backfill) created.fingerprint = fingerprintPiece(created.kind, created.lines);
  const pieces = existing.map((piece) => sameSlot(piece, req) && !piece.superseded
    ? { ...piece, superseded: true }
    : piece);
  pieces.push(created);
  return { pieces, created, duplicate: false };
}

export type Readiness = "ready" | "ready_with_gaps" | "not_ready";

const CORE: PieceKind[] = ["acceptance", "policy", "receipt", "completion"];

export function chargeReadiness(pieces: FrozenPiece[], chargeKey: string): {
  status: Readiness;
  prepared: Array<{ kind: PieceKind; generatedAt: string }>;
  gaps: string[];
} {
  const current = pieces.filter((piece) => piece.chargeKey === chargeKey && !piece.superseded);
  const prepared = CORE.flatMap((kind) => {
    const piece = current.find((row) => row.kind === kind);
    return piece ? [{ kind, generatedAt: piece.generatedAt }] : [];
  });
  const missing = CORE.filter((kind) => !prepared.some((row) => row.kind === kind));
  const gaps = [
    ...missing.map((kind) => `${kind} was never prepared`),
    ...current.filter((piece) => CORE.includes(piece.kind)).flatMap((piece) => piece.gaps),
  ];
  if (missing.length) return { status: "not_ready", prepared, gaps };
  if (gaps.length) return { status: "ready_with_gaps", prepared, gaps };
  return { status: "ready", prepared, gaps: [] };
}

export function readinessShare(rows: Array<{ status: Readiness }>): { ready: number; shareReady: number } {
  const ready = rows.filter((row) => row.status === "ready").length;
  return { ready, shareReady: rows.length ? ready / rows.length : 0 };
}

export interface OtherItem {
  priority: number;
  source: string;
  at: string;
  text: string;
}

export function otherEvidenceLines(items: OtherItem[], capLines: number): { lines: string[]; omitted: number } | null {
  const ranked = [...items].filter((item) => item.text.trim()).sort((a, b) => b.priority - a.priority);
  if (!ranked.length) return null;
  const lines = ["Index: items below are not repeated from the other packets."];
  let used = 2;
  let kept = 0;
  for (const item of ranked) {
    const block = ["", `${item.at}  source ${item.source}`, item.text];
    const cost = block.length;
    if (used + cost > capLines) continue;
    lines.push(...block);
    used += cost;
    kept++;
  }
  const omitted = ranked.length - kept;
  if (omitted) lines.push("", `${omitted} lower-priority items were left out of Other Evidence because of the page cap.`);
  return { lines, omitted };
}

export function linesForPrep(kind: PieceKind, input: DisputeBuildInput): { lines: string[]; gaps: string[] } {
  if (kind === "receipt") {
    const charges = input.charges || [];
    return {
      lines: charges.length
        ? charges.map((charge) => `${charge.label}: ${charge.amountCents == null ? NOT_RECORDED : `$${(charge.amountCents / 100).toFixed(2)}`} ${charge.paymentIntentId || NOT_RECORDED}`)
        : [NOT_RECORDED],
      gaps: charges.length ? [] : ["receipt was never prepared"],
    };
  }
  const set = buildDisputeEvidence(input);
  const gaps: string[] = [];
  if (kind === "acceptance") {
    if (!input.acceptance?.ip?.trim()) gaps.push("signature has no IP recorded (older record)");
    if (!input.acceptance?.signedAt?.trim()) gaps.push("signature timestamp not recorded");
  }
  if (kind === "completion" && !(input.photos || []).length) gaps.push("completion photos missing");
  const packet = set.packets.find((row) => {
    if (kind === "acceptance") return row.id === "acceptance";
    if (kind === "policy") return row.id === "policy";
    if (kind === "receipt") return row.id === "receipt";
    if (kind === "completion") return row.id === "completion";
    if (kind === "communication") return row.id === "communication";
    return row.id === "other";
  });
  return { lines: packet?.lines || [NOT_RECORDED], gaps };
}

export function verifyFingerprint(piece: FrozenPiece): boolean {
  return fingerprintPiece(piece.kind, piece.lines) === piece.fingerprint;
}

export function assembleFromPrepared(opts: {
  pieces: FrozenPiece[];
  chargeKey: string;
  input: DisputeBuildInput;
  now: string;
}): {
  packets: PacketDoc[];
  fingerprintMismatches: string[];
  builtAtDisputeTime: PieceKind[];
  warnings: string[];
} {
  const fresh = buildDisputeEvidence({ ...opts.input, now: opts.now });
  const mismatches: string[] = [];
  const built: PieceKind[] = [];
  const warnings = [...fresh.warnings];
  const current = opts.pieces.filter((piece) => piece.chargeKey === opts.chargeKey && !piece.superseded);

  const useFrozen = (kind: PieceKind, fallbackId: PacketDoc["id"], field: string, title: string, cap: number): PacketDoc => {
    const piece = current.find((row) => row.kind === kind);
    if (!piece) {
      built.push(kind);
      const fallback = fresh.packets.find((packet) => packet.id === fallbackId);
      const lines = [`Built at dispute time on ${opts.now.slice(0, 10)}.`, ...(fallback?.lines || [NOT_RECORDED])];
      return {
        id: fallbackId,
        filename: fallback?.filename || `${kind}-${opts.input.disputeId}.pdf`,
        stripeField: fallback?.stripeField || field,
        title,
        lines,
        pageCap: cap,
        trimmed: false,
        warnings: [`${kind} was not prepared ahead of the dispute.`],
      };
    }
    if (!verifyFingerprint(piece)) mismatches.push(`${kind} fingerprint does not match the stored file.`);
    return {
      id: fallbackId,
      filename: fresh.packets.find((packet) => packet.id === fallbackId)?.filename || `${kind}-${opts.input.disputeId}.pdf`,
      stripeField: field,
      title,
      lines: piece.lines,
      pageCap: cap,
      trimmed: false,
      warnings: [],
    };
  };

  const limits = STRIPE_EVIDENCE_LIMITS.packetPages;
  const packets: PacketDoc[] = [
    useFrozen("completion", "completion", "service_documentation", "Completion summary", limits.service_documentation),
    fresh.packets.find((packet) => packet.id === "communication")!,
    useFrozen("acceptance", "acceptance", "customer_signature", "Acceptance record", limits.customer_signature),
  ];
  const policy = fresh.packets.find((packet) => packet.id === "policy");
  if (policy) {
    const frozenPolicy = current.find((row) => row.kind === "policy");
    if (frozenPolicy) {
      if (!verifyFingerprint(frozenPolicy)) mismatches.push("policy fingerprint does not match the stored file.");
      packets.push({ ...policy, lines: frozenPolicy.lines });
    } else {
      built.push("policy");
      packets.push({ ...policy, lines: [`Built at dispute time on ${opts.now.slice(0, 10)}.`, ...policy.lines] });
    }
  }
  const receipt = fresh.packets.find((packet) => packet.id === "receipt");
  if (receipt) {
    const frozenReceipt = current.find((row) => row.kind === "receipt");
    packets.push(frozenReceipt
      ? { ...receipt, lines: frozenReceipt.lines }
      : { ...receipt, lines: [`Built at dispute time on ${opts.now.slice(0, 10)}.`, ...receipt.lines] });
    if (!frozenReceipt) built.push("receipt");
    if (frozenReceipt && !verifyFingerprint(frozenReceipt)) mismatches.push("receipt fingerprint does not match the stored file.");
  }

  const otherCap = lineBudget(limits.uncategorized_file);
  const other = otherEvidenceLines(opts.input.otherItems || [], otherCap);
  if (other) {
    packets.push({
      id: "other",
      filename: `uncategorized-file-${opts.input.disputeId}.pdf`,
      stripeField: "uncategorized_file",
      title: "Other evidence",
      lines: other.lines,
      pageCap: limits.uncategorized_file,
      trimmed: other.omitted > 0,
      warnings: [],
    });
  }

  return { packets, fingerprintMismatches: mismatches, builtAtDisputeTime: built, warnings };
}

