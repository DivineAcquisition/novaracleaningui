import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { PROPOSAL_STATUS_LABELS, formatWhen, walkthroughLink } from "@/lib/proposal-request";
import { loadProposalSettings, sendProposalEmail, sendProposalSms } from "@/lib/proposal-request-server";

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

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();
  const id = params.id;
  const { data: request, error } = await supabase
    .from("proposal_requests")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!request) return NextResponse.json({ error: "Proposal request not found." }, { status: 404 });

  const { data: sites } = await supabase
    .from("proposal_request_sites")
    .select("*")
    .eq("proposal_request_id", id)
    .order("sort_order", { ascending: true });

  const wtIds = (sites || []).map((s: { walkthrough_id?: string | null }) => s.walkthrough_id).filter(Boolean) as string[];
  const { data: walkthroughs } = wtIds.length
    ? await supabase.from("commercial_walkthroughs").select("*").in("id", wtIds)
    : { data: [] };

  const { data: payouts } = await supabase
    .from("walkthrough_payouts")
    .select("*")
    .eq("proposal_request_id", id);

  return NextResponse.json({
    ok: true,
    request: {
      ...request,
      status_label: PROPOSAL_STATUS_LABELS[(request as { status: keyof typeof PROPOSAL_STATUS_LABELS }).status]
        || (request as { status: string }).status,
      sites: sites || [],
      walkthroughs: walkthroughs || [],
      payouts: payouts || [],
    },
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const action = String(body.action || "");
  if (action === "resend_docs") {
    const settings = await loadProposalSettings(supabase);
    const { data: existing } = await supabase
      .from("proposal_requests")
      .select("*")
      .eq("id", params.id)
      .maybeSingle();
    if (!existing) return NextResponse.json({ error: "Proposal request not found." }, { status: 404 });
    const reqRow = existing as Record<string, any>;
    const { data: sites } = await supabase
      .from("proposal_request_sites")
      .select("*")
      .eq("proposal_request_id", params.id)
      .order("sort_order", { ascending: true });
    const wtIds = (sites || []).map((s: { walkthrough_id?: string | null }) => s.walkthrough_id).filter(Boolean) as string[];
    const { data: walkthroughs } = wtIds.length
      ? await supabase.from("commercial_walkthroughs").select("id, assignment_token, site_address").in("id", wtIds)
      : { data: [] as Array<Record<string, unknown>> };
    const links = (walkthroughs || [])
      .map((w: Record<string, any>) => w.assignment_token ? walkthroughLink(String(w.assignment_token)) : null)
      .filter(Boolean) as string[];
    if (!links.length) {
      return NextResponse.json({ error: "Onsite documentation has not been tokenized yet." }, { status: 400 });
    }

    let agentEmailed = false;
    let agentTexted = false;
    if (reqRow.assigned_cleaner_id) {
      const { data: cleaner } = await supabase
        .from("cleaners")
        .select("first_name, last_name, email, phone")
        .eq("id", reqRow.assigned_cleaner_id)
        .maybeSingle();
      const c = (cleaner || {}) as Record<string, any>;
      const agentName = [c.first_name, c.last_name].filter(Boolean).join(" ") || "Walkthrough agent";
      const when = reqRow.scheduled_at
        ? formatWhen(String(reqRow.scheduled_at))
        : { date: "", time: "", label: "the scheduled visit" };
      const address = (sites || [])
        .map((s: Record<string, any>) => [s.address, s.city, s.state].filter(Boolean).join(", ") || s.nickname)
        .filter(Boolean)
        .join("; ") || "the property";
      const mail = await sendProposalEmail(supabase, {
        to: String(c.email || ""),
        subject: settings.agentEmailSubject,
        body: settings.agentEmailBody + (links.length > 1 ? `\n\nAll site links:\n${links.join("\n")}` : ""),
        vars: { agentName, name: agentName, address, date: when.date, time: when.time, link: links[0] },
        templateKey: "walkthrough_agent_assignment",
        role: "walkthrough_agent",
        priority: "urgent",
        trigger: "proposal-request.resend_docs",
      });
      agentEmailed = mail.ok;
      const sms =
        `Novara: walkthrough docs for ${address}. Open the site findings form (auto-saves; office can add too): ${links[0]}`;
      agentTexted = await sendProposalSms(supabase, c.phone, sms, {
        email: c.email ? String(c.email) : null,
        trigger: "proposal-request.resend_docs_sms",
      });
    }

    return NextResponse.json({ ok: true, links, agentEmailed, agentTexted });
  }

  if (action !== "cancel") {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const { data: existing } = await supabase
    .from("proposal_requests")
    .select("id, status")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing) return NextResponse.json({ error: "Proposal request not found." }, { status: 404 });

  await supabase.from("proposal_requests").update({
    status: "cancelled",
    notes: [String((existing as { notes?: string }).notes || ""), String(body.reason || "Cancelled from Proposals tab")]
      .filter(Boolean)
      .join("\n"),
    updated_at: new Date().toISOString(),
  }).eq("id", params.id);

  const { data: sites } = await supabase
    .from("proposal_request_sites")
    .select("walkthrough_id")
    .eq("proposal_request_id", params.id);
  const wtIds = (sites || []).map((s: { walkthrough_id?: string | null }) => s.walkthrough_id).filter(Boolean) as string[];
  if (wtIds.length) {
    await supabase.from("commercial_walkthroughs")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .in("id", wtIds)
      .in("status", ["requested", "scheduled"]);
  }

  await supabase.from("events").insert({
    event_type: "proposal_request.cancelled",
    source: "admin-proposals",
    summary: `Proposal request cancelled by ${principal?.email || "admin"}.`,
    data: { proposal_request_id: params.id },
  });

  return NextResponse.json({ ok: true });
}
