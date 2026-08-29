import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { loadProposalSettings } from "@/lib/proposal-request-server";
import { mergeProposalSettings, PROPOSAL_SETTINGS_KEY } from "@/lib/proposal-request";

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
  const settings = await loadProposalSettings(getAdminSupabase());
  return NextResponse.json({ ok: true, settings });
}

export async function PUT(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const supabase = getAdminSupabase();
  const current = await loadProposalSettings(supabase);
  const next = mergeProposalSettings({
    ...current,
    ...((body.settings && typeof body.settings === "object" ? body.settings : body) as object),
  });

  const { error } = await supabase.from("app_settings").upsert(
    {
      key: PROPOSAL_SETTINGS_KEY,
      value: next,
      description:
        "Proposal request emails, walkthrough agent pay (flat or hourly), and token lifetime. Admin-editable from the Proposals tab.",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, settings: next });
}
