import { NextResponse } from "next/server";

import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendBackfillForms, sendWeekForm } from "@/lib/ad-spend/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

async function resolveSecret(name: string): Promise<string> {
  try {
    const { data } = await getAdminSupabase().from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch {
    /* fall through */
  }
  return (process.env[name] || "").trim();
}

async function authorize(req: Request): Promise<{ ok: boolean; cron?: boolean; error?: string; status?: number }> {
  const cronSecret = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("secret") || "";
  if (cronSecret) {
    const expected = (await resolveSecret("CRON_SECRET")).trim();
    if (expected && cronSecret === expected) return { ok: true, cron: true };
  }
  try {
    await requireAdmin(req);
    return { ok: true };
  } catch (err) {
    const e = err as AdminAuthError;
    return { ok: false, error: e.message, status: e.status || 401 };
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  const auth = await authorize(req);
  if (!auth.ok) {
    return NextResponse.json({ ok: false, error: auth.error || "Unauthorized" }, { status: auth.status || 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    periodStart?: string;
    periodEnd?: string;
    force?: boolean;
  };
  const action = body.action || "send";

  try {
    if (action === "backfill") {
      const report = await sendBackfillForms({ force: Boolean(body.force) });
      return NextResponse.json({ ok: true, ...report });
    }
    if (action === "send") {
      const report = await sendWeekForm({
        periodStart: body.periodStart,
        periodEnd: body.periodEnd,
        force: Boolean(body.force) || Boolean(auth.cron),
      });
      return NextResponse.json({ ok: true, ...report });
    }
    return NextResponse.json({ ok: false, error: `Unsupported action: ${action}` }, { status: 400 });
  } catch (err) {
    console.error("[ad-spend-send]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const provided = new URL(req.url).searchParams.get("secret") || "";
  const expected = await resolveSecret("CRON_SECRET");
  if (!expected || provided !== expected) {
    return NextResponse.json({ ok: false, error: "Not authorised." }, { status: 401 });
  }
  const report = await sendWeekForm({ force: true });
  return NextResponse.json({ ok: true, ...report });
}
