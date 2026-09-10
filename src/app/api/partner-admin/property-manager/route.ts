// ─── /api/partner-admin/property-manager ───────────────────────────────────
//
// Admin side of the Property Manager relationship: send the tokenized
// onboarding link, work the unit review queue, tune the portfolio volume
// discount, and issue a period's consolidated invoice.
//
// The review queue is deliberately small by design. A unit only lands here
// when it is materially outside the residential size bands or the manager
// flagged it, so this should be a trickle rather than a workload — if it is
// not, the auto-price bounds are wrong, not the queue.

import { NextResponse } from "next/server";

import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { issueConsolidatedInvoice, lastClosedPeriod, type InvoiceCycle } from "@/lib/property-manager/billing";
import {
  pmOnboardingAttention,
  pmUnitsAwaitingReview,
  sendPmOnboardingLink,
  startPmOnboardingSession,
} from "@/lib/property-manager/onboarding/admin";
import { onboardingUrl } from "@/lib/property-manager/onboarding/session";
import { DEFAULT_VOLUME_DISCOUNTS, type VolumeDiscountTier } from "@/lib/property-manager/pricing";
import { loadVolumeDiscounts } from "@/lib/property-manager/pricing-server";
import { approveUnit, publicUnit, registerUnit, repricePortfolio, UNIT_COLS } from "@/lib/property-manager/registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = Record<string, unknown>;

const DISCOUNT_KEY = "property_manager_volume_discounts";

function numOrNull(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function unauthorized(err: unknown): NextResponse {
  const e = err as AdminAuthError;
  return NextResponse.json({ error: e.message }, { status: e.status || 401 });
}

/**
 * Normalize a submitted tier table before it can reprice anyone's portfolio.
 * A malformed row here would silently move real money, so anything that isn't
 * a usable threshold/percent pair is dropped rather than coerced.
 */
function cleanTiers(raw: unknown): VolumeDiscountTier[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  return raw
    .map((t) => {
      const row = (t || {}) as Row;
      const min = Math.floor(Number(row.min_units));
      const percent = Number(row.percent);
      if (!Number.isFinite(min) || min < 0) return null;
      if (!Number.isFinite(percent) || percent < 0 || percent > 99) return null;
      if (seen.has(min)) return null;
      seen.add(min);
      const label = String(row.label ?? "").trim().slice(0, 60);
      return { min_units: min, percent, label: label || undefined } as VolumeDiscountTier;
    })
    .filter((t): t is VolumeDiscountTier => !!t)
    .sort((a, b) => a.min_units - b.min_units);
}

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (err) {
    return unauthorized(err);
  }

  const supabase = getAdminSupabase();
  const accountId = new URL(req.url).searchParams.get("accountId") || "";
  const [attention, review, discounts, accountsRes, unitCountRes] = await Promise.all([
    pmOnboardingAttention(supabase),
    pmUnitsAwaitingReview(supabase),
    loadVolumeDiscounts(supabase),
    supabase
      .from("property_manager_accounts")
      .select(
        "id, company_name, contact_name, email, phone, status, billing_method, invoice_cycle, net_terms, " +
          "volume_discount_percent, volume_discount_label, portal_provisioned_at, created_at",
      )
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("property_manager_units")
      .select("pm_account_id, status")
      .neq("status", "inactive"),
  ]);

  const counts = new Map<string, { unitCount: number; activeUnits: number; pendingReview: number }>();
  for (const raw of unitCountRes.data || []) {
    const u = raw as Row;
    const id = String(u.pm_account_id || "");
    if (!id) continue;
    const cur = counts.get(id) || { unitCount: 0, activeUnits: 0, pendingReview: 0 };
    cur.unitCount += 1;
    if (u.status === "active") cur.activeUnits += 1;
    if (u.status === "pending_review") cur.pendingReview += 1;
    counts.set(id, cur);
  }

  let units: ReturnType<typeof publicUnit>[] | undefined;
  if (accountId) {
    const { data: unitRows } = await supabase
      .from("property_manager_units")
      .select(UNIT_COLS)
      .eq("pm_account_id", accountId)
      .neq("status", "inactive")
      .order("created_at", { ascending: true });
    units = ((unitRows || []) as unknown as Row[]).map((u) => publicUnit(u));
  }

  return NextResponse.json({
    ok: true,
    accounts: ((accountsRes.data || []) as unknown as Row[]).map((a) => ({
      ...a,
      ...(counts.get(String(a.id)) || { unitCount: 0, activeUnits: 0, pendingReview: 0 }),
    })),
    attention,
    reviewQueue: (review as Row[]).map((u) => ({
      ...publicUnit(u),
      pmAccountId: String(u.pm_account_id),
      company: (u.property_manager_accounts as Row | null)?.company_name || null,
      flaggedNonStandard: !!u.flagged_non_standard,
      createdAt: u.created_at,
    })),
    discounts,
    defaultDiscounts: DEFAULT_VOLUME_DISCOUNTS,
    units,
  });
}

export async function POST(req: Request): Promise<NextResponse> {
  let principal;
  try {
    principal = await requireAdmin(req);
  } catch (err) {
    return unauthorized(err);
  }

  const body = (await req.json().catch(() => ({}))) as Row;
  const action = String(body.action || "");
  const supabase = getAdminSupabase();
  const actorName = principal.email;

  if (action === "create_account") {
    const companyName = String(body.companyName || body.name || "").trim();
    const contactName = String(body.contactName || "").trim();
    const email = String(body.email || "").trim();
    const phone = String(body.phone || "").trim();
    if (!companyName || !contactName || !email) {
      return NextResponse.json({ error: "companyName, contactName, and email are required." }, { status: 400 });
    }
    const { data: existing } = await supabase
      .from("property_manager_accounts")
      .select("id, company_name")
      .ilike("email", email)
      .limit(1)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: `An account with that email already exists (${(existing as Row).company_name}).` },
        { status: 409 },
      );
    }
    const { data, error } = await supabase
      .from("property_manager_accounts")
      .insert({
        company_name: companyName.slice(0, 200),
        contact_name: contactName.slice(0, 120),
        email: email.slice(0, 200),
        phone: phone ? phone.slice(0, 40) : null,
        created_by_name: actorName,
      })
      .select("id, company_name, contact_name, email, phone, status")
      .single();
    if (error || !data) {
      return NextResponse.json({ error: error?.message || "Could not create that account." }, { status: 400 });
    }
    await supabase.from("events").insert({
      event_type: "property_manager.account.created",
      source: "partner-admin",
      summary: `${actorName} created property manager ${companyName} (${email}).`,
      data: { pm_account_id: (data as Row).id },
    });
    return NextResponse.json({ ok: true, account: data });
  }

  if (action === "add_unit") {
    const pmAccountId = String(body.pmAccountId || body.accountId || "");
    if (!pmAccountId) {
      return NextResponse.json({ error: "pmAccountId is required." }, { status: 400 });
    }
    const result = await registerUnit(supabase, {
      pmAccountId,
      unitLabel: (body.unitLabel as string) || null,
      address: String(body.address || ""),
      city: (body.city as string) || null,
      state: (body.state as string) || null,
      zipCode: (body.zipCode as string) || (body.zip as string) || null,
      sqft: numOrNull(body.sqft),
      bedrooms: numOrNull(body.bedrooms),
      bathrooms: numOrNull(body.bathrooms),
      accessMethod: (body.accessMethod as string) || null,
      accessNotes: (body.accessNotes as string) || null,
      notes: (body.notes as string) || null,
      flaggedNonStandard: body.flaggedNonStandard === true || body.flaggedForReview === true,
      source: "admin",
      actorName,
    });
    return NextResponse.json(result, { status: result.status });
  }

  if (action === "send" || action === "send_pm_onboarding") {
    const pmAccountId = String(body.pmAccountId || "");
    if (!pmAccountId) {
      return NextResponse.json({ error: "pmAccountId is required." }, { status: 400 });
    }
    const result = await startPmOnboardingSession(supabase, {
      pmAccountId,
      actorName,
      recipientName: (body.recipientName as string) || null,
      recipientEmail: (body.recipientEmail as string) || null,
      recipientPhone: (body.recipientPhone as string) || null,
      send: body.send !== false,
    });
    return NextResponse.json(result, { status: result.status });
  }

  if (action === "nudge") {
    const sessionId = String(body.sessionId || "");
    if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
    const { data: session } = await supabase
      .from("property_manager_onboarding_sessions")
      .select("id, token, pm_account_id, recipient_name, recipient_email, recipient_phone, unit_snapshot")
      .eq("id", sessionId)
      .maybeSingle();
    const s = (session || null) as Row | null;
    if (!s?.token) {
      return NextResponse.json({ error: "No live link on that session." }, { status: 404 });
    }
    const { data: account } = await supabase
      .from("property_manager_accounts")
      .select("company_name")
      .eq("id", s.pm_account_id as string)
      .maybeSingle();
    const sent = await sendPmOnboardingLink(supabase, {
      sessionId: String(s.id),
      pmAccountId: String(s.pm_account_id),
      companyName: String((account as Row | null)?.company_name || s.recipient_name || "your portfolio"),
      recipientName: (s.recipient_name as string) || null,
      recipientEmail: String(s.recipient_email || ""),
      recipientPhone: (s.recipient_phone as string) || null,
      link: onboardingUrl(String(s.token)),
      unitCount: Array.isArray(s.unit_snapshot) ? s.unit_snapshot.length : 0,
      reminder: true,
    });
    return NextResponse.json({ ok: true, ...sent });
  }

  if (action === "approve_unit") {
    const unitId = String(body.unitId || "");
    if (!unitId) return NextResponse.json({ error: "unitId is required." }, { status: 400 });
    const manual = (body.manualRates || null) as Row | null;
    const result = await approveUnit(supabase, {
      unitId,
      sqft: numOrNull(body.sqft),
      bedrooms: numOrNull(body.bedrooms),
      bathrooms: numOrNull(body.bathrooms),
      zipCode: (body.zipCode as string) || null,
      manualRates: manual
        ? {
            move_out: numOrNull(manual.move_out) ?? undefined,
            move_in: numOrNull(manual.move_in) ?? undefined,
            standard: numOrNull(manual.standard) ?? undefined,
          }
        : undefined,
      clearNonStandardFlag: body.clearNonStandardFlag !== false,
      reviewNote: (body.reviewNote as string) || null,
      actorName,
    });
    return NextResponse.json(result, { status: result.status });
  }

  if (action === "reprice") {
    const pmAccountId = String(body.pmAccountId || "");
    if (!pmAccountId) {
      return NextResponse.json({ error: "pmAccountId is required." }, { status: 400 });
    }
    const result = await repricePortfolio(supabase, pmAccountId, { actorName });
    return NextResponse.json({ ok: result.ok, ...result });
  }

  if (action === "set_discount_tiers") {
    const tiers = cleanTiers(body.tiers);
    if (tiers.length === 0) {
      return NextResponse.json(
        { error: "Give at least one usable tier: a unit threshold and a percent between 0 and 99." },
        { status: 400 },
      );
    }
    const value = { enabled: body.enabled !== false, tiers };
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: DISCOUNT_KEY, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    // A tier change moves the standing rate on every registered unit, so the
    // registry is rewritten now rather than drifting until someone books.
    // Cleaner pay is unaffected either way: it comes off the pre-discount
    // list value, which this does not touch.
    const { data: accounts } = await supabase
      .from("property_manager_accounts")
      .select("id")
      .neq("status", "inactive");
    let repriced = 0;
    for (const a of (accounts || []) as Row[]) {
      const r = await repricePortfolio(supabase, String(a.id), { actorName });
      repriced += r.repriced;
    }

    await supabase.from("events").insert({
      event_type: "property_manager.discount_tiers_updated",
      source: "partner-admin",
      summary: `${actorName} updated the portfolio volume discount tiers; ${repriced} unit rates rewritten.`,
      data: { tiers, enabled: value.enabled, repriced },
    });

    return NextResponse.json({
      ok: true,
      tiers,
      enabled: value.enabled,
      repricedUnits: repriced,
      message: `Saved. ${repriced} unit rate${repriced === 1 ? "" : "s"} rewritten at the new tiers.`,
    });
  }

  if (action === "issue_invoice") {
    const pmAccountId = String(body.pmAccountId || "");
    if (!pmAccountId) {
      return NextResponse.json({ error: "pmAccountId is required." }, { status: 400 });
    }
    const period =
      body.periodStart && body.periodEnd
        ? {
            start: String(body.periodStart),
            end: String(body.periodEnd),
            label: String(body.periodLabel || `${body.periodStart} – ${body.periodEnd}`),
          }
        : undefined;
    const result = await issueConsolidatedInvoice(supabase, {
      pmAccountId,
      period,
      actorName,
      dryRun: body.dryRun === true,
    });
    return NextResponse.json(result, { status: result.status });
  }

  if (action === "issue_all_invoices") {
    const { data: accounts } = await supabase
      .from("property_manager_accounts")
      .select("id, company_name, invoice_cycle")
      .eq("status", "active");
    const results: Row[] = [];
    for (const a of (accounts || []) as Row[]) {
      const cycle = (String(a.invoice_cycle || "monthly") as InvoiceCycle) || "monthly";
      const result = await issueConsolidatedInvoice(supabase, {
        pmAccountId: String(a.id),
        period: lastClosedPeriod(cycle),
        actorName,
        dryRun: body.dryRun === true,
      });
      results.push({ pmAccountId: a.id, company: a.company_name, ...result });
    }
    return NextResponse.json({ ok: true, issued: results });
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
}
