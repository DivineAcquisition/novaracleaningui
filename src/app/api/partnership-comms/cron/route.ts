import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { drainPartnershipQueue } from "@/lib/partnership-comms";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorized(req: Request): Promise<boolean> {
  const provided = req.headers.get("x-cron-secret") || new URL(req.url).searchParams.get("secret") || "";
  if (provided) {
    try {
      const sb = getAdminSupabase();
      const { data } = await sb.from("app_secrets").select("value").eq("key", "CRON_SECRET").maybeSingle();
      const expected = String(data?.value || process.env.CRON_SECRET || "").trim();
      if (expected && provided === expected) return true;
    } catch {
      if (process.env.CRON_SECRET && provided === process.env.CRON_SECRET) return true;
    }
  }
  try {
    await requireAdmin(req);
    return true;
  } catch (e) {
    if (e instanceof AdminAuthError) return false;
    return false;
  }
}

async function run(req: Request): Promise<NextResponse> {
  if (!(await authorized(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const result = await drainPartnershipQueue(getAdminSupabase(), 50);
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request) {
  return run(req);
}
export async function POST(req: Request) {
  return run(req);
}
