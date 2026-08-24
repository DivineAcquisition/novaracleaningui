// ─── /api/admin/company-coi ────────────────────────────────────────────────
//
// OUR certificate of insurance — the one we owe commercial clients, not the
// ones they give us. Those live in /api/admin/coi and are a different problem
// entirely: theirs gates dispatch, ours is a promise in Section 8.1 that has
// to actually be kept.
//
//   GET                      the certificate in force, its history, recent
//                            deliveries, and who is holding a stale copy
//   POST upload_document     record a newly issued certificate (the file is
//                            uploaded to the private company-coi bucket from
//                            the browser first). Supersedes the prior one.
//   POST resend_to_holders   send the current certificate to every client who
//                            was given an older one
//   POST send                deliver it to one account on request
//
// Admin/VA only.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { rows } from "@/lib/commercial-agreement-server";
import { COMPANY_COI_BUCKET, sendCompanyCoi, currentCompanyCoi, coiIsExpired } from "@/lib/company-coi";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DOC_COLS =
  "id, document_path, document_name, document_size_bytes, effective_date, expiration_date, " +
  "carrier, policy_number, coverage_notes, business_account_id, lifecycle, review_note, " +
  "uploaded_by_name, created_at";

async function guard(req: Request) {
  try {
    return { principal: await requireAdmin(req), failure: null as NextResponse | null };
  } catch (e) {
    const err = e as AdminAuthError;
    return {
      principal: null,
      failure: NextResponse.json({ error: err.message }, { status: err.status || 401 }),
    };
  }
}

const s = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max) || null;

function isoDate(v: unknown): string | null {
  const raw = String(v ?? "").trim().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  return Number.isFinite(Date.parse(`${raw}T00:00:00Z`)) ? raw : null;
}

export async function GET(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();

  const [{ data: docs }, { data: deliveries }] = await Promise.all([
    supabase.from("company_coi_documents").select(DOC_COLS).order("created_at", { ascending: false }).limit(100),
    supabase
      .from("company_coi_deliveries")
      .select("id, business_account_id, company_coi_document_id, sent_to, sent_at, sent_by_name, trigger_source, status, failure_reason, certificate_expires_at, business_accounts(business_name)")
      .order("sent_at", { ascending: false })
      .limit(200),
  ]);

  const current = await currentCompanyCoi(supabase, null);

  // Signed URLs so an admin can actually open what is on file rather than
  // trusting a row that says a document exists.
  const documents = [];
  for (const doc of rows<Record<string, unknown>>(docs)) {
    let url: string | null = null;
    if (doc.document_path) {
      const { data: signed } = await supabase.storage
        .from(COMPANY_COI_BUCKET)
        .createSignedUrl(String(doc.document_path), 3600);
      url = signed?.signedUrl || null;
    }
    documents.push({ ...doc, url });
  }

  // Clients holding a superseded certificate. Renewing without re-sending
  // leaves every one of them with an out-of-date copy in their vendor file,
  // which is exactly the gap Section 8.1 is supposed to close.
  const staleHolders = rows<Record<string, unknown>>(deliveries).filter(
    (d) =>
      d.status === "sent" &&
      current?.id &&
      d.company_coi_document_id &&
      d.company_coi_document_id !== current.id,
  );
  const seen = new Set<string>();
  const needsResend = staleHolders.filter((d) => {
    const key = String(d.business_account_id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return NextResponse.json({
    ok: true,
    current: current
      ? {
        ...current,
        expired: coiIsExpired(current),
        daysRemaining: current.expiration_date
          ? Math.ceil(
            (new Date(`${String(current.expiration_date)}T23:59:59Z`).getTime() - Date.now()) /
                86_400_000,
          )
          : null,
      }
      : null,
    documents,
    deliveries: deliveries || [],
    needsResend,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const actorName = s(body.actorName, 120) || principal?.email || "Admin";

  // ── Record a newly issued certificate ──────────────────────────────────
  if (action === "upload_document") {
    const path = s(body.documentPath, 500);
    if (!path) {
      return NextResponse.json({ error: "The uploaded file path is required." }, { status: 400 });
    }
    const expiration = isoDate(body.expirationDate);
    const accountId = s(body.businessAccountId, 60);

    // Same discipline as the account-side certificates: no readable expiry
    // means it cannot be the one in force, because there is nothing to
    // compute a status from.
    const lifecycle = expiration ? "current" : "needs_review";

    // Supersede the prior certificate of the same kind (general, or the one
    // naming this account). Captured first so a failed insert can restore it.
    const priorQuery = supabase
      .from("company_coi_documents")
      .select("id")
      .eq("lifecycle", "current");
    const { data: prior } = accountId
      ? await priorQuery.eq("business_account_id", accountId).maybeSingle()
      : await priorQuery.is("business_account_id", null).maybeSingle();
    const displacedId = (prior as { id?: string } | null)?.id ?? null;

    if (lifecycle === "current" && displacedId) {
      await supabase
        .from("company_coi_documents")
        .update({ lifecycle: "superseded", updated_at: new Date().toISOString() })
        .eq("id", displacedId);
    }

    const { data: created, error } = await supabase
      .from("company_coi_documents")
      .insert({
        document_path: path,
        document_name: s(body.documentName, 300),
        document_size_bytes: Number(body.documentSizeBytes) || null,
        effective_date: isoDate(body.effectiveDate),
        expiration_date: expiration,
        carrier: s(body.carrier, 200),
        policy_number: s(body.policyNumber, 120),
        coverage_notes: s(body.coverageNotes, 2000),
        business_account_id: accountId,
        lifecycle,
        uploaded_by: principal?.userId ?? null,
        uploaded_by_name: actorName,
      })
      .select("id")
      .maybeSingle();

    if (error) {
      // A failed replacement must not leave us with no certificate on file.
      if (lifecycle === "current" && displacedId) {
        await supabase
          .from("company_coi_documents")
          .update({ lifecycle: "current", updated_at: new Date().toISOString() })
          .eq("id", displacedId);
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await supabase.from("events").insert({
      event_type: "company_coi.updated",
      source: "admin-company-coi",
      summary:
        lifecycle === "current"
          ? `Our certificate of insurance was updated by ${actorName} — valid through ${expiration}.`
          : `A company certificate was uploaded by ${actorName} with no readable expiry — parked for review, not in force.`,
      data: { document_id: (created as { id: string } | null)?.id, lifecycle, account_id: accountId },
    });

    return NextResponse.json({
      ok: true,
      documentId: (created as { id: string } | null)?.id,
      lifecycle,
      warning:
        lifecycle === "needs_review"
          ? "No expiry date was read off this certificate, so it is not in force and will not be sent to clients. Add the expiration date to put it in force."
          : null,
    });
  }

  // ── Send to one client ─────────────────────────────────────────────────
  if (action === "send") {
    const accountId = s(body.accountId, 60);
    if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });
    const result = await sendCompanyCoi(supabase, {
      accountId,
      to: s(body.to, 200),
      triggerSource: "manual",
      sentByName: actorName,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    return NextResponse.json({ ok: true, sentTo: result.sentTo });
  }

  // ── Re-send the renewal to everyone holding an older copy ──────────────
  if (action === "resend_to_holders") {
    const current = await currentCompanyCoi(supabase, null);
    if (!current || coiIsExpired(current)) {
      return NextResponse.json(
        { error: "There's no current certificate to send. Upload the renewal first." },
        { status: 409 },
      );
    }

    const { data: deliveries } = await supabase
      .from("company_coi_deliveries")
      .select("business_account_id, company_coi_document_id, status")
      .eq("status", "sent");

    const stale = new Set<string>();
    for (const d of rows<Record<string, unknown>>(deliveries)) {
      if (d.company_coi_document_id !== current.id) stale.add(String(d.business_account_id));
    }

    let sent = 0;
    const failures: Array<{ accountId: string; error: string }> = [];
    for (const accountId of stale) {
      const result = await sendCompanyCoi(supabase, {
        accountId,
        triggerSource: "renewal",
        sentByName: actorName,
      });
      if (result.ok) sent += 1;
      else failures.push({ accountId, error: result.error || "unknown" });
    }

    return NextResponse.json({ ok: true, sent, attempted: stale.size, failures });
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
}
