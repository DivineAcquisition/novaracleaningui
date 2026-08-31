// ─── /api/ops-assistant/knowledge ─────────────────────────────────────────
//
// Admin-editable policy / escalation articles. The How-the-Tool-Works
// guides are not editable here — they version with the code.

import { NextResponse } from "next/server";

import { AdminAuthError } from "@/lib/admin-auth";
import { requireOpsAssistant } from "@/lib/ops-assistant/principal";
import { getOpsSupabase } from "@/lib/ops-assistant/supabase";
import { loadArticles } from "@/lib/ops-assistant/thread";
import { BUILTIN_ARTICLES } from "@/lib/ops-assistant/policy-articles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(err: unknown) {
  if (err instanceof AdminAuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }
  const message = err instanceof Error ? err.message : "Something went wrong.";
  return NextResponse.json({ error: message }, { status: 500 });
}

export async function GET(req: Request) {
  try {
    const principal = await requireOpsAssistant(req);
    const sb = getOpsSupabase();
    const stored = await loadArticles(sb);
    const articles = stored.length ? stored : BUILTIN_ARTICLES;
    return NextResponse.json({
      articles: principal.isAdmin ? articles : articles.filter((a) => !a.adminOnly),
      source: stored.length ? "database" : "seed",
    });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(req: Request) {
  try {
    const principal = await requireOpsAssistant(req);
    if (!principal.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
    const sb = getOpsSupabase();
    if (!sb) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });

    const body = (await req.json()) as Record<string, unknown>;
    const slug = String(body.slug || "")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 80);
    const title = String(body.title || "").trim().slice(0, 160);
    const articleBody = String(body.body || "").trim().slice(0, 8000);
    if (!slug || !title || articleBody.length < 20) {
      return NextResponse.json({ error: "Slug, title and a real body are required." }, { status: 400 });
    }

    const row = {
      slug,
      title,
      category: String(body.category || "Policy").slice(0, 80),
      body: articleBody,
      escalation: Boolean(body.escalation),
      admin_only: Boolean(body.adminOnly),
      updated_by: principal.userId,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await sb
      .from("ops_assistant_articles")
      .upsert(row, { onConflict: "slug" })
      .select("id, slug, title, category, body, escalation, admin_only, updated_at")
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, article: data });
  } catch (err) {
    return fail(err);
  }
}

export async function DELETE(req: Request) {
  try {
    const principal = await requireOpsAssistant(req);
    if (!principal.isAdmin) return NextResponse.json({ error: "Admins only." }, { status: 403 });
    const sb = getOpsSupabase();
    if (!sb) return NextResponse.json({ error: "Database is not configured." }, { status: 503 });
    const url = new URL(req.url);
    const slug = String(url.searchParams.get("slug") || "").trim();
    if (!slug) return NextResponse.json({ error: "slug is required." }, { status: 400 });
    const { error } = await sb.from("ops_assistant_articles").delete().eq("slug", slug);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
