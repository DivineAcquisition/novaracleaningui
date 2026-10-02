// Dispute evidence set: build, stage, and submit once.
// Admin/VA JWT or the service role. Drafts are not submitted.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { buildDisputeEvidence, type DisputeBuildInput } from "../_shared/dispute-evidence/build.ts";
import { STRIPE_EVIDENCE_LIMITS } from "../_shared/dispute-evidence/limits.ts";
import { renderEvidenceSet, validateRendered } from "../_shared/dispute-evidence/render.ts";
import { submitDisputeEvidence } from "../_shared/dispute-evidence/submit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
    const rendered = await renderEvidenceSet({ PDFDocument, StandardFonts, rgb }, evidence.packets);
    const text = Object.values(evidence.textFields).join("");
    const budget = validateRendered(rendered, text, STRIPE_EVIDENCE_LIMITS);

    if (action === "submit") {
      if (!budget.ok) return json({ ok: false, error: budget.errors.join(" "), budget }, 400);
      const { data: existing } = await admin.from("dispute_evidence_cases").select("status, stripe_file_ids").eq("stripe_dispute_id", input.disputeId).maybeSingle();
      if (existing?.status === "submitted" || existing?.status === "accepted_without_evidence") {
        return json({ ok: true, alreadySubmitted: true, fileIds: existing.stripe_file_ids || {} });
      }
      const stripeKey = Deno.env.get("STRIPE_SECRET_KEY") || "";
      if (!stripeKey) return json({ ok: false, error: "STRIPE_SECRET_KEY is not configured." }, 500);
      const result = await submitDisputeEvidence(
        stripeClient(stripeKey),
        input.disputeId,
        rendered.map((p) => ({ stripeField: p.stripeField, filename: p.filename, bytes: p.bytes })),
        evidence.textFields,
        { status: existing?.status || "draft", fileIds: existing?.stripe_file_ids || {} },
      );
      await admin.from("dispute_evidence_cases").upsert({
        stripe_dispute_id: input.disputeId,
        booking_id: body.bookingId || null,
        reason: input.reason,
        evidence_due_at: input.evidenceDueAt || null,
        status: result.state.status,
        summary: evidence.packets.map((p) => ({ id: p.id, field: p.stripeField, filename: p.filename, pageCap: p.pageCap, trimmed: p.trimmed })),
        text_fields: evidence.textFields,
        narrative: evidence.narrative,
        stripe_file_ids: result.state.fileIds,
        warnings: evidence.warnings,
        missing: evidence.missing,
        submitted_at: result.alreadySubmitted ? undefined : new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }, { onConflict: "stripe_dispute_id" });
      return json({ ok: true, alreadySubmitted: result.alreadySubmitted, fileIds: result.state.fileIds, budget });
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
      limits: { pages: STRIPE_EVIDENCE_LIMITS.combinedPages, bytes: STRIPE_EVIDENCE_LIMITS.combinedBytes },
      packets: evidence.packets.map((p, i) => ({
        id: p.id,
        field: p.stripeField,
        filename: p.filename,
        pages: rendered[i]?.pages,
        bytes: rendered[i]?.bytes.byteLength,
        trimmed: p.trimmed,
        preview: p.lines.slice(0, 40),
      })),
    });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
