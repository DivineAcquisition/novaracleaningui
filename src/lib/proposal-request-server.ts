// ─── Server helpers for the Proposals tab ──────────────────────────────────
//
// Loads admin-editable templates/checklists, sends requester + agent mail
// through admin-send-email, and creates proposal requests without ever
// inserting a booking.

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  computeWalkthroughPayCents,
  DEFAULT_PROPOSAL_SETTINGS,
  emailToHtml,
  interpolateTemplate,
  mergeChecklists,
  mergeProposalSettings,
  propertyTypeByKey,
  walkthroughLink,
  type EmailVars,
  type ProposalChecklists,
  type ProposalRequestSettings,
  PROPOSAL_CHECKLISTS_KEY,
  PROPOSAL_SETTINGS_KEY,
} from "@/lib/proposal-request";

type SB = SupabaseClient;

export async function loadProposalSettings(supabase: SB): Promise<ProposalRequestSettings> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", PROPOSAL_SETTINGS_KEY)
    .maybeSingle();
  return mergeProposalSettings(data?.value);
}

export async function loadProposalChecklists(supabase: SB): Promise<ProposalChecklists> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", PROPOSAL_CHECKLISTS_KEY)
    .maybeSingle();
  return mergeChecklists(data?.value);
}

export async function sendProposalEmail(
  supabase: SB,
  args: { to: string; subject: string; body: string; vars: EmailVars },
): Promise<{ ok: boolean; error?: string }> {
  const to = args.to.trim();
  if (!to || !/.+@.+\..+/.test(to)) return { ok: false, error: "No email" };
  const subject = interpolateTemplate(args.subject, args.vars);
  const html = emailToHtml(interpolateTemplate(args.body, args.vars));
  const { error } = await supabase.functions.invoke("admin-send-email", {
    body: { to, subject, html },
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function sendProposalSms(
  supabase: SB,
  toPhone: string | null | undefined,
  message: string,
): Promise<boolean> {
  const phone = String(toPhone || "").replace(/\D/g, "");
  if (phone.length < 10 || !message.trim()) return false;
  const { error } = await supabase.functions.invoke("send-ghl-sms", {
    body: { phone, message, type: "confirmation" },
  });
  if (!error) return true;
  await supabase.functions.invoke("send-sms-notification", {
    body: { phone, message, type: "confirmation" },
  });
  return !error;
}

export function mintAssignmentToken(): string {
  return randomBytes(24).toString("base64url");
}

export function tokenExpiryIso(ttlHours: number): string {
  return new Date(Date.now() + Math.max(24, ttlHours) * 3600_000).toISOString();
}

/** Keep an existing token so VA/admin and the agent share one document. */
export function tokenForWalkthrough(existing?: string | null): string {
  const token = String(existing || "").trim();
  return token.length >= 12 ? token : mintAssignmentToken();
}

export async function refreshProposalRequestStatus(supabase: SB, requestId: string | null | undefined): Promise<void> {
  if (!requestId) return;
  const { data: req } = await supabase
    .from("proposal_requests")
    .select("id, status")
    .eq("id", requestId)
    .maybeSingle();
  if (!req || String((req as { status: string }).status) === "cancelled") return;

  const { data: wts } = await supabase
    .from("commercial_walkthroughs")
    .select("status")
    .eq("proposal_request_id", requestId);
  if (!wts?.length) return;

  const st = (wts as Array<{ status: string }>).map((w) => w.status);
  const closed = (s: string) => s === "priced" || s === "excluded" || s === "cancelled";
  let next = String((req as { status: string }).status);
  if (st.every((s) => s === "excluded" || s === "cancelled") && st.some((s) => s === "excluded")) {
    next = "excluded";
  } else if (st.some((s) => s === "priced") && st.every(closed)) {
    next = "firm_price_set";
  } else if (st.some((s) => s === "conducted" || s === "priced")) {
    next = "walkthrough_conducted";
  } else if (st.some((s) => s === "scheduled")) {
    next = "walkthrough_scheduled";
  } else {
    next = "pending_assign";
  }
  if (next !== (req as { status: string }).status) {
    await supabase.from("proposal_requests").update({
      status: next,
      updated_at: new Date().toISOString(),
    }).eq("id", requestId);
  }
}

const s = (v: unknown, max = 300) => String(v ?? "").trim().slice(0, max);
const n = (v: unknown): number | null => {
  const num = Number(v);
  return Number.isFinite(num) && num > 0 ? Math.round(num) : null;
};

export interface IntakeSite {
  nickname?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  zip_code?: string;
  clientStatedSqft?: number | string;
}

export interface CreateProposalInput {
  propertyTypeKey: string;
  requesterName: string;
  requesterCompany?: string;
  requesterEmail: string;
  requesterPhone?: string;
  requesterRole?: string;
  frequency?: string;
  startTimeframe?: string;
  leadSource?: string;
  clientStatedSqft?: number | string;
  siteContactName?: string;
  siteContactPhone?: string;
  siteContactEmail?: string;
  intakeAnswers?: Record<string, unknown>;
  notes?: string;
  sites: IntakeSite[];
  actorName?: string;
  actorId?: string | null;
  tokenTtlHours?: number;
}

function siteLine(site: IntakeSite): string {
  return [site.address, site.city, site.state, site.zip || site.zip_code].filter(Boolean).join(", ");
}

export async function createProposalRequest(
  supabase: SB,
  catalog: ProposalChecklists,
  input: CreateProposalInput,
): Promise<{ ok: true; request: Record<string, unknown> } | { ok: false; error: string; status: number }> {
  const type = propertyTypeByKey(catalog, input.propertyTypeKey);
  if (!type || type.active === false) {
    return { ok: false, error: "Pick a property type.", status: 400 };
  }
  const name = s(input.requesterName, 120);
  const email = s(input.requesterEmail, 200).toLowerCase();
  if (!name) return { ok: false, error: "Requester name is required.", status: 400 };
  if (!/.+@.+\..+/.test(email)) return { ok: false, error: "A valid requester email is required.", status: 400 };

  const sites = (input.sites || []).filter((site) => s(site.address, 200) || s(site.city, 80));
  if (sites.length === 0) {
    return { ok: false, error: "At least one property address is required.", status: 400 };
  }

  const phone = s(input.requesterPhone, 40).replace(/\D/g, "");
  const company = s(input.requesterCompany, 160) || (type.accountKind === "str" ? `${name}'s STR` : `${name}'s business`);
  const statedSqft = n(input.clientStatedSqft);
  const firstAddress = siteLine(sites[0]);

  // Prospective account — never a booking. STR also gets a host record.
  let hostId: string | null = null;
  if (type.accountKind === "str") {
    const { data: existingHost } = await supabase
      .from("hosts")
      .select("id")
      .ilike("email", email)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existingHost?.id) {
      hostId = existingHost.id;
      await supabase.from("hosts").update({
        name: name,
        phone: phone || null,
      }).eq("id", hostId);
    } else {
      const { data: createdHost, error: hostErr } = await supabase
        .from("hosts")
        .insert({
          name,
          email,
          phone: phone || null,
          status: "active",
        })
        .select("id")
        .maybeSingle();
      if (hostErr) return { ok: false, error: hostErr.message, status: 400 };
      hostId = createdHost?.id ?? null;
    }
  }

  const accountType = type.accountKind === "office" ? "office" : type.accountKind === "str" ? "partnership" : "commercial";
  const { data: existingAcct } = await supabase
    .from("business_accounts")
    .select("id")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const acctPatch = {
    account_type: accountType,
    business_name: company,
    contact_name: name,
    email,
    phone: phone || null,
    city: s(sites[0]?.city, 80) || null,
    state: s(sites[0]?.state, 8) || null,
    zip_code: s(sites[0]?.zip || sites[0]?.zip_code, 12) || null,
    address: s(sites[0]?.address, 200) || null,
    facility_type: type.label,
    square_footage: statedSqft,
    recurring_frequency: s(input.frequency, 60) || null,
    num_locations: sites.length,
    source: "proposal_request",
    lead_details: {
      property_type_key: type.key,
      intake: input.intakeAnswers || {},
      lead_source: s(input.leadSource, 80) || null,
      start_timeframe: s(input.startTimeframe, 60) || null,
    },
  };

  let accountId: string | null = existingAcct?.id ?? null;
  if (accountId) {
    await supabase.from("business_accounts").update(acctPatch).eq("id", accountId);
  } else {
    const { data: createdAcct, error: acctErr } = await supabase
      .from("business_accounts")
      .insert({ ...acctPatch, status: "prospect" })
      .select("id")
      .maybeSingle();
    if (acctErr) return { ok: false, error: acctErr.message, status: 400 };
    accountId = createdAcct?.id ?? null;
  }
  if (!accountId) return { ok: false, error: "Could not create the prospective account.", status: 500 };

  const { data: request, error: reqErr } = await supabase
    .from("proposal_requests")
    .insert({
      property_type_key: type.key,
      status: "pending_assign",
      requester_name: name,
      requester_company: company,
      requester_email: email,
      requester_phone: phone || null,
      requester_role: s(input.requesterRole, 80) || null,
      desired_frequency: s(input.frequency, 60) || null,
      desired_start_timeframe: s(input.startTimeframe, 60) || null,
      lead_source: s(input.leadSource, 80) || null,
      client_stated_sqft: statedSqft,
      site_contact_name: s(input.siteContactName, 120) || name,
      site_contact_phone: s(input.siteContactPhone, 40) || phone || null,
      site_contact_email: s(input.siteContactEmail, 200) || email,
      intake_answers: input.intakeAnswers || {},
      notes: s(input.notes, 4000) || null,
      business_account_id: accountId,
      host_id: hostId,
      created_by: input.actorId || null,
      created_by_name: input.actorName || null,
    })
    .select("*")
    .maybeSingle();
  if (reqErr || !request) {
    return { ok: false, error: reqErr?.message || "Could not create the proposal request.", status: 400 };
  }
  const requestId = (request as { id: string }).id;
  const ttlHours = input.tokenTtlHours ?? DEFAULT_PROPOSAL_SETTINGS.tokenTtlHours;
  const tokenExpires = tokenExpiryIso(ttlHours);

  const createdSites: Array<Record<string, unknown>> = [];
  for (let i = 0; i < sites.length; i++) {
    const site = sites[i];
    const zip = s(site.zip || site.zip_code, 12);
    const nickname = s(site.nickname, 80) || s(site.address, 80) || `Site ${i + 1}`;
    const sqft = n(site.clientStatedSqft) ?? statedSqft;
    // Insert without sqft so the threshold trigger does not open a second
    // pipeline — we create the walkthrough ourselves and stamp sqft after.
    const { data: bizSite, error: siteErr } = await supabase
      .from("business_sites")
      .insert({
        business_account_id: accountId,
        nickname,
        address: s(site.address, 200) || null,
        city: s(site.city, 80) || null,
        state: s(site.state, 8) || null,
        zip_code: zip || null,
        facility_type: type.label,
        facility_type_key: type.facilityTypeKey,
        active: true,
      })
      .select("id")
      .maybeSingle();
    if (siteErr || !bizSite) {
      return { ok: false, error: siteErr?.message || "Could not save a site.", status: 400 };
    }
    const siteId = (bizSite as { id: string }).id;
    if (sqft) {
      await supabase.from("business_sites").update({ sqft }).eq("id", siteId);
    }

    const { data: wt, error: wtErr } = await supabase
      .from("commercial_walkthroughs")
      .insert({
        business_account_id: accountId,
        business_site_id: siteId,
        status: "requested",
        request_reason: "proposal_request",
        requested_by: input.actorId || null,
        requested_by_name: input.actorName || "Proposals tab",
        client_stated_sqft: sqft,
        client_stated_facility_type: type.label,
        facility_type_key: type.facilityTypeKey,
        site_address: siteLine(site) || nickname,
        access_contact_name: s(input.siteContactName, 120) || name,
        access_contact_phone: s(input.siteContactPhone, 40) || phone || null,
        access_contact_email: s(input.siteContactEmail, 200) || email,
        proposal_request_id: requestId,
        property_type_key: type.key,
        notes: s(input.notes, 2000),
        assignment_token: mintAssignmentToken(),
        token_expires_at: tokenExpires,
      })
      .select("id, assignment_token")
      .maybeSingle();
    if (wtErr) {
      if (/commercial_walkthroughs_one_open/.test(wtErr.message)) {
        const { data: open } = await supabase
          .from("commercial_walkthroughs")
          .select("id, assignment_token")
          .eq("business_site_id", siteId)
          .in("status", ["requested", "scheduled", "conducted"])
          .maybeSingle();
        if (open?.id) {
          const existingToken = String((open as { assignment_token?: string }).assignment_token || "");
          const token = tokenForWalkthrough(existingToken);
          await supabase.from("commercial_walkthroughs").update({
            proposal_request_id: requestId,
            property_type_key: type.key,
            assignment_token: token,
            token_expires_at: tokenExpires,
          }).eq("id", open.id);
          await supabase.from("proposal_request_sites").insert({
            proposal_request_id: requestId,
            sort_order: i,
            nickname,
            address: s(site.address, 200) || null,
            city: s(site.city, 80) || null,
            state: s(site.state, 8) || null,
            zip_code: zip || null,
            client_stated_sqft: sqft,
            business_site_id: siteId,
            walkthrough_id: open.id,
          });
          createdSites.push({
            ...site,
            business_site_id: siteId,
            walkthrough_id: open.id,
            assignment_token: token,
          });
          continue;
        }
      }
      return { ok: false, error: wtErr.message, status: 400 };
    }

    await supabase.from("proposal_request_sites").insert({
      proposal_request_id: requestId,
      sort_order: i,
      nickname,
      address: s(site.address, 200) || null,
      city: s(site.city, 80) || null,
      state: s(site.state, 8) || null,
      zip_code: zip || null,
      client_stated_sqft: sqft,
      business_site_id: siteId,
      walkthrough_id: (wt as { id: string } | null)?.id ?? null,
    });
    createdSites.push({
      ...site,
      business_site_id: siteId,
      walkthrough_id: (wt as { id?: string } | null)?.id,
      assignment_token: (wt as { assignment_token?: string } | null)?.assignment_token,
    });
  }

  await supabase.from("events").insert({
    event_type: "proposal_request.created",
    source: "admin-proposals",
    summary:
      `Proposal request (${type.label}) from ${name}` +
      `${company ? ` · ${company}` : ""} · ${email}` +
      `${firstAddress ? ` · ${firstAddress}` : ""}` +
      `${sites.length > 1 ? ` · ${sites.length} sites` : ""}` +
      ` · Pending — assigning walkthrough agent. Onsite documentation tokenized. Not a booking.`,
    data: {
      proposal_request_id: requestId,
      business_account_id: accountId,
      host_id: hostId,
      property_type_key: type.key,
      site_count: sites.length,
    },
  });

  return { ok: true, request: { ...(request as object), sites: createdSites } };
}

export function agentPayCents(settings: ProposalRequestSettings, hours?: number | null): number {
  return computeWalkthroughPayCents(settings, hours);
}

export { walkthroughLink };
