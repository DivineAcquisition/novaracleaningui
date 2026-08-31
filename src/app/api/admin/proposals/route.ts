// ─── /api/admin/proposals ──────────────────────────────────────────────────
//
// The back end for the commercial deal pipeline: Firm Price Ready → Proposal
// Sent → Proposal Accepted → Agreement Signed → Billing Configured →
// Dispatch-Eligible.
//
//   GET  ?view=pipeline      every commercial account by stage
//        ?accountId=…        one deal: readiness, every proposal version and
//                            its sites, agreements, billing, COI deliveries
//        ?proposalId=…       one proposal with its snapshot rows
//
//   POST { action: … }
//     create_draft        build the next version from walkthrough-priced
//                         sites (admin can type a rate when a site has none).
//                         Pass send:true to mint the link and email in the
//                         same click. A portal login is not required to send.
//     invite_portal       optional — create / link a client portal login
//     update_draft        edit recipient, cadence, billing method, sites
//     send                mint the link and email the decision-maker
//     resend              same link, fresh expiry
//     withdraw            pull a live proposal
//     acknowledge_changes mark a change request as picked up
//     generate_agreement  build the Agreement from an ACCEPTED proposal —
//                         Exhibit A comes from the proposal's own rows
//     send_agreement      mint the signing link and email the signer
//     countersign         record the Company side
//     save_billing        admin-side billing setup (usually the invoiced path)
//     send_company_coi    deliver our certificate to the client on request
//
// Admin/VA only. Nothing here can mark a proposal accepted or an agreement
// signed — those transitions belong to the client, on their own tokenized
// page, and are the only evidence that either actually happened.

import { NextResponse } from "next/server";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { loadCommercialConfigServer } from "@/lib/commercial-pricing-server";
import { computeCommercialQuote } from "@/lib/commercial-pricing";
import {
  estimatedMonthlyCents,
  money,
  proposalPrefillFromWalkthrough,
  proposalUrl,
  agreementUrl,
  siteRateCentsFromWalkthrough,
  totalPerVisitCents,
  visitsPerMonth,
  type ProposalSite,
} from "@/lib/commercial-proposal";
import { inviteCommercialPortalUser } from "@/lib/commercial-onboarding/portal";
import {
  generateAgreement,
  mapBillingTerms,
  row,
  rows,
  AGREEMENT_COLS,
  PROPOSAL_COLS,
  PROPOSAL_SITE_COLS as SITE_COLS,
} from "@/lib/commercial-agreement-server";
import { sendCompanyCoi } from "@/lib/company-coi";
import {
  changeBillingMethod,
  onboardingAttention,
  sendOnboardingLink,
  startOnboardingSession,
} from "@/lib/commercial-onboarding/admin";
import { onboardingUrl } from "@/lib/commercial-onboarding/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guard(req: Request) {
  try {
    return { principal: await requireAdmin(req), failure: null as NextResponse | null };
  } catch (e) {
    const err = e as AdminAuthError;
    return {
      principal: null,
      failure: NextResponse.json({ error: err.message }, { status: err.status || 401 }),
    };
  }
}

const s = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max) || null;
const int = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};

type Supa = ReturnType<typeof getAdminSupabase>;

async function loadProposalSource(supabase: Supa, accountId: string): Promise<{
  request: Record<string, unknown> | null;
  walkthroughsBySite: Map<string, Record<string, unknown>>;
}> {
  const walkthroughsBySite = new Map<string, Record<string, unknown>>();
  let request: Record<string, unknown> | null = null;
  try {
    const [{ data: reqRow }, { data: walkthroughs }] = await Promise.all([
      supabase
        .from("proposal_requests")
        .select("id, requester_name, requester_email, requester_phone, desired_frequency, notes, property_type_key")
        .eq("business_account_id", accountId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("commercial_walkthroughs")
        .select(
          "id, business_site_id, sqft, scope_level, facility_type_key, formula_price_cents, " +
          "recommended_crew_size, service_window_start, service_window_end, status, conducted_at",
        )
        .eq("business_account_id", accountId)
        .order("conducted_at", { ascending: false }),
    ]);
    request = reqRow as Record<string, unknown> | null;
    for (const wt of (walkthroughs || []) as Array<Record<string, unknown>>) {
      const sid = String(wt.business_site_id || "");
      if (!sid || walkthroughsBySite.has(sid)) continue;
      walkthroughsBySite.set(sid, wt);
    }
  } catch {
    // Hosted environments without the proposal-request tables still send.
  }
  return { request, walkthroughsBySite };
}

function mergeSiteFromWalkthrough(
  site: Record<string, unknown>,
  wt: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!wt) return site;
  return {
    ...site,
    walkthrough_id: site.walkthrough_id || wt.id,
    sqft: site.sqft ?? wt.sqft,
    scope_level: site.scope_level || wt.scope_level,
    facility_type: site.facility_type || wt.facility_type_key,
    crew_size: site.crew_size ?? wt.recommended_crew_size,
    service_window_start: site.service_window_start ?? wt.service_window_start,
    service_window_end: site.service_window_end ?? wt.service_window_end,
    formula_price_cents: wt.formula_price_cents ?? null,
    walkthrough_status: wt.status ?? null,
  };
}

async function emailOut(
  supabase: Supa,
  args: { to: string; subject: string; html: string },
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.functions.invoke("admin-send-email", {
    body: { to: args.to, subject: args.subject, html: args.html },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

function paragraphs(lines: string[]): string {
  return lines.map((l) => `<p>${l}</p>`).join("");
}

const EMAIL_SIGN = "— Novara Cleaning";

async function sendProposal(
  supabase: Supa,
  proposalId: string,
  toOverride?: string | null,
): Promise<
  | { ok: true; link: string; emailed: boolean; emailError: string | null; expiresAt: string; version: number; totalPerVisitCents: number }
  | { ok: false; error: string; status: number }
> {
  const { data: proposal } = await supabase.from("commercial_proposals")
    .select(PROPOSAL_COLS).eq("id", proposalId).maybeSingle();
  const p = row<Record<string, unknown>>(proposal);
  if (!p) return { ok: false, error: "Proposal not found.", status: 404 };

  if (!["draft", "sent"].includes(String(p.status))) {
    return {
      ok: false,
      error: `A ${String(p.status).replace(/_/g, " ")} proposal cannot be sent. Build a new version.`,
      status: 409,
    };
  }

  const to = s(toOverride, 200) || (p.recipient_email as string | null);
  if (!to) {
    return {
      ok: false,
      error: "No recipient email on this proposal — add the decision-maker's address first.",
      status: 400,
    };
  }

  const { data: account } = await supabase.from("business_accounts")
    .select("business_name").eq("id", p.business_account_id as string).maybeSingle();

  const { data: days } = await supabase.rpc("commercial_proposal_setting_int", {
    p_key: "proposal_expiry_days", p_default: 14,
  });
  const expiryDays = Number(days) || 14;
  const expiresAt = new Date(Date.now() + expiryDays * 86400_000).toISOString();

  // Resending keeps the same link — the recipient may have the first email
  // still open — but pushes the expiry out.
  let token = p.token as string | null;
  if (!token) {
    const { data: minted } = await supabase.rpc("mint_commercial_token");
    token = String(minted || "");
  }
  if (!token) return { ok: false, error: "Could not mint a link.", status: 500 };

  const { error } = await supabase.from("commercial_proposals").update({
    status: "sent",
    token,
    expires_at: expiresAt,
    sent_at: new Date().toISOString(),
    sent_to: to,
    recipient_email: to,
    send_count: Number(p.send_count || 0) + 1,
  }).eq("id", proposalId);
  if (error) return { ok: false, error: error.message, status: 400 };

  const link = proposalUrl(token);
  const name = (p.recipient_name as string | null) || "there";
  const business = (account as { business_name?: string } | null)?.business_name || "your facilities";
  const monthly = p.estimated_monthly_cents
    ? ` Estimated at ${money(Number(p.estimated_monthly_cents))} per month across every location.`
    : "";

  const mail = await emailOut(supabase, {
    to,
    subject: `Cleaning proposal for ${business} — Novara Cleaning`,
    html: paragraphs([
      `Hi ${name},`,
      `Your cleaning proposal for <strong>${business}</strong> is ready to review.${monthly}`,
      `It lists every location, the scope and crew we'd assign, and the per-visit rate — nothing to sign, and no payment details requested at this stage.`,
      `<a href="${link}">Review the proposal</a>`,
      `If anything needs adjusting, there's a "Request changes" option on the page — tell us what to change and we'll send a revised version.`,
      `This proposal is open until ${new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.`,
      EMAIL_SIGN,
    ]),
  });

  await supabase.from("events").insert({
    event_type: "commercial.proposal.sent",
    source: "admin-proposals",
    summary: `Proposal v${p.version} sent to ${to} for ${business} — ${money(Number(p.total_per_visit_cents || 0))} per visit across all sites.`,
    data: { proposal_id: proposalId, account_id: p.business_account_id, version: p.version, to, emailed: mail.ok },
  });

  return {
    ok: true,
    link,
    emailed: mail.ok,
    emailError: mail.error || null,
    expiresAt,
    version: Number(p.version || 1),
    totalPerVisitCents: Number(p.total_per_visit_cents || 0),
  };
}

// ─── GET ───────────────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<NextResponse> {
  const { failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();
  const url = new URL(req.url);
  const accountId = url.searchParams.get("accountId");
  const proposalId = url.searchParams.get("proposalId");
  const view = url.searchParams.get("view") || (accountId ? "account" : "pipeline");

  if (view === "pipeline") {
    const [{ data, error }, { data: sessions }, attention] = await Promise.all([
      supabase.from("commercial_deal_pipeline_v1").select("*").order("business_name").limit(500),
      supabase
        .from("commercial_onboarding_sessions_v1")
        .select("*")
        .eq("status", "active")
        .order("idle_hours", { ascending: false })
        .limit(500),
      onboardingAttention(supabase),
    ]);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({
      ok: true,
      deals: data || [],
      // Onboarding sessions ride alongside the deal stages rather than
      // replacing them: the stage still says where the DEAL is, the session
      // says where the CLIENT is inside their setup.
      onboarding: sessions || [],
      onboardingAttention: attention,
    });
  }

  if (proposalId) {
    const [{ data: proposal }, { data: sites }] = await Promise.all([
      supabase.from("commercial_proposals").select(PROPOSAL_COLS).eq("id", proposalId).maybeSingle(),
      supabase.from("commercial_proposal_sites").select(SITE_COLS).eq("proposal_id", proposalId).order("sort_order"),
    ]);
    if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    return NextResponse.json({ ok: true, proposal, sites: sites || [] });
  }

  if (!accountId) {
    return NextResponse.json({ error: "accountId or view=pipeline required." }, { status: 400 });
  }

  const [
    { data: onboardingSession },
    { data: onboardingSubmissions },
    { data: account },
    { data: readiness },
    { data: proposals },
    { data: agreements },
    { data: billing },
    { data: deliveries },
  ] = await Promise.all([
    // The live onboarding session for this account, if any, plus anything the
    // client has sent through it.
    supabase
      .from("commercial_onboarding_sessions_v1")
      .select("*")
      .eq("business_account_id", accountId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("commercial_onboarding_submissions")
      .select("*")
      .eq("business_account_id", accountId)
      .order("submitted_at", { ascending: false })
      .limit(50),
    supabase.from("business_accounts")
      .select("id, business_name, contact_name, email, phone, address, city, state, zip_code, " +
        "account_type, status, recurring_frequency, billing_terms, agreement_signed_at, " +
        "assigned_va_email, requires_coi_on_file, company_coi_sent_at, billing_method, " +
        "billing_configured_at, stripe_customer_id, preferred_billing_method, " +
        "preferred_billing_method_set_at, preferred_billing_method_set_by, portal_user_id, portal_created_at")
      .eq("id", accountId).maybeSingle(),
    supabase.rpc("commercial_proposal_readiness", { p_account_id: accountId }),
    supabase.from("commercial_proposals").select(PROPOSAL_COLS)
      .eq("business_account_id", accountId).order("version", { ascending: false }),
    supabase.from("commercial_agreements").select(AGREEMENT_COLS)
      .eq("business_account_id", accountId).order("created_at", { ascending: false }),
    supabase.from("commercial_billing_profiles").select("*")
      .eq("business_account_id", accountId).maybeSingle(),
    supabase.from("company_coi_deliveries")
      .select("id, sent_to, sent_at, sent_by_name, trigger_source, status, certificate_expires_at")
      .eq("business_account_id", accountId).order("sent_at", { ascending: false }).limit(50),
  ]);

  if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

  const source = await loadProposalSource(supabase, accountId);
  const readinessSites = Array.isArray((readiness as { sites?: unknown[] } | null)?.sites)
    ? ((readiness as { sites: Array<Record<string, unknown>> }).sites || []).map((site) =>
      mergeSiteFromWalkthrough(site, source.walkthroughsBySite.get(String(site.site_id))),
    )
    : [];
  const readinessOut = readiness
    ? { ...(readiness as Record<string, unknown>), sites: readinessSites }
    : null;
  const prefill = proposalPrefillFromWalkthrough({
    account: account as {
      contact_name?: string | null;
      email?: string | null;
      phone?: string | null;
      recurring_frequency?: string | null;
    },
    request: source.request as {
      requester_name?: string | null;
      requester_email?: string | null;
      requester_phone?: string | null;
      desired_frequency?: string | null;
    } | null,
  });

  // Every version's snapshot rows in one round trip — the history is the
  // point of keeping them, so it should not take a click per version to read.
  const proposalRows = rows<{ id: string; token: string | null }>(proposals);
  const ids = proposalRows.map((p) => p.id);
  const { data: allSites } = ids.length
    ? await supabase.from("commercial_proposal_sites").select(SITE_COLS).in("proposal_id", ids).order("sort_order")
    : { data: [] };

  const sitesByProposal: Record<string, unknown[]> = {};
  for (const site of rows<{ proposal_id: string }>(allSites)) {
    (sitesByProposal[site.proposal_id] ||= []).push(site);
  }

  return NextResponse.json({
    ok: true,
    account,
    readiness: readinessOut,
    proposals: proposalRows.map((p) => ({
      ...p,
      sites: sitesByProposal[p.id] || [],
      link: p.token ? proposalUrl(String(p.token)) : null,
    })),
    agreements: rows<{ token: string | null }>(agreements).map((a) => ({
      ...a,
      link: a.token ? agreementUrl(String(a.token)) : null,
    })),
    billing: billing || null,
    coiDeliveries: deliveries || [],
    onboarding: onboardingSession || null,
    onboardingSubmissions: onboardingSubmissions || [],
    walkthroughSource: {
      request: source.request,
      prefill,
    },
  });
}

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  const { principal, failure } = await guard(req);
  if (failure) return failure;

  const supabase = getAdminSupabase();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action || "");
  const actorName = s(body.actorName, 120) || principal?.email || "Admin";

  // ── Create / link the client portal login (optional — not required to send)
  if (action === "invite_portal") {
    const accountId = s(body.accountId, 60);
    if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });
    const { data: account } = await supabase
      .from("business_accounts")
      .select("id, business_name, contact_name, email, portal_user_id")
      .eq("id", accountId)
      .maybeSingle();
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });
    if (String((account as { portal_user_id?: string | null }).portal_user_id || "").trim()) {
      return NextResponse.json({
        ok: true,
        alreadyLinked: true,
        message: "This account already has a portal login.",
      });
    }
    const email = s(body.email, 200) || String((account as { email?: string | null }).email || "");
    const invited = await inviteCommercialPortalUser(supabase, {
      accountId,
      email,
      fullName: s(body.fullName, 120) || String((account as { contact_name?: string | null }).contact_name || ""),
      businessName: String((account as { business_name?: string }).business_name || ""),
    });
    if (!invited.ok) {
      return NextResponse.json({ error: invited.error || "Could not create the client account." }, { status: 400 });
    }
    await supabase.from("events").insert({
      event_type: "commercial.portal.invited",
      source: "admin-proposals",
      summary: invited.linkedExisting
        ? `Linked existing portal login ${email} to ${(account as { business_name?: string }).business_name}.`
        : `Invited ${email} to create a portal login for ${(account as { business_name?: string }).business_name}.`,
      data: { account_id: accountId, email, user_id: invited.userId, linkedExisting: invited.linkedExisting },
    });
    return NextResponse.json({
      ok: true,
      invited: invited.invited,
      linkedExisting: invited.linkedExisting,
      userId: invited.userId,
    });
  }

  // ── Build the next version from the account's priced sites ─────────────
  if (action === "create_draft") {
    const accountId = s(body.accountId, 60);
    if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });

    const { data: account } = await supabase
      .from("business_accounts")
      .select("id, business_name, contact_name, email, phone, recurring_frequency, billing_terms, assigned_va_email")
      .eq("id", accountId).maybeSingle();
    if (!account) return NextResponse.json({ error: "Account not found." }, { status: 404 });

    const { data: readiness } = await supabase.rpc("commercial_proposal_readiness", {
      p_account_id: accountId,
    });
    const ready = (readiness || {}) as {
      can_propose?: boolean;
      reason?: string;
      sites?: Array<Record<string, unknown>>;
    };
    const source = await loadProposalSource(supabase, accountId);
    const prefill = proposalPrefillFromWalkthrough({
      account: account as {
        contact_name?: string | null;
        email?: string | null;
        phone?: string | null;
        recurring_frequency?: string | null;
      },
      request: source.request as {
        requester_name?: string | null;
        requester_email?: string | null;
        requester_phone?: string | null;
        desired_frequency?: string | null;
      } | null,
    });

    // Sites under the walkthrough threshold carry no stored firm price — the
    // engine prices them. Resolve that now so the proposal records a real
    // number rather than a promise to compute one later. Admin overrides
    // cover any site the walkthrough has not priced yet.
    const config = await loadCommercialConfigServer(supabase);
    const defaultFrequency = s(body.frequency, 80) || prefill.frequency || "weekly";

    // Per-site rate / cadence overrides from the send workspace. Same idea as
    // Internal Booking's price override: the formula (or walkthrough) fills
    // the box, typing a different number is a deliberate act.
    const overrideMap = new Map<string, { cents: number | null; frequency: string | null }>();
    if (Array.isArray(body.siteOverrides)) {
      for (const raw of body.siteOverrides as Array<Record<string, unknown>>) {
        const id = s(raw.siteId || raw.business_site_id, 60);
        if (!id) continue;
        overrideMap.set(id, {
          cents: raw.perVisitPriceCents !== undefined ? int(raw.perVisitPriceCents) : null,
          frequency: s(raw.frequency, 80),
        });
      }
    }

    const siteRows: Array<Record<string, unknown>> = [];
    const missingRates: string[] = [];
    let order = 0;
    for (const raw of ready.sites || []) {
      const site = mergeSiteFromWalkthrough(
        raw as Record<string, unknown>,
        source.walkthroughsBySite.get(String((raw as Record<string, unknown>).site_id)),
      );
      if (String(site.stage || "") === "excluded") continue;

      const ov = overrideMap.get(String(site.site_id));
      let cents = ov?.cents ?? siteRateCentsFromWalkthrough({
        firm_price_cents: site.firm_price_cents as number | null,
        formula_price_cents: site.formula_price_cents as number | null,
      });
      let priceSource: "formula" | "walkthrough" = Number(site.firm_price_cents) > 0
        ? "walkthrough"
        : "formula";

      if (cents == null || cents <= 0) {
        const quote = computeCommercialQuote(config, {
          sqft: Number(site.sqft) || 0,
          facilityTypeKey: String(site.facility_type || "other"),
          scopeLevel: String(site.scope_level || "standard"),
        });
        if (quote.ok && !quote.requiresWalkthrough && quote.formulaCents > 0) {
          cents = quote.formulaCents;
          priceSource = "formula";
        }
      }

      if (cents == null || cents <= 0) {
        missingRates.push(String(site.nickname || "Site"));
        continue;
      }

      siteRows.push({
        business_site_id: site.site_id,
        nickname: String(site.nickname || "Site"),
        address: site.address ?? null,
        facility_type: site.facility_type ?? null,
        scope_level: site.scope_level ?? null,
        sqft: int(site.sqft),
        crew_size: int(site.crew_size),
        service_window_start: site.service_window_start ?? null,
        service_window_end: site.service_window_end ?? null,
        frequency: ov?.frequency || defaultFrequency,
        per_visit_price_cents: cents,
        price_source: priceSource,
        walkthrough_id: site.walkthrough_id ?? null,
        pricing_confirmed_at: site.pricing_confirmed_at ?? null,
        sort_order: order++,
      });
    }

    if (missingRates.length) {
      return NextResponse.json(
        {
          error:
            `Type a per-visit rate for ${missingRates.join(", ")} — ` +
            `the walkthrough has no firm price yet, and the rate engine could not fill it.`,
          code: "rate_required",
          missing: missingRates,
        },
        { status: 409 },
      );
    }

    if (!siteRows.length) {
      return NextResponse.json(
        { error: "This account has no sites to propose. Add a site or record walkthrough findings first." },
        { status: 409 },
      );
    }

    // Anything still open is replaced by the version we are about to build.
    const supersedesId = s(body.supersedesId, 60);
    await supabase.from("commercial_proposals")
      .update({ status: "superseded", token: null, updated_at: new Date().toISOString() })
      .eq("business_account_id", accountId).in("status", ["draft", "sent"]);

    const { data: maxRow } = await supabase.from("commercial_proposals")
      .select("version").eq("business_account_id", accountId)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    const version = Number((maxRow as { version?: number } | null)?.version || 0) + 1;

    const perVisit = totalPerVisitCents(siteRows as unknown as ProposalSite[]);
    const monthly = estimatedMonthlyCents(siteRows as unknown as ProposalSite[], defaultFrequency);

    const { data: created, error } = await supabase.from("commercial_proposals").insert({
      business_account_id: accountId,
      version,
      supersedes_id: supersedesId,
      status: "draft",
      recipient_name: s(body.recipientName, 120) || prefill.name || account.contact_name,
      recipient_email: s(body.recipientEmail, 200) || prefill.email || account.email,
      recipient_phone: s(body.recipientPhone, 40) || prefill.phone || account.phone,
      proposed_frequency: defaultFrequency,
      term: s(body.term, 40) || "month_to_month",
      billing_method: body.billingMethod === "auto_pay" ? "auto_pay" : "invoiced",
      billing_method_locked: body.billingMethodLocked === true,
      invoice_cycle: s(body.invoiceCycle, 20) || "monthly",
      net_terms: s(body.netTerms, 20) || mapBillingTerms(account.billing_terms),
      cover_note: s(body.coverNote, 4000),
      internal_note: s(body.internalNote, 4000),
      total_per_visit_cents: perVisit,
      estimated_monthly_cents: monthly,
      visits_per_month: visitsPerMonth(defaultFrequency),
      prepared_by: principal?.userId ?? null,
      prepared_by_name: actorName,
      assigned_to_email: account.assigned_va_email || principal?.email || null,
    }).select("id, version").maybeSingle();

    if (error || !created) {
      return NextResponse.json({ error: error?.message || "Could not create the proposal." }, { status: 400 });
    }

    const { error: siteErr } = await supabase.from("commercial_proposal_sites").insert(
      siteRows.map((r) => ({ ...r, proposal_id: (created as { id: string }).id })),
    );
    if (siteErr) {
      await supabase.from("commercial_proposals").delete().eq("id", (created as { id: string }).id);
      return NextResponse.json({ error: siteErr.message }, { status: 400 });
    }

    const proposalId = (created as { id: string }).id;
    const payload: Record<string, unknown> = {
      ok: true,
      proposalId,
      version,
      totalPerVisitCents: perVisit,
      estimatedMonthlyCents: monthly,
    };

    // Internal Booking submits and emails the pay link in one click. Send
    // does the same for the proposal: one action, a live tokenized link.
    if (body.send === true) {
      const sent = await sendProposal(supabase, proposalId, s(body.recipientEmail, 200));
      if (sent.ok === false) {
        return NextResponse.json(
          { ...payload, sent: false, error: sent.error },
          { status: sent.status },
        );
      }
      return NextResponse.json({
        ...payload,
        sent: true,
        link: sent.link,
        emailed: sent.emailed,
        emailError: sent.emailError,
        expiresAt: sent.expiresAt,
      });
    }

    return NextResponse.json(payload);
  }

  // ── Edit a draft ───────────────────────────────────────────────────────
  if (action === "update_draft") {
    const proposalId = s(body.proposalId, 60);
    if (!proposalId) return NextResponse.json({ error: "proposalId is required." }, { status: 400 });

    const { data: proposal } = await supabase.from("commercial_proposals")
      .select("id, status, business_account_id, proposed_frequency").eq("id", proposalId).maybeSingle();
    if (!proposal) return NextResponse.json({ error: "Proposal not found." }, { status: 404 });
    if ((proposal as { status: string }).status !== "draft") {
      return NextResponse.json(
        { error: "Only a draft can be edited. Build a new version instead — sent proposals are kept as they were sent." },
        { status: 409 },
      );
    }

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (body.recipientName !== undefined) patch.recipient_name = s(body.recipientName, 120);
    if (body.recipientEmail !== undefined) patch.recipient_email = s(body.recipientEmail, 200);
    if (body.recipientPhone !== undefined) patch.recipient_phone = s(body.recipientPhone, 40);
    if (body.frequency !== undefined || body.proposedFrequency !== undefined) {
      const freq = s(body.frequency ?? body.proposedFrequency, 80);
      patch.proposed_frequency = freq;
      patch.visits_per_month = visitsPerMonth(freq);
    }
    if (body.term !== undefined) patch.term = s(body.term, 40) || "month_to_month";
    if (body.billingMethod !== undefined) patch.billing_method = body.billingMethod === "auto_pay" ? "auto_pay" : "invoiced";
    if (body.billingMethodLocked !== undefined) patch.billing_method_locked = body.billingMethodLocked === true;
    if (body.invoiceCycle !== undefined) patch.invoice_cycle = s(body.invoiceCycle, 20);
    if (body.netTerms !== undefined) patch.net_terms = s(body.netTerms, 20);
    if (body.coverNote !== undefined) patch.cover_note = s(body.coverNote, 4000);
    if (body.internalNote !== undefined) patch.internal_note = s(body.internalNote, 4000);

    // Per-site rate and cadence overrides. The price still cannot be zero —
    // the column refuses it — so a "free site" has to be a conversation.
    const siteEdits = Array.isArray(body.sites) ? (body.sites as Array<Record<string, unknown>>) : [];
    for (const edit of siteEdits) {
      const id = s(edit.id, 60);
      if (!id) continue;
      const sitePatch: Record<string, unknown> = {};
      if (edit.perVisitPriceCents !== undefined) {
        const cents = int(edit.perVisitPriceCents);
        if (cents == null || cents <= 0) {
          return NextResponse.json(
            { error: "A proposed site needs a rate above zero." },
            { status: 400 },
          );
        }
        sitePatch.per_visit_price_cents = cents;
      }
      if (edit.frequency !== undefined) sitePatch.frequency = s(edit.frequency, 80);
      if (edit.crewSize !== undefined) sitePatch.crew_size = int(edit.crewSize);
      if (Object.keys(sitePatch).length) {
        await supabase.from("commercial_proposal_sites").update(sitePatch)
          .eq("id", id).eq("proposal_id", proposalId);
      }
    }

    if (s(body.removeSiteId, 60)) {
      await supabase.from("commercial_proposal_sites").delete()
        .eq("id", s(body.removeSiteId, 60)).eq("proposal_id", proposalId);
    }

    const { data: sites } = await supabase.from("commercial_proposal_sites")
      .select(SITE_COLS).eq("proposal_id", proposalId);
    const siteList = (sites || []) as unknown as ProposalSite[];
    const frequency =
      (patch.proposed_frequency as string) ||
      (proposal as { proposed_frequency?: string | null }).proposed_frequency ||
      undefined;
    patch.total_per_visit_cents = totalPerVisitCents(siteList);
    patch.estimated_monthly_cents = estimatedMonthlyCents(siteList, frequency);

    const { error } = await supabase.from("commercial_proposals").update(patch).eq("id", proposalId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // ── Send / resend the proposal ─────────────────────────────────────────
  if (action === "send" || action === "resend") {
    const proposalId = s(body.proposalId, 60);
    if (!proposalId) return NextResponse.json({ error: "proposalId is required." }, { status: 400 });
    const sent = await sendProposal(supabase, proposalId, s(body.to, 200));
    if (sent.ok === false) return NextResponse.json({ error: sent.error }, { status: sent.status });
    return NextResponse.json({
      ok: true,
      link: sent.link,
      emailed: sent.emailed,
      emailError: sent.emailError,
      expiresAt: sent.expiresAt,
    });
  }

  // ── Withdraw ───────────────────────────────────────────────────────────
  if (action === "withdraw") {
    const proposalId = s(body.proposalId, 60);
    const reason = s(body.reason, 1000);
    if (!proposalId) return NextResponse.json({ error: "proposalId is required." }, { status: 400 });
    const { error } = await supabase.from("commercial_proposals").update({
      status: "withdrawn", withdrawn_at: new Date().toISOString(),
      withdrawn_reason: reason, token: null,
    }).eq("id", proposalId).in("status", ["draft", "sent"]);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // ── Pick up a change request ───────────────────────────────────────────
  if (action === "acknowledge_changes") {
    const proposalId = s(body.proposalId, 60);
    if (!proposalId) return NextResponse.json({ error: "proposalId is required." }, { status: 400 });
    const { error } = await supabase.from("commercial_proposals").update({
      change_request_ack_at: new Date().toISOString(),
      change_request_ack_by: actorName,
    }).eq("id", proposalId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // ── Generate the Agreement from an accepted proposal ───────────────────
  if (action === "generate_agreement") {
    const proposalId = s(body.proposalId, 60);
    const accountId = s(body.accountId, 60);
    const result = await generateAgreement(supabase, {
      proposalId,
      accountId,
      signerName: s(body.signerName, 120),
      signerEmail: s(body.signerEmail, 200),
      signerTitle: s(body.signerTitle, 120),
      actorName,
      actorId: principal?.userId ?? null,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    return NextResponse.json({ ok: true, agreementId: result.agreementId, link: result.link });
  }

  // ── Send the signing link ──────────────────────────────────────────────
  if (action === "send_agreement") {
    const agreementId = s(body.agreementId, 60);
    if (!agreementId) return NextResponse.json({ error: "agreementId is required." }, { status: 400 });

    const { data: agreement } = await supabase.from("commercial_agreements")
      .select(AGREEMENT_COLS + ", business_account_id").eq("id", agreementId).maybeSingle();
    const a = row<Record<string, unknown>>(agreement);
    if (!a) return NextResponse.json({ error: "Agreement not found." }, { status: 404 });
    if (a.status !== "pending") {
      return NextResponse.json({ error: `This agreement is ${String(a.status)} — it cannot be sent again.` }, { status: 409 });
    }

    const to = s(body.to, 200) || (a.signer_email as string | null);
    if (!to) return NextResponse.json({ error: "No signer email on this agreement." }, { status: 400 });

    const { data: account } = await supabase.from("business_accounts")
      .select("business_name").eq("id", a.business_account_id as string).maybeSingle();

    const mail = await emailOut(supabase, {
      to,
      subject: `Service agreement for signature — ${(account as { business_name?: string } | null)?.business_name || "Novara Cleaning"}`,
      html: paragraphs([
        `Hi ${(a.signer_name as string | null) || "there"},`,
        `Thanks for accepting the proposal. The Commercial Cleaning Services Agreement is ready for signature — it's pre-filled with everything you accepted, including the schedule of locations and rates in Exhibit A.`,
        `<a href="${agreementUrl(String(a.token))}">Review and sign the agreement</a>`,
        a.billing_method === "auto_pay"
          ? `After signing you'll be asked to add a card or bank account for Auto-Pay. Nothing is charged at that point.`
          : `After signing you'll confirm the billing contact and invoicing terms. No payment details are collected.`,
        EMAIL_SIGN,
      ]),
    });

    await supabase.from("commercial_agreements").update({
      sent_at: new Date().toISOString(), sent_to: to,
      send_count: Number(a.send_count || 0) + 1,
    }).eq("id", agreementId);

    return NextResponse.json({ ok: true, link: agreementUrl(String(a.token)), emailed: mail.ok, emailError: mail.error || null });
  }

  // ── Company countersignature ───────────────────────────────────────────
  if (action === "countersign") {
    const agreementId = s(body.agreementId, 60);
    if (!agreementId) return NextResponse.json({ error: "agreementId is required." }, { status: 400 });
    const { error } = await supabase.from("commercial_agreements").update({
      countersigned_at: new Date().toISOString(),
      countersigned_by_name: s(body.countersignedBy, 120) || actorName,
    }).eq("id", agreementId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // ── Billing setup from the admin side ──────────────────────────────────
  if (action === "save_billing") {
    const accountId = s(body.accountId, 60);
    if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });
    const method = body.method === "auto_pay" ? "auto_pay" : "invoiced";

    const row: Record<string, unknown> = {
      business_account_id: accountId,
      method,
      agreement_id: s(body.agreementId, 60),
      billing_contact_name: s(body.billingContactName, 120),
      billing_contact_email: s(body.billingContactEmail, 200),
      billing_contact_phone: s(body.billingContactPhone, 40),
      invoice_cycle: s(body.invoiceCycle, 20),
      net_terms: s(body.netTerms, 20),
      po_number: s(body.poNumber, 80),
      invoice_notes: s(body.invoiceNotes, 2000),
      confirmed_at: new Date().toISOString(),
      confirmed_by_name: actorName,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("commercial_billing_profiles")
      .upsert(row, { onConflict: "business_account_id" });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const { data: state } = await supabase.rpc("commercial_billing_state", { p_account_id: accountId });
    return NextResponse.json({ ok: true, billing: state });
  }

  // ── Consolidated onboarding session ────────────────────────────────────
  //
  // Approving an account for onboarding REQUIRES the billing decision. That is
  // the point of the adjustment: the client is not asked mid-flow, so somebody
  // has to answer before the link exists.
  if (action === "start_onboarding") {
    const accountId = s(body.accountId, 60);
    if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });

    const method = body.billingMethod === "auto_pay" ? "auto_pay" : body.billingMethod === "invoiced" ? "invoiced" : null;
    if (!method) {
      return NextResponse.json(
        { error: "Choose Invoice or Auto-Pay before generating the onboarding link." },
        { status: 400 },
      );
    }

    const result = await startOnboardingSession(supabase, {
      accountId,
      billingMethod: method,
      proposalId: s(body.proposalId, 60) || null,
      recipientName: s(body.recipientName, 120) || null,
      recipientEmail: s(body.recipientEmail, 200) || null,
      recipientPhone: s(body.recipientPhone, 40) || null,
      actorName,
      send: body.send !== false,
    });
    if (!result.ok) {
      return NextResponse.json({ error: result.message }, { status: result.status });
    }
    return NextResponse.json({
      ok: true,
      sessionId: result.sessionId,
      link: result.link,
      emailed: result.emailed ?? false,
      texted: result.texted ?? false,
    });
  }

  if (action === "resend_onboarding") {
    const sessionId = s(body.sessionId, 60);
    if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });

    const { data: session } = await supabase
      .from("commercial_onboarding_sessions")
      .select("id, token, status, billing_method, recipient_name, recipient_email, recipient_phone, business_account_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session || session.status !== "active" || !session.token) {
      return NextResponse.json({ error: "That onboarding link is no longer live." }, { status: 409 });
    }
    const { data: account } = await supabase
      .from("business_accounts")
      .select("business_name")
      .eq("id", session.business_account_id as string)
      .maybeSingle();

    const to = s(body.to, 200) || (session.recipient_email as string);
    if (!to) return NextResponse.json({ error: "No email to send to." }, { status: 400 });

    const sent = await sendOnboardingLink(supabase, {
      sessionId,
      accountName: String(account?.business_name || "your account"),
      recipientName: (session.recipient_name as string) || null,
      recipientEmail: to,
      recipientPhone: (session.recipient_phone as string) || null,
      billingMethod: session.billing_method === "auto_pay" ? "auto_pay" : "invoiced",
      link: onboardingUrl(String(session.token)),
      reminder: body.reminder !== false,
    });
    return NextResponse.json({ ok: true, ...sent, link: onboardingUrl(String(session.token)) });
  }

  if (action === "cancel_onboarding") {
    const sessionId = s(body.sessionId, 60);
    if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
    const { error } = await supabase
      .from("commercial_onboarding_sessions")
      .update({ status: "cancelled", token: null, updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("status", "active");
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // Changing the method after the fact is a targeted billing re-setup, never a
  // full re-onboarding — they do not sign again.
  if (action === "change_billing_method") {
    const accountId = s(body.accountId, 60);
    const method = body.billingMethod === "auto_pay" ? "auto_pay" : body.billingMethod === "invoiced" ? "invoiced" : null;
    if (!accountId || !method) {
      return NextResponse.json({ error: "accountId and billingMethod are required." }, { status: 400 });
    }
    const result = await changeBillingMethod(supabase, { accountId, billingMethod: method, actorName });
    if (!result.ok) return NextResponse.json({ error: result.message }, { status: result.status });
    return NextResponse.json({ ok: true, message: result.message, link: result.link || null });
  }

  // ── Review what a client sent during onboarding ────────────────────────
  if (action === "review_submission") {
    const submissionId = s(body.submissionId, 60);
    const status = ["reviewed", "actioned", "dismissed"].includes(String(body.status))
      ? String(body.status)
      : "reviewed";
    if (!submissionId) return NextResponse.json({ error: "submissionId is required." }, { status: 400 });
    const { error } = await supabase
      .from("commercial_onboarding_submissions")
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by_name: actorName,
        review_note: s(body.reviewNote, 2000),
      })
      .eq("id", submissionId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  // ── Deliver our certificate on request ─────────────────────────────────
  if (action === "send_company_coi") {
    const accountId = s(body.accountId, 60);
    if (!accountId) return NextResponse.json({ error: "accountId is required." }, { status: 400 });
    const result = await sendCompanyCoi(supabase, {
      accountId,
      to: s(body.to, 200),
      triggerSource: "manual",
      sentByName: actorName,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status || 400 });
    return NextResponse.json({ ok: true, sentTo: result.sentTo });
  }

  return NextResponse.json({ error: `Unknown action "${action}".` }, { status: 400 });
}

