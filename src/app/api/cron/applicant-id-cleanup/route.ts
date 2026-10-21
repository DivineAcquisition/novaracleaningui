import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { runApplicantIdCleanup } from "@/lib/contractor-intake/run-id-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: Request): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret") || "";
  if (!provided) return false;
  try {
    const sb = getAdminSupabase();
    const { data } = await sb.from("app_secrets").select("value").eq("key", "CRON_SECRET").maybeSingle();
    const expected = String(data?.value || process.env.CRON_SECRET || "").trim();
    return Boolean(expected) && provided === expected;
  } catch {
    return Boolean(process.env.CRON_SECRET) && provided === process.env.CRON_SECRET;
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  if (!(await authorized(req))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const result = await runApplicantIdCleanup(getAdminSupabase(), { dryRun: false });
  return NextResponse.json({ ok: true, ...result });
}
