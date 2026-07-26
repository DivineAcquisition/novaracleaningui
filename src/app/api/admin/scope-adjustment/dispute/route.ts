// ─── /api/admin/scope-adjustment/dispute ─────────────────────────────────
//
// The customer pushed back on an adjustment. Rather than inventing a second
// dispute workflow, this opens a normal QC issue on the job through the
// existing qc-issues function, so it runs the same open → investigating →
// resolved path everything else does. The evidence is already assembled: the
// issue description carries the reasons, both prices, and the photos the
// adjustment was justified with.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { summarizeReasons, type ScopeReason } from "@/lib/scope-adjustment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const adjustmentId = String(body.adjustmentId || "");
  const note = String(body.note || "").trim();
  if (!adjustmentId) return NextResponse.json({ error: "adjustmentId required" }, { status: 400 });

  const supabase = getAdminSupabase();

  try {
    const { data: adjustment, error: aErr } = await supabase
      .from("scope_adjustments")
      .select("*")
      .eq("id", adjustmentId)
      .maybeSingle();
    if (aErr) throw aErr;
    if (!adjustment) return NextResponse.json({ error: "Adjustment not found" }, { status: 404 });
    if (adjustment.qc_issue_id) {
      return NextResponse.json({ ok: true, issueId: adjustment.qc_issue_id, alreadyOpen: true });
    }

    const { data: reasonRows } = await supabase.from("scope_adjustment_reasons").select("*");
    const reasons = (reasonRows || []) as ScopeReason[];
    const reasonSummary = summarizeReasons(reasons, adjustment.reason_codes || []);

    const photos = Array.isArray(adjustment.evidence_photos) ? adjustment.evidence_photos : [];
    const description = [
      `Customer disputed a scope adjustment applied on ${new Date(adjustment.applied_at).toLocaleDateString()}.`,
      "",
      `Justification: ${reasonSummary}`,
      `Price: $${(adjustment.original_price_cents / 100).toFixed(2)} → $${(adjustment.adjusted_price_cents / 100).toFixed(2)}`,
      adjustment.adjusted_service_type
        ? `Reclassified: ${adjustment.original_service_type || "—"} → ${adjustment.adjusted_service_type}`
        : "",
      adjustment.amount_overridden ? `Amount override: ${adjustment.override_note || "—"}` : "",
      adjustment.evidence_missing
        ? `⚠ Applied WITHOUT photo evidence. Override: ${adjustment.evidence_override_note || "—"}`
        : `Photo evidence on file: ${photos.length}`,
      adjustment.internal_note ? `Internal note: ${adjustment.internal_note}` : "",
      note ? `\nDispute detail: ${note}` : "",
      "",
      "Message sent to the customer:",
      adjustment.customer_message || "—",
      photos.length ? `\nEvidence:\n${photos.join("\n")}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    // Reuse the QC function so the issue gets the same crew attachment,
    // timeline event, and severity routing as any other case.
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    const res = await fetch(`${url}/functions/v1/qc-issues`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        action: "create",
        bookingId: adjustment.booking_id,
        issueType: "payment",
        severity: adjustment.evidence_missing ? "high" : "medium",
        title: `Scope adjustment disputed — ${reasonSummary}`.slice(0, 200),
        description: description.slice(0, 4000),
      }),
    });
    const payload = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; issue?: { id: string } };
    if (!res.ok || payload?.error || !payload?.issue?.id) {
      return NextResponse.json(
        { error: payload?.error || "Could not open the QC issue." },
        { status: res.status === 200 ? 500 : res.status },
      );
    }

    await supabase
      .from("scope_adjustments")
      .update({ status: "disputed", qc_issue_id: payload.issue.id })
      .eq("id", adjustmentId);

    return NextResponse.json({ ok: true, issueId: payload.issue.id });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[scope-adjustment:dispute]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
