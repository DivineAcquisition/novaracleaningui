// Prepared evidence is filed when the facts happen. A dispute pulls those
// frozen pieces, checks their fingerprints, and only rebuilds the pieces
// that change (communication and other evidence).

import {
  buildDisputeEvidence,
  identityFromInput,
  NOT_RECORDED,
  packetOrder,
  receiptPacketLines,
  type DisputeBuildInput,
  type PacketDoc,
  type PageIdentity,
} from "./build.ts";
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
  identity?: PageIdentity | null;
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
  identity?: PageIdentity | null;
}

export function fingerprintPiece(kind: PieceKind, lines: string[], identity?: PageIdentity | null): string {
  const id = identity
    ? `${identity.customerName}|${identity.serviceDate}|${identity.recordId}|${identity.chargeAmount}|${identity.packetName}\n`
    : "";
  const text = `${kind}\n${id}${lines.join("\n")}`;
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
  const fingerprint = fingerprintPiece(req.kind, req.lines, req.identity);
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
    identity: req.identity || null,
  };
  if (req.backfill) created.fingerprint = fingerprintPiece(created.kind, created.lines, created.identity);
  const pieces = existing.map((piece) => sameSlot(piece, req) && !piece.superseded
    ? { ...piece, superseded: true }
    : piece);
  pieces.push(created);
  return { pieces, created, duplicate: false };
}

export type Readiness = "ready" | "ready_with_gaps" | "not_ready";

const CORE: PieceKind[] = ["acceptance", "policy", "receipt", "completion"];

function pieceForCharge(pieces: FrozenPiece[], kind: PieceKind, chargeKey: string, bookingId?: string | null): FrozenPiece | undefined {
  const active = pieces.filter((piece) => !piece.superseded && piece.kind === kind);
  return active.find((piece) => piece.chargeKey === chargeKey)
    || (bookingId ? active.find((piece) => piece.bookingId === bookingId) : undefined)
    || active.find((piece) => piece.chargeKey == null && (kind === "acceptance" || kind === "policy"));
}

export function chargeReadiness(pieces: FrozenPiece[], chargeKey: string, bookingId?: string | null): {
  status: Readiness;
  prepared: Array<{ kind: PieceKind; generatedAt: string }>;
  gaps: string[];
} {
  const current = CORE.flatMap((kind) => {
    const piece = pieceForCharge(pieces, kind, chargeKey, bookingId);
    return piece ? [piece] : [];
  });
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
      lines: receiptPacketLines(input),
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
  return fingerprintPiece(piece.kind, piece.lines, piece.identity) === piece.fingerprint;
}

export function assembleFromPrepared(opts: {
  pieces: FrozenPiece[];
  chargeKey: string;
  bookingId?: string | null;
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
  const pieceFor = (kind: PieceKind) => pieceForCharge(opts.pieces, kind, opts.chargeKey, opts.bookingId);

  const useFrozen = (kind: PieceKind, fallbackId: PacketDoc["id"], field: string, title: string, cap: number): PacketDoc => {
    const piece = pieceFor(kind);
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
        identity: fallback?.identity || identityFromInput(opts.input, title),
        images: fallback?.images,
        photoMinHeight: fallback?.photoMinHeight || STRIPE_EVIDENCE_LIMITS.minPhotoHeightPt,
        photoMinWidth: fallback?.photoMinWidth || STRIPE_EVIDENCE_LIMITS.minPhotoWidthPt,
        photoMaxHeight: fallback?.photoMaxHeight || STRIPE_EVIDENCE_LIMITS.photoMaxHeightPt,
      };
    }
    if (!verifyFingerprint(piece)) mismatches.push(`${kind} fingerprint does not match the stored file.`);
    const freshPacket = fresh.packets.find((packet) => packet.id === fallbackId);
    return {
      id: fallbackId,
      filename: freshPacket?.filename || `${kind}-${opts.input.disputeId}.pdf`,
      stripeField: freshPacket?.stripeField || field,
      title,
      lines: piece.lines,
      pageCap: cap,
      trimmed: false,
      warnings: piece.identity ? [] : [`${kind} was prepared before the identification strip was stored. The strip uses the dispute record.`],
      identity: piece.identity || freshPacket?.identity || identityFromInput(opts.input, title),
      images: freshPacket?.images,
      photoMinHeight: freshPacket?.photoMinHeight || STRIPE_EVIDENCE_LIMITS.minPhotoHeightPt,
      photoMinWidth: freshPacket?.photoMinWidth || STRIPE_EVIDENCE_LIMITS.minPhotoWidthPt,
      photoMaxHeight: freshPacket?.photoMaxHeight || STRIPE_EVIDENCE_LIMITS.photoMaxHeightPt,
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
    const frozenPolicy = pieceFor("policy");
    if (frozenPolicy) {
      if (!verifyFingerprint(frozenPolicy)) mismatches.push("policy fingerprint does not match the stored file.");
      packets.push({ ...policy, lines: frozenPolicy.lines, identity: frozenPolicy.identity || policy.identity });
    } else {
      built.push("policy");
      packets.push({ ...policy, lines: [`Built at dispute time on ${opts.now.slice(0, 10)}.`, ...policy.lines] });
    }
  }
  const freshReceipt = fresh.packets.find((packet) => packet.id === "receipt");
  const frozenReceipt = pieceFor("receipt");
  if (freshReceipt || frozenReceipt) {
    if (frozenReceipt && !verifyFingerprint(frozenReceipt)) mismatches.push("receipt fingerprint does not match the stored file.");
    if (!frozenReceipt) built.push("receipt");
    const base = freshReceipt || {
      id: "receipt" as const,
      filename: `receipt-${opts.input.disputeId}.pdf`,
      stripeField: "receipt",
      title: "Receipt and charge breakdown",
      lines: [],
      pageCap: limits.receipt,
      trimmed: false,
      warnings: [],
      identity: identityFromInput(opts.input, "Receipt and charge breakdown"),
      photoMinHeight: STRIPE_EVIDENCE_LIMITS.minPhotoHeightPt,
      photoMinWidth: STRIPE_EVIDENCE_LIMITS.minPhotoWidthPt,
      photoMaxHeight: STRIPE_EVIDENCE_LIMITS.photoMaxHeightPt,
    };
    packets.push(frozenReceipt
      ? { ...base, lines: frozenReceipt.lines, identity: frozenReceipt.identity || base.identity }
      : { ...base, lines: [`Built at dispute time on ${opts.now.slice(0, 10)}.`, ...(freshReceipt?.lines || [NOT_RECORDED])] });
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
      identity: identityFromInput(opts.input, "Other evidence"),
      photoMinHeight: STRIPE_EVIDENCE_LIMITS.minPhotoHeightPt,
      photoMinWidth: STRIPE_EVIDENCE_LIMITS.minPhotoWidthPt,
      photoMaxHeight: STRIPE_EVIDENCE_LIMITS.photoMaxHeightPt,
    });
  }

  const order = packetOrder(opts.input.reason);
  packets.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  return { packets, fingerprintMismatches: mismatches, builtAtDisputeTime: built, warnings };
}

