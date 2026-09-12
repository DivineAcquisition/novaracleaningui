// ─── /api/admin/proposal-offers ────────────────────────────────────────────
//
// Walk-in send for STR host onboarding and property-manager onboarding.
// Office and commercial stay on /api/admin/proposals create_draft.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { isProposalSendFlow } from "@/lib/proposal-offer-send";
import { searchStrHosts, sendPmOffer, sendStrOffer } from "@/lib/proposal-offer-send-server";

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
  const url = new URL(req.url);
  const view = String(url.searchParams.get("view") || "hosts");
  const q = String(url.searchParams.get("q") || "");
  const supabase = getAdminSupabase();
  if (view === "hosts") {
    const out = await searchStrHosts(supabase, q);
    if (!out.ok) return NextResponse.json({ error: out.message }, { status: out.status });
    return NextResponse.json(out);
  }
  return NextResponse.json({ error: "Unknown view." }, { status: 400 });
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

  const flow = String(body.flow || body.action || "");
  if (!isProposalSendFlow(flow) && flow !== "send_str" && flow !== "send_pm") {
    return NextResponse.json({ error: "Pick STR, office, commercial, or property manager." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const actorName = principal?.email || "Admin";

  if (flow === "str" || flow === "send_str") {
    const result = await sendStrOffer(supabase, {
      hostId: body.hostId ? String(body.hostId) : undefined,
      hostName: String(body.hostName || body.recipientName || ""),
      email: String(body.email || body.recipientEmail || ""),
      phone: body.phone ? String(body.phone) : undefined,
      actorName,
      send: body.send !== false,
      properties: Array.isArray(body.properties) ? body.properties as never : [],
    });
    return NextResponse.json(result.ok ? result : { error: result.message }, { status: result.status });
  }

  if (flow === "property_manager" || flow === "send_pm") {
    const result = await sendPmOffer(supabase, {
      pmAccountId: body.pmAccountId ? String(body.pmAccountId) : undefined,
      companyName: String(body.companyName || body.businessName || ""),
      contactName: String(body.contactName || body.recipientName || ""),
      email: String(body.email || body.recipientEmail || ""),
      phone: body.phone ? String(body.phone) : undefined,
      actorName,
      send: body.send !== false,
      units: Array.isArray(body.units) ? body.units as never : [],
    });
    return NextResponse.json(result.ok ? result : { error: result.message }, { status: result.status });
  }

  return NextResponse.json(
    { error: "Office and commercial send through the existing proposal draft." },
    { status: 400 },
  );
}
