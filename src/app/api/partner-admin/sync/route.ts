// ─── POST /api/partner-admin/sync ─────────────────────────────────────────────
//
// Reconciles the operational STR data in Supabase (the turnover portal: hosts +
// properties) INTO the Airtable "Client & Revenue Ops" base that powers the Host
// Accounts management view — so the two halves of the Partnerships tab stay one
// dataset. Identity-only sync (host contact + property nickname/address/beds +
// host link); pricing, lifecycle, and status remain owned by Airtable so a
// backfill never clobbers admin-set rates.
//
// Admin/VA gated. Safe to run repeatedly (idempotent upserts on email / nickname).

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { syncClient, syncProperty, invalidatePartnerSnapshot, CLIENT_TYPE } from "@/lib/airtable";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function resolveSecret(name: string): Promise<string> {
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_secrets").select("value").eq("key", name).maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch {
    /* fall through */
  }
  return (process.env[name] || "").trim();
}

export async function POST(req: Request): Promise<NextResponse> {
  // Allow either an admin/VA session OR the shared secret (DB trigger / cron).
  const provided = new URL(req.url).searchParams.get("secret") || req.headers.get("x-partner-secret") || "";
  const expected = await resolveSecret("PARTNER_SYNC_SECRET");
  const viaSecret = !!expected && provided === expected;
  if (!viaSecret) {
    try {
      await requireAdmin(req);
    } catch (err) {
      const e = err as AdminAuthError;
      return NextResponse.json({ error: e.message }, { status: e.status || 401 });
    }
  }

  try {
    const supabase = getAdminSupabase();

    const [{ data: hosts, error: hErr }, { data: properties, error: pErr }] = await Promise.all([
      supabase.from("hosts").select("id, name, email, phone, status"),
      supabase.from("properties").select("id, nickname, address, bedrooms, bathrooms, host_id"),
    ]);
    if (hErr) throw new Error(`Read hosts failed: ${hErr.message}`);
    if (pErr) throw new Error(`Read properties failed: ${pErr.message}`);

    const hostById = new Map<string, { email: string | null; name: string | null }>();
    let hostsSynced = 0;
    const warnings: string[] = [];

    for (const h of hosts || []) {
      hostById.set(h.id as string, { email: (h.email as string) || null, name: (h.name as string) || null });
      if (!h.email) continue; // email is the Airtable merge key
      try {
        await syncClient({
          email: String(h.email),
          name: (h.name as string) || String(h.email),
          phone: (h.phone as string) || undefined,
          type: CLIENT_TYPE.strHost,
        });
        hostsSynced += 1;
      } catch (err) {
        warnings.push(`Host ${h.email}: ${(err as Error).message}`);
      }
    }

    let propertiesSynced = 0;
    for (const p of properties || []) {
      const nickname = (p.nickname as string)?.trim();
      if (!nickname) continue; // nickname is the Airtable merge key
      const host = p.host_id ? hostById.get(p.host_id as string) : undefined;
      try {
        await syncProperty({
          nickname,
          address: (p.address as string) || undefined,
          bedrooms: typeof p.bedrooms === "number" ? p.bedrooms : undefined,
          bathrooms: typeof p.bathrooms === "number" ? p.bathrooms : undefined,
          // Identity + host link only — Airtable owns rates/status/lifecycle.
          hostEmail: host?.email || undefined,
        });
        propertiesSynced += 1;
      } catch (err) {
        warnings.push(`Property ${nickname}: ${(err as Error).message}`);
      }
    }

    // Next Host Accounts read reflects the backfill immediately.
    invalidatePartnerSnapshot();

    return NextResponse.json({
      ok: true,
      hostsSynced,
      propertiesSynced,
      warnings: warnings.slice(0, 20),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[partner-admin/sync]", (err as Error).message);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
