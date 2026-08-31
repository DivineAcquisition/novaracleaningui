import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { loadProposalChecklists } from "@/lib/proposal-request-server";
import {
  mergeChecklists,
  slugTypeKey,
  PROPOSAL_CHECKLISTS_KEY,
  type ChecklistItem,
  type PropertyTypeDef,
} from "@/lib/proposal-request";
import {
  defaultScopeTemplateForType,
  scopeSectionsFromTemplate,
} from "@/lib/proposal-scope-checklists";

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
  const catalog = await loadProposalChecklists(supabase);
  return NextResponse.json({ ok: true, catalog });
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
  const current = await loadProposalChecklists(supabase);
  const action = String(body.action || "save");

  let next = current;

  if (action === "add_type") {
    const key = slugTypeKey(String(body.key || body.label || ""));
    const label = String(body.label || "").trim().slice(0, 80);
    if (!key || !label) {
      return NextResponse.json({ error: "A key and label are required for a new property type." }, { status: 400 });
    }
    if (current.types.some((t) => t.key === key)) {
      return NextResponse.json({ error: "That property type key already exists." }, { status: 409 });
    }
    const def: PropertyTypeDef = {
      key,
      label,
      shortLabel: String(body.shortLabel || label).slice(0, 40),
      accountKind: body.accountKind === "str" || body.accountKind === "office" ? body.accountKind : "commercial",
      facilityTypeKey: String(body.facilityTypeKey || "other").slice(0, 40),
      sort: Math.max(...current.types.map((t) => t.sort), 0) + 10,
      active: true,
    };
    const scopeTemplate = defaultScopeTemplateForType(key, def.accountKind);
    next = {
      ...current,
      types: [...current.types, def],
      intakeByType: { ...current.intakeByType, [key]: [] },
      byType: { ...current.byType, [key]: [] },
      scopeTemplateByType: { ...current.scopeTemplateByType, [key]: scopeTemplate },
      scopeByType: { ...current.scopeByType, [key]: scopeSectionsFromTemplate(scopeTemplate) },
    };
  } else if (action === "save") {
    const catalog = mergeChecklists(body.catalog || body);
    next = catalog;
  } else if (action === "save_items") {
    const typeKey = String(body.typeKey || "");
    const section = String(body.section || "type");
    const items = Array.isArray(body.items) ? (body.items as ChecklistItem[]) : [];
    if (section === "universal") {
      next = { ...current, universal: items };
    } else if (section === "intake") {
      if (!typeKey) return NextResponse.json({ error: "typeKey required." }, { status: 400 });
      next = { ...current, intakeByType: { ...current.intakeByType, [typeKey]: items } };
    } else {
      if (!typeKey) return NextResponse.json({ error: "typeKey required." }, { status: 400 });
      next = { ...current, byType: { ...current.byType, [typeKey]: items } };
    }
  } else {
    return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }

  const { error } = await supabase.from("app_settings").upsert(
    {
      key: PROPOSAL_CHECKLISTS_KEY,
      value: next,
      description:
        "Property-type site findings and light intake. Crew execution lists live on the job-checklist token after dispatch.",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "key" },
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true, catalog: next });
}
