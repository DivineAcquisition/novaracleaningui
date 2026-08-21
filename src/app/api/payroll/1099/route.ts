// ─── GET/POST /api/payroll/1099 — Tax-year 1099-NEC prep report ─────────────
//
// Admin/VA gated. Money is integer cents. IRS 1099-NEC federal threshold = $600.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { build1099Report, parseTaxYear } from "@/lib/payroll-1099";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request, taxYearRaw: unknown): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  const taxYear = parseTaxYear(taxYearRaw);
  try {
    const report = await build1099Report(getAdminSupabase(), taxYear);
    return NextResponse.json(report);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to build 1099 report";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  return handle(req, url.searchParams.get("taxYear"));
}

export async function POST(req: Request): Promise<NextResponse> {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return handle(req, body.taxYear);
}
