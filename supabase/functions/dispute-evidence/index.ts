// Dispute evidence set: build, stage, and submit once.
// Admin/VA JWT or the service role. Drafts are not submitted.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { buildDisputeEvidence, identityFromInput, narrativeHasForbidden, policyFieldFor, type DisputeBuildInput } from "../_shared/dispute-evidence/build.ts";
import { assembleFromPrepared, chargeReadiness, linesForPrep, preparePiece, readinessShare, type FrozenPiece, type PieceKind } from "../_shared/dispute-evidence/prep.ts";
import { STRIPE_EVIDENCE_LIMITS } from "../_shared/dispute-evidence/limits.ts";
import { previewPages, renderEvidenceSet, validateRendered } from "../_shared/dispute-evidence/render.ts";
import { reviewChecklist, validateLossReview, weeklyDisputeReport, withdrawalDraft } from "../_shared/dispute-evidence/review.ts";
import { stageDisputeEvidence, submitDisputeEvidence } from "../_shared/dispute-evidence/submit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// deno-lint-ignore no-explicit-any
type SB = any;

async function allow(admin: SB, jwt: string): Promise<void> {
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (service && jwt === service) return;
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const ok = (roles || []).some((r: { role: string }) => r.role === "admin" || r.role === "va");
  if (!ok) throw new Error("Admins or VAs only.");
}

function pieceFromRow(row: Record<string, unknown>): FrozenPiece {
  return {
    id: String(row.id),
    clientKey: String(row.client_key),
    bookingId: row.booking_id ? String(row.booking_id) : null,
    chargeKey: row.charge_key ? String(row.charge_key) : null,
    kind: row.kind as PieceKind,
    seriesId: String(row.series_id),
    version: Number(row.version),
    eventId: String(row.event_id),
    reason: String(row.reason),
    fingerprint: String(row.fingerprint),
    generatedAt: String(row.generated_at),
    backfill: Boolean(row.backfill),
    superseded: Boolean(row.superseded),
    lines: (row.lines as string[]) || [],
    gaps: (row.gaps as string[]) || [],
    identity: (row.identity as FrozenPiece["identity"]) || null,
  };
}

function optionalPacket(id: string, reason: string, messages: DisputeBuildInput["messages"]): boolean {
  if (id === "other") return true;
  if (id === "receipt" && reason.toLowerCase() !== "duplicate") return true;
  if (id === "policy" && !policyFieldFor(reason, messages || [])) return true;
  return false;
}

function stripeClient(key: string) {
  return {
    async uploadFile(filename: string, bytes: Uint8Array) {
      const form = new FormData();
      form.set("purpose", "dispute_evidence");
      form.set("file", new Blob([bytes], { type: "application/pdf" }), filename);
      const res = await fetch("https://files.stripe.com/v1/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || `Stripe file upload ${res.status}`);
      return { id: String(body.id) };
    },
    async updateDispute(disputeId: string, fields: Record<string, string>, submit: boolean) {
      const form = new URLSearchParams();
      for (const [k, v] of Object.entries(fields)) form.set(k, v);
      if (submit) form.set("submit", "true");
      const res = await fetch(`https://api.stripe.com/v1/disputes/${encodeURIComponent(disputeId)}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error?.message || `Stripe dispute update ${res.status}`);
      return { id: String(body.id), status: body.status };
    },
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "Not signed in." }, 401);
    await allow(admin, jwt);
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "preview");
    const input = body.input as DisputeBuildInput | undefined;

    if (action === "readiness") {
      const bookingId = String(body.bookingId || "");
      const chargeKey = String(body.chargeKey || "");
      const { data, error } = await admin.from("client_evidence_pieces").select("*").eq("booking_id", bookingId);
      if (error) return json({ ok: false, error: error.message }, 500);
      const pieces = ((data || []) as Array<Record<string, unknown>>).map(pieceFromRow);
      const keys = chargeKey ? [chargeKey] : [...new Set(pieces.map((piece) => piece.chargeKey).filter(Boolean))] as string[];
      return json({
        ok: true,
        charges: keys.map((key) => ({ chargeKey: key, ...chargeReadiness(pieces, key, bookingId || null) })),
      });
    }

    if (action === "prep") {
      const kind = String(body.kind || "") as PieceKind;
      const prepInput = body.input as DisputeBuildInput | undefined;
      if (!prepInput) return json({ ok: false, error: "input is required" }, 400);
      const built = linesForPrep(kind, {
        ...prepInput,
        disputeId: prepInput.disputeId || `prep-${body.bookingId || "client"}`,
        reason: prepInput.reason || "general",
      });
      const { data: rows } = await admin.from("client_evidence_pieces").select("*").eq("client_key", String(body.clientKey || prepInput.customerEmail || "unknown"));
      const existing = ((rows || []) as Array<Record<string, unknown>>).map(pieceFromRow);
      const result = preparePiece(existing, {
        clientKey: String(body.clientKey || prepInput.customerEmail || "unknown"),
        bookingId: body.bookingId ? String(body.bookingId) : null,
        chargeKey: body.chargeKey ? String(body.chargeKey) : null,
        kind,
        seriesId: String(body.seriesId || kind),
        eventId: String(body.eventId || `${kind}:${body.bookingId || "client"}`),
        lines: built.lines,
        now: String(body.now || new Date().toISOString()),
        backfill: Boolean(body.backfill),
        correctionReason: body.correctionReason ? String(body.correctionReason) : null,
        gaps: built.gaps,
        identity: identityFromInput(prepInput, {
          acceptance: "Acceptance Record",
          policy: "Refund and cancellation policy",
          receipt: "Receipt and charge breakdown",
          completion: "Completion Summary",
          communication: "Customer communication",
          other: "Other evidence",
        }[kind] || kind),
      });
      if (result.rejected) return json({ ok: true, rejected: result.rejected });
      if (!result.created) return json({ ok: true, duplicate: true });
      const created = result.created;
      if (created.version > 1) {
        await admin.from("client_evidence_pieces").update({ superseded: true }).eq("client_key", created.clientKey).eq("kind", created.kind).eq("series_id", created.seriesId).eq("superseded", false);
      }
      const { error } = await admin.from("client_evidence_pieces").insert({
        client_key: created.clientKey,
        booking_id: created.bookingId,
        charge_key: created.chargeKey,
        kind: created.kind,
        series_id: created.seriesId,
        version: created.version,
        event_id: created.eventId,
        reason: created.reason,
        fingerprint: created.fingerprint,
        generated_at: created.generatedAt,
        backfill: created.backfill,
        superseded: false,
        lines: created.lines,
        gaps: created.gaps,
        identity: created.identity || null,
      });
      if (error && /duplicate|unique/i.test(error.message)) return json({ ok: true, duplicate: true });
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, created: { kind: created.kind, version: created.version, fingerprint: created.fingerprint, generatedAt: created.generatedAt } });
    }

    if (action === "gaps") {
      const { data, error } = await admin.from("client_evidence_pieces").select("*").eq("superseded", false).limit(2000);
      if (error) return json({ ok: false, error: error.message }, 500);
      const pieces = ((data || []) as Array<Record<string, unknown>>).map(pieceFromRow);
      const keys = [...new Set(pieces.map((piece) => piece.chargeKey).filter(Boolean))] as string[];
      const charges = keys.map((key) => {
        const sample = pieces.find((piece) => piece.chargeKey === key);
        return { chargeKey: key, clientKey: sample?.clientKey || null, ...chargeReadiness(pieces, key, sample?.bookingId) };
      });
      const open = charges.filter((row) => row.status !== "ready");
      return json({ ok: true, shareReady: readinessShare(charges).shareReady, charges: open });
    }

    if (action === "backfill") {
      const now = new Date().toISOString();
      const since = new Date(Date.now() - STRIPE_EVIDENCE_LIMITS.lookbackDays * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const { data: bookings, error } = await admin.from("bookings")
        .select("id, email, first_name, last_name, service_date, address, city, state, zip_code, payment_intent_id, total_estimate_cents, final_charge_cents, booking_number, completed_at, service_type")
        .gte("service_date", since)
        .order("service_date", { ascending: false })
        .limit(100);
      if (error) return json({ ok: false, error: error.message }, 500);
      const bookingRows = (bookings || []) as Array<Record<string, unknown>>;
      const ids = bookingRows.map((row) => String(row.id));
      const emails = [...new Set(bookingRows.map((row) => String(row.email || "")).filter(Boolean))];
      const { data: agreements } = ids.length
        ? await admin.from("service_agreements").select("booking_id, signed_by, customer_name, ip, user_agent, accepted_at, agreement_version, agreed_terms, agreed_disclaimer, agreed_refund, agreed_service_agreement").in("booking_id", ids)
        : { data: [] };
      const { data: existingRows } = emails.length
        ? await admin.from("client_evidence_pieces").select("*").in("client_key", emails)
        : { data: [] };
      let pieces = ((existingRows || []) as Array<Record<string, unknown>>).map(pieceFromRow);
      let prepared = 0;
      const agreementRows = (agreements || []) as Array<Record<string, unknown>>;
      for (const booking of bookingRows) {
        const email = String(booking.email || "");
        if (!email) continue;
        const agreement = agreementRows.find((row) => String(row.booking_id) === String(booking.id));
        const name = [booking.first_name, booking.last_name].filter(Boolean).join(" ") || String(agreement?.signed_by || agreement?.customer_name || "");
        const address = [booking.address, booking.city, booking.state, booking.zip_code].filter(Boolean).join(", ");
        const chargeKey = booking.payment_intent_id ? String(booking.payment_intent_id) : String(booking.id);
        const input = {
          disputeId: `prep-${booking.id}`,
          reason: "general" as const,
          customerEmail: email,
          customerName: name || null,
          serviceDate: booking.service_date ? String(booking.service_date) : null,
          serviceAddress: address || null,
          billingAddress: address || null,
          bookingRef: booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : String(booking.id),
          serviceDescription: booking.service_type ? String(booking.service_type) : null,
          disputedAmountCents: typeof booking.final_charge_cents === "number" ? booking.final_charge_cents : (typeof booking.total_estimate_cents === "number" ? booking.total_estimate_cents : null),
          finishedAt: booking.completed_at ? String(booking.completed_at) : null,
          acceptance: agreement ? {
            signerName: String(agreement.signed_by || agreement.customer_name || name || ""),
            email,
            signedAt: agreement.accepted_at ? String(agreement.accepted_at) : null,
            ip: agreement.ip ? String(agreement.ip) : null,
            userAgent: agreement.user_agent ? String(agreement.user_agent) : null,
            agreementName: "One-Time Service Agreement",
            agreementVersion: agreement.agreement_version ? String(agreement.agreement_version) : null,
            acknowledgments: [
              { label: "Terms of Service", accepted: agreement.agreed_terms === true },
              { label: "Disclaimer", accepted: agreement.agreed_disclaimer === true },
              { label: "Refund Policy", accepted: agreement.agreed_refund === true },
              { label: "Service Agreement", accepted: agreement.agreed_service_agreement === true },
            ],
          } : null,
          charges: booking.payment_intent_id ? [{
            label: "Charge",
            amountCents: typeof booking.final_charge_cents === "number" ? booking.final_charge_cents : (typeof booking.total_estimate_cents === "number" ? booking.total_estimate_cents : null),
            paymentIntentId: String(booking.payment_intent_id),
            kind: "charge",
          }] : [],
        };
        const kinds: PieceKind[] = [];
        if (agreement) kinds.push("acceptance", "policy");
        if (booking.completed_at) kinds.push("completion");
        if (booking.payment_intent_id) kinds.push("receipt");
        for (const kind of kinds) {
          const built = linesForPrep(kind, input);
          const result = preparePiece(pieces, {
            clientKey: email,
            bookingId: String(booking.id),
            chargeKey,
            kind,
            seriesId: `backfill:${kind}:${booking.id}`,
            eventId: `backfill:${kind}:${booking.id}`,
            lines: built.lines,
            now,
            backfill: true,
            gaps: built.gaps,
            identity: identityFromInput(input, {
              acceptance: "Acceptance Record",
              policy: "Refund and cancellation policy",
              receipt: "Receipt and charge breakdown",
              completion: "Completion Summary",
              communication: "Customer communication",
              other: "Other evidence",
            }[kind]),
          });
          pieces = result.pieces;
          if (!result.created) continue;
          const created = result.created;
          const { error: insertError } = await admin.from("client_evidence_pieces").insert({
            client_key: created.clientKey,
            booking_id: created.bookingId,
            charge_key: created.chargeKey,
            kind: created.kind,
            series_id: created.seriesId,
            version: created.version,
            event_id: created.eventId,
            reason: created.reason,
            fingerprint: created.fingerprint,
            generated_at: created.generatedAt,
            backfill: true,
            superseded: false,
            lines: created.lines,
            gaps: created.gaps,
            identity: created.identity || null,
          });
          if (insertError && /duplicate|unique/i.test(insertError.message)) continue;
          if (insertError) return json({ ok: false, error: insertError.message, prepared }, 500);
          prepared++;
        }
      }
      return json({ ok: true, scanned: bookingRows.length, prepared, since });
    }

    if (action === "weekly") {
      const { data, error } = await admin.from("dispute_evidence_cases").select("reason, outcome, loss_cause, status").limit(500);
      if (error) return json({ ok: false, error: error.message }, 500);
      const rows = ((data || []) as Array<Record<string, unknown>>).map((row) => ({
        reason: row.reason ? String(row.reason) : null,
        outcome: row.outcome ? String(row.outcome) : (row.status === "won" || row.status === "lost" ? String(row.status) : null),
        lossCause: row.loss_cause ? String(row.loss_cause) : null,
        readyAtArrival: row.ready_at_arrival == null ? null : Boolean(row.ready_at_arrival),
      }));
      return json({ ok: true, report: weeklyDisputeReport(rows) });
    }

    if (action === "withdrawal_draft") {
      const draft = withdrawalDraft({
        customerName: body.customerName ? String(body.customerName) : input?.customerName,
        serviceDocumented: Boolean(body.serviceDocumented),
        relationshipIntact: body.relationshipIntact !== false,
        serviceDate: body.serviceDate ? String(body.serviceDate) : input?.serviceDate,
        serviceAddress: body.serviceAddress ? String(body.serviceAddress) : input?.serviceAddress,
      });
      return json({ ok: true, draft, sentAutomatically: false });
    }

    if (!input?.disputeId || !input.reason) return json({ ok: false, error: "input.disputeId and input.reason are required" }, 400);

    if (action === "accept_without_evidence") {
      const note = String(body.note || "").trim();
      if (!note) return json({ ok: false, error: "A note is required to accept a dispute without evidence." }, 400);
      await admin.from("dispute_evidence_cases").upsert({
        stripe_dispute_id: input.disputeId,
        booking_id: body.bookingId || null,
        reason: input.reason,
        status: "accepted_without_evidence",
        narrative: note,
        updated_at: new Date().toISOString(),
      }, { onConflict: "stripe_dispute_id" });
      return json({ ok: true, status: "accepted_without_evidence" });
    }

    if (action === "loss_review") {
      const review = validateLossReview(String(body.cause || ""), String(body.note || ""));
      if (!review.ok) return json({ ok: false, error: review.error }, 400);
      const { error } = await admin.from("dispute_evidence_cases").update({
        outcome: "lost",
        loss_cause: review.cause,
        loss_note: String(body.note).trim(),
        outcome_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("stripe_dispute_id", input.disputeId);
      if (error) return json({ ok: false, error: error.message }, 500);
      return json({ ok: true, outcome: "lost", cause: review.cause });
    }

    const photos = input.photos || [];
    for (const photo of photos) {
      if (photo.bytes || !photo.url) continue;
      if (photos.filter((p) => p.bytes).length >= 12) break;
      try {
        const res = await fetch(photo.url);
        if (!res.ok) continue;
        const type = res.headers.get("content-type") || "";
        if (!/jpeg|jpg|png/i.test(type) && !/\.(jpe?g|png)(\?|$)/i.test(photo.url)) continue;
        const buf = new Uint8Array(await res.arrayBuffer());
        if (buf.byteLength > 0 && buf.byteLength < 1_500_000) photo.bytes = buf;
      } catch {
        /* a failed fetch stays "image bytes not recorded" */
      }
    }
    const evidence = buildDisputeEvidence(input);
    const clientKey = String(body.clientKey || input.customerEmail || "");
    const chargeKey = String(body.chargeKey || input.charges?.[0]?.paymentIntentId || "");
    let pieces: FrozenPiece[] = [];
    if (clientKey) {
      const { data: stored } = await admin.from("client_evidence_pieces").select("*").eq("client_key", clientKey);
      pieces = ((stored || []) as Array<Record<string, unknown>>).map(pieceFromRow);
    }
    const assembled = assembleFromPrepared({
      pieces,
      chargeKey,
      bookingId: body.bookingId ? String(body.bookingId) : null,
      input,
      now: input.now || new Date().toISOString(),
    });
    const excluded = new Set((Array.isArray(body.excludePackets) ? body.excludePackets : []).map(String));
    evidence.packets = assembled.packets.filter((packet) => !excluded.has(packet.id) || !optionalPacket(packet.id, input.reason, input.messages));
    if (excluded.size) {
      const kept = evidence.packets.filter((packet) => excluded.has(packet.id));
      if (kept.length) evidence.warnings.push("A required packet was left in the set. Only optional packets can be excluded.");
    }
    evidence.warnings.push(...assembled.warnings.filter((warning) => !evidence.warnings.includes(warning)));
    evidence.warnings.push(...assembled.fingerprintMismatches);
    evidence.warnings.push(...assembled.builtAtDisputeTime.map((kind) => `${kind} was built at dispute time.`));
    if (typeof body.narrative === "string" && body.narrative.trim()) {
      const forbidden = narrativeHasForbidden(body.narrative);
      if (forbidden) evidence.warnings.push(`Narrative contained forbidden phrasing and was rejected: ${forbidden}`);
      else {
        evidence.narrative = body.narrative.trim();
        evidence.textFields.uncategorized_text = evidence.narrative;
      }
    }
    const rendered = await renderEvidenceSet({ PDFDocument, StandardFonts, rgb }, evidence.packets);
    const text = Object.values(evidence.textFields).join("");
    const budget = validateRendered(rendered, text, STRIPE_EVIDENCE_LIMITS);
    const checklist = reviewChecklist(evidence, budget);

    if (action === "submit" || action === "stage") {
      if (!budget.ok || !checklist.items.find((item) => item.id === "budget")?.ok) {
        return json({ ok: false, error: budget.errors.join(" ") || "The set is over budget.", budget, checklist }, 400);
      }
      if (assembled.fingerprintMismatches.length) {
        return json({ ok: false, error: assembled.fingerprintMismatches.join(" "), checklist }, 400);
      }
      const { data: existing } = await admin.from("dispute_evidence_cases").select("status, stripe_file_ids").eq("stripe_dispute_id", input.disputeId).maybeSingle();
      if (existing?.status === "submitted" || existing?.status === "accepted_without_evidence") {
        return json({ ok: true, alreadySubmitted: true, fileIds: existing.stripe_file_ids || {} });
      }
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
      if (!stripeKey) return json({ ok: false, error: "STRIPE_SECRET_KEY is not configured." }, 500);
      const packets = rendered.map((p) => ({ stripeField: p.stripeField, filename: p.filename, bytes: p.bytes }));
      const prior = { status: existing?.status || "draft", fileIds: existing?.stripe_file_ids || {} };
      const result = action === "stage"
        ? { state: await stageDisputeEvidence(stripeClient(stripeKey), input.disputeId, packets, evidence.textFields, prior), alreadySubmitted: false }
        : await submitDisputeEvidence(stripeClient(stripeKey), input.disputeId, packets, evidence.textFields, prior);
      await admin.from("dispute_evidence_cases").upsert({
        stripe_dispute_id: input.disputeId,
        booking_id: body.bookingId || null,
        reason: input.reason,
        evidence_due_at: input.evidenceDueAt || null,
        status: result.state.status,
        summary: evidence.packets.map((p) => ({ id: p.id, field: p.stripeField, filename: p.filename, pageCap: p.pageCap, trimmed: p.trimmed, lines: p.lines, identity: p.identity })),
        text_fields: evidence.textFields,
        narrative: evidence.narrative,
        stripe_file_ids: result.state.fileIds,
        warnings: evidence.warnings,
        missing: evidence.missing,
        fingerprint_mismatches: assembled.fingerprintMismatches,
        submitted_at: action === "submit" && !result.alreadySubmitted ? new Date().toISOString() : undefined,
        updated_at: new Date().toISOString(),
      }, { onConflict: "stripe_dispute_id" });
      return json({ ok: true, alreadySubmitted: result.alreadySubmitted, fileIds: result.state.fileIds, budget, checklist });
    }

    const { error: draftErr } = await admin.from("dispute_evidence_cases").upsert({
      stripe_dispute_id: input.disputeId,
      booking_id: body.bookingId || null,
      reason: input.reason,
      evidence_due_at: input.evidenceDueAt || null,
      status: "draft",
      summary: evidence.packets.map((p) => ({
        id: p.id, field: p.stripeField, filename: p.filename, pageCap: p.pageCap, trimmed: p.trimmed, lines: p.lines,
      })),
      text_fields: evidence.textFields,
      narrative: evidence.narrative,
      warnings: evidence.warnings,
      missing: evidence.missing,
      fingerprint_mismatches: assembled.fingerprintMismatches,
      updated_at: new Date().toISOString(),
    }, { onConflict: "stripe_dispute_id" });
    if (draftErr) evidence.warnings.push(`Draft was not saved: ${draftErr.message}`);

    return json({
      ok: true,
      status: "draft",
      reminder: evidence.reminder,
      policyField: evidence.policyField,
      warnings: evidence.warnings,
      missing: evidence.missing,
      omittedMessages: evidence.omittedMessages,
      narrative: evidence.narrative,
      textFields: evidence.textFields,
      budget,
      checklist,
      fingerprintMismatches: assembled.fingerprintMismatches,
      builtAtDisputeTime: assembled.builtAtDisputeTime,
      limits: { pages: STRIPE_EVIDENCE_LIMITS.combinedPages, bytes: STRIPE_EVIDENCE_LIMITS.combinedBytes },
      packets: evidence.packets.map((p, i) => {
        const size = rendered[i]?.bytes.byteLength || 0;
        return {
          id: p.id,
          field: p.stripeField,
          filename: p.filename,
          pages: rendered[i]?.pages,
          bytes: size,
          trimmed: p.trimmed,
          identity: p.identity,
          generatedAt: p.lines[0]?.startsWith("Built at dispute time") ? p.lines[0] : null,
          preview: p.lines.slice(0, 80),
          pagesPreview: previewPages(p),
          pdfBase64: size > 0 && size < 400_000 ? bytesToBase64(rendered[i].bytes) : null,
        };
      }),
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
