// ─── /api/admin/checklists ───────────────────────────────────────────────
//
// The addressable checklist items, their version history, and their health.
//
//   GET  → items (live wording), health rollup, settings
//   POST { action: "sync" }     → seed/refresh items from the code catalog
//   POST { action: "edit", … }  → versioned edit of one item
//
// Sync only ever adds items and refreshes membership/area metadata. It never
// overwrites wording an admin has edited from the review queue — the catalog
// is the origin record, the DB row is the live standard.
//
// Admin/VA only.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { CATALOG_ITEMS } from "@/lib/checklist-catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_KEY = "checklist_feedback_settings";

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
  const [items, health, settings, versions] = await Promise.all([
    supabase
      .from("checklist_items")
      .select("item_id, area, checklists, item_text, photo_required, active, current_version, origin, catalog_text, updated_at")
      .order("item_id"),
    supabase.from("checklist_item_health").select("*"),
    supabase.from("app_settings").select("value").eq("key", SETTINGS_KEY).maybeSingle(),
    supabase
      .from("checklist_item_versions")
      .select("id, item_id, version, item_text, change_summary, source_insight_id, changed_by_name, created_at")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  if (items.error) return NextResponse.json({ error: items.error.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    items: items.data || [],
    health: health.data || [],
    versions: versions.data || [],
    settings: settings.data?.value || null,
    catalogCount: CATALOG_ITEMS.length,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure || !principal) return failure!;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const supabase = getAdminSupabase();

  if (action === "sync") {
    const { data: existing, error } = await supabase
      .from("checklist_items")
      .select("item_id, origin");
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const edited = new Set(
      (existing || []).filter((r) => r.origin === "admin").map((r) => r.item_id),
    );

    const rows = CATALOG_ITEMS.map((item) => ({
      item_id: item.id,
      area: item.area,
      checklists: item.checklists,
      photo_required: Boolean(item.photoRequired),
      catalog_text: item.text,
      // An item an admin has already reworded keeps its wording; only the
      // catalog origin text and membership refresh.
      ...(edited.has(item.id) ? {} : { item_text: item.text }),
      updated_at: new Date().toISOString(),
    }));

    const { error: upsertErr } = await supabase
      .from("checklist_items")
      .upsert(rows, { onConflict: "item_id" });
    if (upsertErr) return NextResponse.json({ error: upsertErr.message }, { status: 500 });

    // Seed v1 history for anything that has none, so every live item has a
    // full chain rather than appearing from nowhere at v2.
    const { data: haveV1 } = await supabase
      .from("checklist_item_versions")
      .select("item_id")
      .eq("version", 1);
    const seeded = new Set((haveV1 || []).map((r) => r.item_id));
    const v1 = CATALOG_ITEMS.filter((i) => !seeded.has(i.id)).map((item) => ({
      item_id: item.id,
      version: 1,
      item_text: item.text,
      area: item.area,
      photo_required: Boolean(item.photoRequired),
      checklists: item.checklists,
      change_summary: "Edition 1.0 baseline — Standard Cleaning Checklists (STR / Office / Commercial).",
      changed_by_name: "Catalog baseline",
    }));
    if (v1.length > 0) {
      const { error: vErr } = await supabase.from("checklist_item_versions").insert(v1);
      if (vErr) return NextResponse.json({ error: vErr.message }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      synced: rows.length,
      preservedEdits: edited.size,
      seededVersions: v1.length,
    });
  }

  if (action === "edit") {
    const itemId = String(body.itemId || "").trim();
    const itemText = String(body.itemText || "").trim();
    const changeSummary = String(body.changeSummary || "").trim();
    const insightId = body.insightId ? String(body.insightId) : null;
    const photoRequired = typeof body.photoRequired === "boolean" ? body.photoRequired : null;

    if (!itemId) return NextResponse.json({ error: "itemId is required." }, { status: 400 });
    if (!itemText) return NextResponse.json({ error: "A checklist item cannot be blank." }, { status: 400 });
    if (!changeSummary) {
      return NextResponse.json(
        { error: "Record what changed and why — the edit is kept in version history." },
        { status: 400 },
      );
    }

    const { data, error } = await supabase.rpc("apply_checklist_item_edit", {
      p_item_id: itemId,
      p_item_text: itemText,
      p_photo_required: photoRequired,
      p_change_summary: changeSummary,
      p_source_insight_id: insightId,
      p_actor_id: principal.userId,
      p_actor_name: principal.email,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ ok: true, version: data });
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
}
