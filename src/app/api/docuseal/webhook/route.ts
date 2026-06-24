// ─── POST /api/docuseal/webhook?secret=... ────────────────────────────────────
//
// Receives DocuSeal completion events and stamps the matching
// docuseal_submissions row (status, signed PDF URL, completed_at). Authenticated
// by the shared secret stored in app_secrets (DOCUSEAL_WEBHOOK_SECRET), passed
// as ?secret= on the URL you configure in DocuSeal → Settings → Webhooks.
//
// Handles event types: form.completed / submission.completed (signed),
// form.declined / submission.expired (declined), form.viewed (opened).

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { getDocusealWebhookSecret } from "@/lib/docuseal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function pickDocumentUrl(data: any): string | null {
  const docs = data?.documents || data?.submission?.documents;
  if (Array.isArray(docs) && docs.length > 0) {
    return docs[0]?.url || docs[0]?.download_url || null;
  }
  return data?.audit_log_url || null;
}

export async function POST(req: Request): Promise<NextResponse> {
  // Auth — constant-time-ish compare against the stored secret.
  const expected = await getDocusealWebhookSecret();
  const provided = new URL(req.url).searchParams.get("secret") || req.headers.get("x-docuseal-secret") || "";
  if (!expected || provided !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let event: any;
  try {
    event = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const type = String(event?.event_type || event?.type || "");
  const data = event?.data || event;
  // DocuSeal nests submission id differently across event shapes.
  const submissionId = String(
    data?.submission_id ?? data?.submission?.id ?? data?.id ?? "",
  );

  if (!submissionId) {
    return NextResponse.json({ ok: true, ignored: "no submission id" });
  }

  let status: string | null = null;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (/completed/i.test(type)) {
    status = "completed";
    patch.completed_at = new Date().toISOString();
    const docUrl = pickDocumentUrl(data);
    if (docUrl) patch.document_url = docUrl;
    if (data?.audit_log_url) patch.audit_log_url = data.audit_log_url;
  } else if (/declin|expir/i.test(type)) {
    status = "declined";
  } else if (/view|open/i.test(type)) {
    status = "opened";
  }

  if (status) patch.status = status;

  try {
    const supabase = getAdminSupabase();
    // Match on the DocuSeal submission id; submission_id is stored as text.
    await supabase
      .from("docuseal_submissions")
      .update(patch)
      .eq("submission_id", submissionId);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[docuseal/webhook]", (err as Error).message);
    // Still 200 so DocuSeal doesn't hammer retries on a transient DB blip.
  }

  return NextResponse.json({ ok: true, type, submissionId, status });
}
