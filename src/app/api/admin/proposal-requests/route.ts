// ─── /api/admin/proposal-requests ──────────────────────────────────────────
//
// Dedicated Proposals tab. A submit here is a Proposal Request — never a
// job booking. Creates a prospective account (or STR host), sites, and
// commercial_walkthroughs in `requested`, then emails the requester that a
// walkthrough agent is being assigned.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  loadProposalChecklists,
  loadProposalSettings,
  sendProposalEmail,
  createProposalRequest,
} from "@/lib/proposal-request-server";
import { PROPOSAL_STATUS_LABELS } from "@/lib/proposal-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function GET(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();
  const url = new URL(req.url);
  const status = url.searchParams.get("status");
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();

  let query = supabase
    .from("proposal_requests")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(400);
  if (status && status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ids = (data || []).map((r: { id: string }) => r.id);
  const { data: sites } = ids.length
    ? await supabase
        .from("proposal_request_sites")
        .select("*")
        .in("proposal_request_id", ids)
        .order("sort_order", { ascending: true })
    : { data: [] as Array<Record<string, unknown>> };

  const wtIds = [...new Set(
    (sites || [])
      .map((s: { walkthrough_id?: string | null }) => s.walkthrough_id)
      .filter(Boolean) as string[],
  )];
  const { data: walkthroughs } = wtIds.length
    ? await supabase
        .from("commercial_walkthroughs")
        .select("id, assignment_token, token_expires_at, token_submitted_at, status, pdf_url, photos, assigned_cleaner_id")
        .in("id", wtIds)
    : { data: [] };
  const wtById = new Map<string, Record<string, unknown>>();
  for (const w of walkthroughs || []) {
    const row = w as Record<string, unknown>;
    wtById.set(String(row.id), row);
  }

  const sitesByRequest = new Map<string, Array<Record<string, unknown>>>();
  for (const site of sites || []) {
    const rid = String((site as { proposal_request_id: string }).proposal_request_id);
    const wt = wtById.get(String((site as { walkthrough_id?: string }).walkthrough_id || "")) || {};
    const merged = {
      ...(site as Record<string, unknown>),
      assignment_token: (wt as { assignment_token?: string }).assignment_token ?? null,
      token_expires_at: (wt as { token_expires_at?: string }).token_expires_at ?? null,
      token_submitted_at: (wt as { token_submitted_at?: string }).token_submitted_at ?? null,
      walkthrough_status: (wt as { status?: string }).status ?? null,
      pdf_url: (wt as { pdf_url?: string }).pdf_url ?? null,
    };
    sitesByRequest.set(rid, [...(sitesByRequest.get(rid) || []), merged]);
  }

  let rows = (data || []).map((r: Record<string, unknown>) => ({
    ...r,
    status_label: PROPOSAL_STATUS_LABELS[(r.status as keyof typeof PROPOSAL_STATUS_LABELS)] || r.status,
    sites: sitesByRequest.get(String(r.id)) || [],
  }));
  if (q) {
    rows = rows.filter((r) => {
      const hay = `${r["requester_name"] || ""} ${r["requester_company"] || ""} ${r["requester_email"] || ""} ${r["property_type_key"] || ""}`;
      return String(hay).toLowerCase().includes(q);
    });
  }

  return NextResponse.json({ ok: true, requests: rows });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const [catalog, settings] = await Promise.all([
    loadProposalChecklists(supabase),
    loadProposalSettings(supabase),
  ]);

  const created = await createProposalRequest(supabase, catalog, {
    propertyTypeKey: String(body.propertyTypeKey || ""),
    requesterName: String(body.requesterName || ""),
    requesterCompany: body.requesterCompany as string | undefined,
    requesterEmail: String(body.requesterEmail || ""),
    requesterPhone: body.requesterPhone as string | undefined,
    requesterRole: body.requesterRole as string | undefined,
    frequency: body.frequency as string | undefined,
    startTimeframe: body.startTimeframe as string | undefined,
    leadSource: body.leadSource as string | undefined,
    clientStatedSqft: body.clientStatedSqft as number | string | undefined,
    siteContactName: body.siteContactName as string | undefined,
    siteContactPhone: body.siteContactPhone as string | undefined,
    siteContactEmail: body.siteContactEmail as string | undefined,
    intakeAnswers: (body.intakeAnswers as Record<string, unknown>) || {},
    notes: body.notes as string | undefined,
    sites: Array.isArray(body.sites) ? (body.sites as Array<{
      nickname?: string; address?: string; city?: string; state?: string; zip?: string; zip_code?: string; clientStatedSqft?: number | string;
    }>) : [],
    actorName: principal?.email || "Admin",
    actorId: principal?.userId ?? null,
    tokenTtlHours: settings.tokenTtlHours,
  });
  if (created.ok === false) {
    return NextResponse.json({ error: created.error }, { status: created.status });
  }

  const request = created.request;
  const firstSite = Array.isArray(request.sites) ? (request.sites[0] as Record<string, unknown> | undefined) : undefined;
  const address = firstSite
    ? [firstSite.address, firstSite.city, firstSite.state].filter(Boolean).join(", ")
    : String(request.requester_company || "your property");

  const mail = await sendProposalEmail(supabase, {
    to: String(request.requester_email),
    subject: settings.pendingEmailSubject,
    body: settings.pendingEmailBody,
    vars: { name: String(request.requester_name || ""), address },
    templateKey: "commercial_proposal_intake",
    trigger: "proposal-request.intake",
    accountId: String(request.business_account_id || "") || null,
    hostId: request.host_id ? String(request.host_id) : null,
  });
  if (mail.ok) {
    await supabase.from("proposal_requests").update({
      requester_pending_email_sent_at: new Date().toISOString(),
      admin_notified_at: new Date().toISOString(),
    }).eq("id", request.id);
  }

  if (settings.adminNotifyEmail && /.+@.+\..+/.test(settings.adminNotifyEmail)) {
    await sendProposalEmail(supabase, {
      to: settings.adminNotifyEmail,
      subject: `New proposal request — ${request.requester_name}`,
      body:
        `A proposal request was submitted for ${address} (${request.property_type_key}). ` +
        `Status: Pending — Assigning Walkthrough Agent. This is not a booking.`,
      vars: { name: "team", address },
      templateKey: "commercial_proposal_intake",
      role: "admin",
      trigger: "proposal-request.admin_notify",
      accountId: String(request.business_account_id || "") || null,
    });
  }

  return NextResponse.json({
    ok: true,
    request,
    requesterEmailed: mail.ok,
    emailError: mail.ok ? undefined : mail.error,
  });
}
