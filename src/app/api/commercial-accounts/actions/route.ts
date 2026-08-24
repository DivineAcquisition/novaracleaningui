// ─── POST /api/commercial-accounts/actions (admin/VA only) ──────────────────
//
// Server-side actions for the Partnerships Hub commercial console:
//
//   { action:"save_site", accountId, site:{...} }
//       Upsert a business_sites row + best-effort Airtable Sites sync
//       (linked to the account's Commercial Accounts record).
//   { action:"send_payment_link", accountId }
//       Ensure a Stripe customer for the account's email, save the id on the
//       account (payment gate), open a Stripe Setup Checkout session, and
//       email the secure link to the contact.
//   { action:"send_agreement", accountId }
//       Send the service agreement via the existing DocuSeal engine
//       (completed-copy pattern used across the app) and stamp
//       agreement_signed_at — the go-live agreement gate.
//   { action:"sync_airtable", accountId }
//       Re-push the account + its sites to Airtable on demand.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { primeAirtablePat } from "@/lib/airtable/sources/prime-pat";
import { syncCommercialAccount, syncSite } from "@/lib/airtable/mappers";
import { sendAgreement, buildOneTimeValues } from "@/lib/docuseal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// deno-friendly local types
interface SiteBody {
  id?: string;
  nickname?: string;
  address?: string;
  city?: string;
  state?: string;
  zip_code?: string;
  facility_type?: string;
  sqft?: number | string;
  restrooms?: number | string;
  floors?: number | string;
  scope_notes?: string;
  access_method?: string;
  access_instructions?: string;
  active?: boolean;
  // Commercial specifics captured ONCE on the site, so every booking against
  // it inherits them instead of re-entering security, dock, and window
  // procedure per visit.
  facility_type_key?: string;
  scope_level?: string;
  breakrooms?: number | string;
  badge_required?: boolean;
  alarm_code?: string;
  security_contact_name?: string;
  security_contact_phone?: string;
  loading_dock_notes?: string;
  after_hours_access_notes?: string;
  service_window_start?: string;
  service_window_end?: string;
  photo_zones?: string[];
}

async function secret(key: string): Promise<string> {
  const supabase = getAdminSupabase();
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    if (data?.value) return String(data.value).trim();
  } catch { /* fall through */ }
  return (process.env[key] || "").trim();
}

const s = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max) || null;
const n = (v: unknown) => {
  const num = parseInt(String(v ?? ""), 10);
  return Number.isFinite(num) && num >= 0 ? num : null;
};

// Minimal Stripe REST helper (no SDK dependency — same pattern as edge fns).
async function stripeCall(
  key: string,
  method: "GET" | "POST",
  path: string,
  params?: Record<string, string>,
): Promise<Record<string, any>> {
  const url = new URL(`https://api.stripe.com/v1/${path}`);
  const init: RequestInit = { method, headers: { Authorization: `Bearer ${key}` } };
  if (params && method === "GET") {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  } else if (params) {
    (init.headers as Record<string, string>)["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(params).toString();
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message || `Stripe ${res.status}`);
  return data;
}

export async function POST(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const accountId = String(body?.accountId || "");
    if (!accountId) return NextResponse.json({ ok: false, error: "accountId required" }, { status: 400 });

    const supabase = getAdminSupabase();
    const { data: account } = await supabase
      .from("business_accounts")
      .select("*")
      .eq("id", accountId)
      .maybeSingle();
    if (!account) return NextResponse.json({ ok: false, error: "Account not found" }, { status: 404 });

    // ── Sites ────────────────────────────────────────────────────────────
    if (action === "save_site") {
      const site = (body?.site || {}) as SiteBody;
      const nickname = s(site.nickname, 120);
      if (!nickname) return NextResponse.json({ ok: false, error: "Site nickname required" }, { status: 400 });
      const patch = {
        business_account_id: accountId,
        nickname,
        address: s(site.address),
        city: s(site.city, 100),
        state: s(site.state, 40),
        zip_code: s(site.zip_code, 20),
        facility_type: s(site.facility_type, 60),
        sqft: n(site.sqft),
        restrooms: n(site.restrooms),
        floors: n(site.floors),
        scope_notes: s(site.scope_notes, 2000),
        access_method: s(site.access_method, 100),
        access_instructions: s(site.access_instructions, 1000),
        active: site.active !== false,
        facility_type_key: s(site.facility_type_key, 40),
        scope_level: s(site.scope_level, 20),
        breakrooms: n(site.breakrooms),
        badge_required: site.badge_required === true,
        alarm_code: s(site.alarm_code, 60),
        security_contact_name: s(site.security_contact_name, 120),
        security_contact_phone: s(site.security_contact_phone, 40),
        loading_dock_notes: s(site.loading_dock_notes, 1000),
        after_hours_access_notes: s(site.after_hours_access_notes, 1000),
        service_window_start: s(site.service_window_start, 8),
        service_window_end: s(site.service_window_end, 8),
        photo_zones: Array.isArray(site.photo_zones) && site.photo_zones.length
          ? site.photo_zones.map((z) => String(z).trim()).filter(Boolean).slice(0, 12)
          : null,
        updated_at: new Date().toISOString(),
      };
      let siteId = site.id ? String(site.id) : null;
      if (siteId) {
        const { error } = await supabase.from("business_sites").update(patch).eq("id", siteId);
        if (error) throw error;
      } else {
        const { data: created, error } = await supabase.from("business_sites").insert(patch).select("id").single();
        if (error) throw error;
        siteId = created.id;
      }
      // Best-effort Airtable Sites sync, linked to the Commercial Account.
      try {
        await primeAirtablePat();
        await syncSite({
          nickname,
          address: [patch.address, patch.city, patch.state, patch.zip_code].filter(Boolean).join(", ") || undefined,
          sqft: patch.sqft ?? undefined,
          facilityType: patch.facility_type ?? undefined,
          restrooms: patch.restrooms ?? undefined,
          floors: patch.floors ?? undefined,
          accessMethod: patch.access_method ?? undefined,
          commercialAccountName: account.business_name,
        });
      } catch (e) {
        console.error("[commercial-actions] airtable site sync failed:", (e as Error).message);
      }
      return NextResponse.json({ ok: true, siteId });
    }

    // ── Payment setup link (Stripe customer + Setup Checkout) ───────────
    if (action === "send_payment_link") {
      if (!account.email) return NextResponse.json({ ok: false, error: "Account has no email." }, { status: 400 });
      const stripeKey = await secret("STRIPE_SECRET_KEY");
      if (!stripeKey) return NextResponse.json({ ok: false, error: "Stripe not configured." }, { status: 500 });

      let customerId = account.stripe_customer_id as string | null;
      if (!customerId) {
        const existing = await stripeCall(stripeKey, "GET", "customers", { email: account.email, limit: "1" });
        customerId = existing?.data?.[0]?.id || null;
      }
      if (!customerId) {
        const created = await stripeCall(stripeKey, "POST", "customers", {
          email: account.email,
          name: account.business_name,
          "metadata[business_account_id]": accountId,
          "metadata[kind]": "commercial",
        });
        customerId = created.id;
      }
      await supabase.from("business_accounts").update({ stripe_customer_id: customerId }).eq("id", accountId);

      const session = await stripeCall(stripeKey, "POST", "checkout/sessions", {
        mode: "setup",
        customer: customerId!,
        "payment_method_types[0]": "card",
        "payment_method_types[1]": "us_bank_account",
        success_url: "https://partner.novaracleaning.com/partner?setup=done",
        cancel_url: "https://partner.novaracleaning.com/partner",
        "metadata[business_account_id]": accountId,
        "metadata[kind]": "commercial_setup",
      });

      // Email the link (best-effort; the URL is also returned to the admin).
      const resendKey = await secret("RESEND_API_KEY");
      let emailed = false;
      if (resendKey && session.url) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Novara Cleaning <hello@novaracleaning.com>",
            to: [account.email],
            reply_to: "contact@novaracleaning.com",
            subject: `Set up payment for ${account.business_name} — Novara Cleaning`,
            html: `<p>Hi ${account.contact_name || "there"},</p><p>To activate cleaning service for <strong>${account.business_name}</strong>, please add a payment method on file using this secure Stripe link:</p><p><a href="${session.url}">${session.url}</a></p><p>Nothing is charged now — this simply keeps a card or bank account on file for invoicing per your agreement.</p><p>— Novara Cleaning Partnerships</p>`,
          }),
        });
        emailed = res.ok;
      }
      return NextResponse.json({ ok: true, customerId, setupUrl: session.url, emailed });
    }

    // ── Service agreement (existing DocuSeal engine) ─────────────────────
    if (action === "send_agreement") {
      if (!account.email) return NextResponse.json({ ok: false, error: "Account has no email." }, { status: 400 });
      const values = buildOneTimeValues({
        name: account.contact_name || account.business_name,
        email: account.email,
        phone: account.phone || undefined,
        address: [account.address, account.city, account.state, account.zip_code].filter(Boolean).join(", ") || account.business_name,
        totalCents: account.default_rate_cents || undefined,
      });
      const result = await sendAgreement({
        audience: "one_time",
        email: account.email,
        name: account.contact_name || account.business_name,
        values,
        metadata: { business_account_id: accountId, kind: "commercial" },
      });
      await supabase.from("business_accounts").update({
        agreement_signed_at: new Date().toISOString(),
      }).eq("id", accountId);
      return NextResponse.json({ ok: true, submissionId: result.submissionId });
    }

    // ── On-demand Airtable re-sync ───────────────────────────────────────
    if (action === "sync_airtable") {
      await primeAirtablePat();
      await syncCommercialAccount({
        businessName: account.business_name,
        accountType: account.account_type === "office" ? "Office" : account.account_type === "partnership" ? "Partnership" : "Commercial",
        accountStatus: account.status === "active" ? "Active" : account.status === "paused" ? "Paused" : account.status === "offboarded" ? "Offboarded" : account.status === "onboarding" ? "Onboarding" : "Prospect",
        serviceFrequency: account.recurring_frequency || undefined,
        monthlyContractValue: account.default_rate_cents != null ? account.default_rate_cents / 100 : undefined,
        stripeCustomerId: account.stripe_customer_id || undefined,
        decisionMakerEmail: account.email || undefined,
      });
      const { data: sites } = await supabase.from("business_sites").select("*").eq("business_account_id", accountId).eq("active", true);
      for (const st of sites || []) {
        await syncSite({
          nickname: st.nickname,
          address: [st.address, st.city, st.state, st.zip_code].filter(Boolean).join(", ") || undefined,
          sqft: st.sqft ?? undefined,
          facilityType: st.facility_type ?? undefined,
          restrooms: st.restrooms ?? undefined,
          floors: st.floors ?? undefined,
          accessMethod: st.access_method ?? undefined,
          commercialAccountName: account.business_name,
        }).catch(() => null);
      }
      return NextResponse.json({ ok: true, sites: (sites || []).length });
    }

    return NextResponse.json({ ok: false, error: `Unknown action '${action}'` }, { status: 400 });
  } catch (err) {
    if (err instanceof AdminAuthError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    }
    console.error("[commercial-accounts/actions]", (err as Error).message);
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 500 });
  }
}
