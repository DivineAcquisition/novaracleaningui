// ─── POST /api/commercial-accounts/actions (admin/VA only) ──────────────────
//
// Server-side actions for the Partnerships Hub commercial console:
//
//   { action:"save_site", accountId, site:{...} }
//       Upsert a business_sites row + best-effort Airtable Sites sync
//       (linked to the account's Commercial Accounts record).
//   { action:"send_payment_link", accountId }
//       Ensure a Stripe customer, then email the onboarding or portal URL
//       where the client adds a card via the in-page Pre-Auth embed — never
//       a Stripe Checkout session.
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
import { parseSiteZones, serializeSiteZones } from "@/lib/site-zones";
import { syncCommercialAccount, syncSite } from "@/lib/airtable/mappers";
import { generateAgreement } from "@/lib/commercial-agreement-server";
import { onboardingUrl, portalUrl } from "@/lib/commercial-onboarding/session";

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
  photo_zones?: unknown;
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
        photo_zones: (() => {
          const zones = serializeSiteZones(parseSiteZones(site.photo_zones));
          return zones.length ? zones : null;
        })(),
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

    // ── Payment setup link (in-page Pre-Auth embed, never Checkout) ──────
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

      const { data: onboarding } = await supabase
        .from("commercial_onboarding_sessions")
        .select("token, status")
        .eq("business_account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const token = onboarding?.token ? String(onboarding.token) : "";
      const setupUrl = token ? onboardingUrl(token) : `${portalUrl()}/partner`;

      const resendKey = await secret("RESEND_API_KEY");
      let emailed = false;
      if (resendKey) {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from: "Novara Cleaning <hello@novaracleaning.com>",
            to: [account.email],
            reply_to: "contact@novaracleaning.com",
            subject: `Set up payment for ${account.business_name} — Novara Cleaning`,
            html: `<p>Hi ${account.contact_name || "there"},</p><p>To activate cleaning service for <strong>${account.business_name}</strong>, add a payment method on this page. It stays on our site — a Stripe Pre-Auth hold verifies the card and nothing is captured now:</p><p><a href="${setupUrl}">${setupUrl}</a></p><p>— Novara Cleaning</p>`,
          }),
        });
        emailed = res.ok;
      }
      return NextResponse.json({ ok: true, customerId, setupUrl, emailed });
    }

    // ── Service agreement → tokenized signing link ───────────────────────
    //
    // This used to email a completed DocuSeal copy and stamp
    // agreement_signed_at in the same breath, which meant an account counted
    // as under contract on the strength of an email leaving the building. The
    // agreement gate then let dispatch through for a contract nobody had
    // signed.
    //
    // Now it mints the same tokenized signing link the accepted-proposal path
    // uses, and agreement_signed_at is set by the database when the client
    // actually signs. One signing mechanism, one definition of "signed".
    if (action === "send_agreement") {
      if (!account.email) return NextResponse.json({ ok: false, error: "Account has no email." }, { status: 400 });

      // Prefer the accepted proposal — that is the normal path, and its
      // snapshot is what the client agreed to. Falling back to the account's
      // priced sites keeps the button usable for deals that were agreed off
      // -platform.
      const { data: accepted } = await supabase
        .from("commercial_proposals")
        .select("id")
        .eq("business_account_id", accountId)
        .eq("status", "accepted")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const built = await generateAgreement(supabase, {
        proposalId: (accepted as { id?: string } | null)?.id || null,
        accountId,
        signerName: account.contact_name || account.business_name,
        signerEmail: account.email,
        actorName: "Admin",
      });
      if (!built.ok) {
        return NextResponse.json(
          { ok: false, error: built.error, code: "agreement_not_ready" },
          { status: built.status || 409 },
        );
      }

      const { error: mailError } = await supabase.functions.invoke("admin-send-email", {
        body: {
          to: account.email,
          subject: `Service agreement for signature — ${account.business_name}`,
          html: [
            `<p>Hi ${account.contact_name || "there"},</p>`,
            `<p>Your Commercial Cleaning Services Agreement is ready to sign. It's pre-filled, including the schedule of locations and rates in Exhibit A.</p>`,
            `<p><a href="${built.link}">Review and sign the agreement</a></p>`,
            `<p>— Novara Cleaning</p>`,
          ].join(""),
        },
      });

      await supabase.from("commercial_agreements").update({
        sent_at: new Date().toISOString(),
        sent_to: account.email,
        send_count: 1,
      }).eq("id", built.agreementId as string);

      return NextResponse.json({
        ok: true,
        agreementId: built.agreementId,
        link: built.link,
        emailed: !mailError,
        fromProposal: Boolean((accepted as { id?: string } | null)?.id),
      });
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
