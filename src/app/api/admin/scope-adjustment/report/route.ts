// ─── /api/admin/scope-adjustment/report ──────────────────────────────────
//
// Scope adjustments over time, broken down by reason, by cleaner, and by
// customer. The customer cut is the one that earns its keep: it surfaces the
// account that keeps booking a standard clean for a deep-condition home.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { type ScopeReason } from "@/lib/scope-adjustment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Bucket {
  key: string;
  label: string;
  count: number;
  deltaCents: number;
  unsupported: number;
}

function bump(map: Map<string, Bucket>, key: string, label: string, deltaCents: number, unsupported: boolean) {
  const b = map.get(key) || { key, label, count: 0, deltaCents: 0, unsupported: 0 };
  b.count += 1;
  b.deltaCents += deltaCents;
  if (unsupported) b.unsupported += 1;
  map.set(key, b);
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  const days = Math.min(365, Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 180));
  const since = new Date(Date.now() - days * 86400_000).toISOString();
  const supabase = getAdminSupabase();

  try {
    const { data: rows, error } = await supabase
      .from("scope_adjustments")
      .select(
        "id, booking_id, reason_codes, original_price_cents, adjusted_price_cents, delta_cents, amount_overridden, evidence_missing, evidence_photo_count, status, applied_at, applied_by_name, adjusted_service_type, original_service_type, customer_message, payout_supplement_cents",
      )
      .gte("applied_at", since)
      .order("applied_at", { ascending: false });
    if (error) throw error;

    const adjustments = rows || [];
    const bookingIds = [...new Set(adjustments.map((a) => a.booking_id))];

    const bookingById = new Map<
      string,
      { booking_number: number | null; first_name: string | null; last_name: string | null; email: string | null; cleaner_id: string | null; service_date: string | null }
    >();
    if (bookingIds.length) {
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, booking_number, first_name, last_name, email, cleaner_id, service_date")
        .in("id", bookingIds);
      for (const b of bookings || []) bookingById.set(b.id, b);
    }

    const cleanerIds = [...new Set([...bookingById.values()].map((b) => b.cleaner_id).filter(Boolean))] as string[];
    const cleanerName = new Map<string, string>();
    if (cleanerIds.length) {
      const { data: cleaners } = await supabase.from("cleaners").select("id, name").in("id", cleanerIds);
      for (const c of cleaners || []) cleanerName.set(c.id, c.name || "Unnamed");
    }

    const { data: reasonRows } = await supabase.from("scope_adjustment_reasons").select("*");
    const reasons = (reasonRows || []) as ScopeReason[];
    const reasonLabel = new Map(reasons.map((r) => [r.code, r.label]));

    const byReason = new Map<string, Bucket>();
    const byCleaner = new Map<string, Bucket>();
    const byCustomer = new Map<string, Bucket>();

    for (const a of adjustments) {
      const delta = Number(a.delta_cents || 0);
      const unsupported = a.evidence_missing === true;
      for (const code of a.reason_codes || []) {
        bump(byReason, code, reasonLabel.get(code) || code, delta, unsupported);
      }
      const b = bookingById.get(a.booking_id);
      const cid = b?.cleaner_id || "unassigned";
      bump(byCleaner, cid, cid === "unassigned" ? "Unassigned" : cleanerName.get(cid) || "Unknown", delta, unsupported);
      const custKey = (b?.email || "unknown").toLowerCase();
      const custLabel = [b?.first_name, b?.last_name].filter(Boolean).join(" ") || b?.email || "Unknown";
      bump(byCustomer, custKey, custLabel, delta, unsupported);
    }

    const sortByCount = (a: Bucket, b: Bucket) => b.count - a.count || b.deltaCents - a.deltaCents;

    return NextResponse.json({
      ok: true,
      days,
      totals: {
        count: adjustments.length,
        deltaCents: adjustments.reduce((s, a) => s + Number(a.delta_cents || 0), 0),
        unsupported: adjustments.filter((a) => a.evidence_missing).length,
        overridden: adjustments.filter((a) => a.amount_overridden).length,
        disputed: adjustments.filter((a) => a.status === "disputed").length,
        payoutSupplementCents: adjustments.reduce((s, a) => s + Number(a.payout_supplement_cents || 0), 0),
      },
      byReason: [...byReason.values()].sort(sortByCount),
      byCleaner: [...byCleaner.values()].sort(sortByCount),
      byCustomer: [...byCustomer.values()].sort(sortByCount),
      // Repeat offenders: the pattern worth acting on.
      repeatCustomers: [...byCustomer.values()].filter((c) => c.count > 1).sort(sortByCount),
      recent: adjustments.slice(0, 100).map((a) => {
        const b = bookingById.get(a.booking_id);
        return {
          ...a,
          bookingNumber: b?.booking_number ?? null,
          customerName: [b?.first_name, b?.last_name].filter(Boolean).join(" ") || null,
          serviceDate: b?.service_date ?? null,
          cleanerName: b?.cleaner_id ? cleanerName.get(b.cleaner_id) || null : null,
          reasonLabels: (a.reason_codes || []).map((c: string) => reasonLabel.get(c) || c),
        };
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // eslint-disable-next-line no-console
    console.error("[scope-adjustment:report]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
