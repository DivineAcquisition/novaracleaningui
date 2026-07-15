// ─── POST /api/docuseal/webhook?secret=... ────────────────────────────────────
//
// Receives DocuSeal completion events and stamps the matching
// docuseal_submissions row (status, signed PDF URL, completed_at). Authenticated
// by the shared secret stored in app_secrets (DOCUSEAL_WEBHOOK_SECRET), passed
// as ?secret= on the URL you configure in DocuSeal → Settings → Webhooks.
//
// Handles event types: form.completed / submission.completed (signed),
// form.declined / submission.expired (declined), form.viewed (opened).
//
// Membership agree→pay: when a completed membership submission has
// metadata.hold_payment + metadata.payment_url, email/SMS the Stripe
// payment link so the customer pays only after signing.

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

async function releaseHeldMembershipPayment(
  supabase: any,
  row: {
    submission_id?: string | null;
    email?: string | null;
    metadata?: Record<string, unknown> | null;
  },
) {
  const meta = (row.metadata || {}) as Record<string, unknown>;
  if (!meta.hold_payment || !meta.payment_url) return { released: false };
  if (meta.payment_released_at) return { released: false, already: true };

  const paymentUrl = String(meta.payment_url);
  const email = String(row.email || meta.email || "").trim().toLowerCase();
  const phone = meta.phone ? String(meta.phone) : "";
  const plan = meta.plan ? String(meta.plan) : "membership";
  const firstName = String(meta.first_name || meta.name || "there").split(/\s+/)[0] || "there";

  let emailed = false;
  let smsSent = false;

  if (email) {
    try {
      await supabase.functions.invoke("send-membership-email", {
        body: {
          type: "checkout_link",
          email,
          data: {
            name: firstName,
            plan,
            url: paymentUrl,
            monthlyAmount: meta.membership_rate_cents || 0,
            depositAmount: 0,
            firstServiceDate: meta.first_service_date || "",
          },
        },
      });
      emailed = true;
    } catch (err) {
      console.error("[docuseal/webhook] membership pay email failed", err);
    }
  }

  if (phone) {
    try {
      const { error } = await supabase.functions.invoke("send-ghl-sms", {
        body: {
          phone,
          type: "confirmation",
          message:
            `Hi ${firstName}! Your Novara membership agreement is signed. ` +
            `Complete payment to activate: ${paymentUrl}`,
        },
      });
      smsSent = !error;
    } catch (err) {
      console.error("[docuseal/webhook] membership pay SMS failed", err);
    }
  }

  if (row.submission_id) {
    await supabase
      .from("docuseal_submissions")
      .update({
        metadata: {
          ...meta,
          payment_released_at: new Date().toISOString(),
          payment_released_email: emailed,
          payment_released_sms: smsSent,
        },
        updated_at: new Date().toISOString(),
      })
      .eq("submission_id", row.submission_id)
      .then(() => undefined, () => undefined);
  }

  await supabase.from("events").insert({
    event_type: "membership.payment_link_released",
    source: "docuseal-webhook",
    summary: `Membership payment link released after agreement signed (${email || "unknown"})`,
    data: { email, payment_url: paymentUrl, emailed, sms_sent: smsSent, plan },
  }).then(() => undefined, () => undefined);

  return { released: true, emailed, smsSent };
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

  let paymentRelease: unknown = null;
  try {
    const supabase = getAdminSupabase();
    // Match on the DocuSeal submission id; submission_id is stored as text.
    await supabase
      .from("docuseal_submissions")
      .update(patch)
      .eq("submission_id", submissionId);

    if (status === "completed") {
      const { data: row } = await supabase
        .from("docuseal_submissions")
        .select("submission_id, email, audience, metadata")
        .eq("submission_id", submissionId)
        .maybeSingle();
      if (row && (row.audience === "membership" || (row.metadata as any)?.kind === "membership_agree_then_pay")) {
        paymentRelease = await releaseHeldMembershipPayment(supabase, row);
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[docuseal/webhook]", (err as Error).message);
    // Still 200 so DocuSeal doesn't hammer retries on a transient DB blip.
  }

  return NextResponse.json({ ok: true, type, submissionId, status, paymentRelease });
}
