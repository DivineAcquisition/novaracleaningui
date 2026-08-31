import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { AGREEMENT_BUCKET } from "@/lib/commercial-onboarding/operations";
import {
  bundledCompanyCoi,
  coiIsExpired,
  currentCompanyCoi,
} from "@/lib/company-coi";
import {
  COMPANY_COI_PUBLIC_HREF,
  companyCoiExpiresLabel,
  companyCoiFileUrl,
  isPublicCompanyCoiPath,
} from "@/lib/company-coi-public";
import type { PartnerIdentity } from "./identity";
import { stripCrewContact } from "./sanitize";
import { parseSiteZones, parseZoneCompletions } from "@/lib/site-zones";

type Admin = any;

function accountIds(identity: PartnerIdentity): string[] {
  return identity.accounts.map((a) => a.id);
}

function ownsAccount(identity: PartnerIdentity, accountId: string): boolean {
  return accountIds(identity).includes(accountId);
}

async function signedUrl(supabase: Admin, bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  if (isPublicCompanyCoiPath(path)) return companyCoiFileUrl(path);
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

export function coiFacingStatus(expirationDate: string | null): "current" | "expiring" | "expired" {
  if (!expirationDate) return "expired";
  const end = new Date(`${String(expirationDate).slice(0, 10)}T23:59:59Z`).getTime();
  const now = Date.now();
  if (end < now) return "expired";
  const days = (end - now) / 86400_000;
  if (days <= 30) return "expiring";
  return "current";
}

export async function commercialOverview(identity: PartnerIdentity, siteId?: string | null) {
  const ids = accountIds(identity);
  if (!ids.length) return { ok: false as const, error: "No commercial relationship on this account." };
  const supabase = getAdminSupabase();
  const accountId = ids[0];

  const [{ data: account }, { data: sites }, { data: bookings }, { data: agreements }, { data: profile }] =
    await Promise.all([
      supabase.from("business_accounts").select("*").eq("id", accountId).maybeSingle(),
      supabase
        .from("business_sites")
        .select(
          "id, nickname, address, city, state, facility_type, scope_level, sqft, service_window_start, service_window_end, active, photo_zones",
        )
        .eq("business_account_id", accountId)
        .eq("active", true)
        .order("created_at", { ascending: true }),
      supabase
        .from("bookings")
        .select(
          "id, booking_number, status, service_date, time_slot, arrival_window, address, city, custom_quote_cents, final_charge_cents, total_estimate_cents, hosted_invoice_url, stripe_invoice_id, is_recurring, recurring_frequency, completed_at, before_photos, after_photos, business_site_id, job_id, photo_zones",
        )
        .eq("business_account_id", accountId)
        .order("service_date", { ascending: false })
        .limit(120),
      supabase
        .from("commercial_agreements")
        .select("id, signed_at, signed_by_name, document_path, exhibit_a_text, total_per_visit_cents, term, billing_method, status")
        .eq("business_account_id", accountId)
        .eq("status", "signed")
        .order("signed_at", { ascending: false })
        .limit(3),
      supabase.from("commercial_billing_profiles").select("*").eq("business_account_id", accountId).maybeSingle(),
    ]);

  const coiDoc = (await currentCompanyCoi(supabase, accountId)) || bundledCompanyCoi();
  const coiStatus = coiIsExpired(coiDoc) ? "expired" : coiFacingStatus(coiDoc.expiration_date);

  const docs: Array<{ label: string; url: string | null; date: string }> = [];
  for (const a of agreements || []) {
    docs.push({
      label: `Commercial Cleaning Services Agreement — signed ${String(a.signed_at || "").slice(0, 10)}`,
      url: await signedUrl(supabase, AGREEMENT_BUCKET, a.document_path),
      date: a.signed_at || new Date().toISOString(),
    });
  }
  docs.push({
    label: "Certificate of Insurance (current)",
    url: COMPANY_COI_PUBLIC_HREF,
    date: coiDoc.expiration_date || "",
  });

  const today = new Date().toISOString().slice(0, 10);
  const allBookings = bookings || [];
  const completed = allBookings.filter((b: { status?: string | null }) =>
    b.status === "completed" || b.status === "pending_review",
  );
  const lastBySite = new Map<string, Record<string, unknown>>();
  for (const b of completed) {
    const sid = String(b.business_site_id || "");
    if (!sid || lastBySite.has(sid)) continue;
    lastBySite.set(sid, b);
  }
  const jobIds = [...lastBySite.values()].map((b) => String(b.job_id || "")).filter(Boolean);
  const checklistsByJob = new Map<string, { section_meta?: unknown; zone_completion?: unknown }>();
  if (jobIds.length) {
    const { data: cls } = await supabase
      .from("job_checklists")
      .select("job_id, section_meta, zone_completion")
      .in("job_id", jobIds);
    for (const cl of cls || []) {
      checklistsByJob.set(String(cl.job_id), cl);
    }
  }

  const photoSlots = (meta: unknown): Array<{ before: string[]; after: string[] }> => {
    if (!meta || typeof meta !== "object") return [];
    const rec = meta as Record<string, { before?: string[]; after?: string[] }>;
    return Object.keys(rec)
      .sort((a, b) => Number(a) - Number(b))
      .map((k) => {
        const m = rec[k] || {};
        return {
          before: Array.isArray(m.before) ? m.before.map(String).filter(Boolean) : [],
          after: Array.isArray(m.after) ? m.after.map(String).filter(Boolean) : [],
        };
      })
      .filter((s) => s.before.length > 0 || s.after.length > 0);
  };
  const upcoming = allBookings.filter(
    (b: { service_date?: string | null; status?: string | null }) =>
      (b.service_date || "") >= today && b.status !== "cancelled",
  );
  const periodStart = new Date();
  periodStart.setDate(1);
  const periodKey = periodStart.toISOString().slice(0, 7);
  const upcomingThisPeriod = upcoming.filter((b: { service_date?: string | null }) =>
    String(b.service_date || "").startsWith(periodKey),
  );

  const billingMethod =
    account?.preferred_billing_method || account?.billing_method || profile?.method || "auto_pay";
  const method: "auto_pay" | "invoiced" = billingMethod === "invoiced" ? "invoiced" : "auto_pay";

  const invoices = allBookings
    .filter((b: { hosted_invoice_url?: string | null; stripe_invoice_id?: string | null }) =>
      method === "invoiced" ? !!(b.hosted_invoice_url || b.stripe_invoice_id) : !!b.final_charge_cents,
    )
    .map((b: Record<string, unknown>) => {
      const status = String(b.status || "");
      const paid = status === "completed" || status === "paid";
      const overdue = method === "invoiced" && !paid && String(b.service_date || "") < today;
      return {
        id: b.id,
        date: b.service_date,
        amountCents: Number(b.final_charge_cents ?? b.custom_quote_cents ?? b.total_estimate_cents ?? 0),
        url: b.hosted_invoice_url || null,
        status: paid ? "paid" : overdue ? "overdue" : "outstanding",
        dueDate: b.service_date,
      };
    });

  const siteList = (sites || []).map((s: Record<string, unknown>) => {
    const map = parseSiteZones(s.photo_zones);
    const last = lastBySite.get(String(s.id));
    const cl = last?.job_id ? checklistsByJob.get(String(last.job_id)) : null;
    const completions = parseZoneCompletions(cl?.zone_completion);
    const slots = photoSlots(cl?.section_meta);
    return {
      id: s.id,
      nickname: s.nickname,
      address: s.address,
      city: s.city,
      state: s.state,
      facilityType: s.facility_type,
      scopeLevel: s.scope_level,
      sqft: s.sqft,
      serviceWindowStart: s.service_window_start,
      serviceWindowEnd: s.service_window_end,
      upcomingCount: upcoming.filter((b: { business_site_id?: string }) => b.business_site_id === s.id).length,
      lastVisit: last?.service_date || null,
      zones: map.map((z, i) => {
        const done = completions.find((c) => c.name.toLowerCase() === z.name.toLowerCase());
        const slot = slots[i] || { before: [] as string[], after: [] as string[] };
        return {
          id: z.id,
          name: z.name,
          description: z.description,
          status: done?.status || null,
          note: done?.note || "",
          before: slot.before,
          after: slot.after,
        };
      }),
    };
  });

  const selected = siteId ? siteList.find((s: { id: string }) => s.id === siteId) || null : null;
  const visitsFor = (sid?: string | null) =>
    allBookings
      .filter((b: { business_site_id?: string }) => !sid || b.business_site_id === sid)
      .map((b: Record<string, unknown>) => ({
        id: b.id,
        bookingNumber: b.booking_number,
        status: b.status,
        serviceDate: b.service_date,
        timeSlot: b.time_slot,
        arrivalWindow: b.arrival_window,
        address: b.address,
        city: b.city,
        amountCents: b.final_charge_cents ?? b.custom_quote_cents ?? b.total_estimate_cents,
        invoiceUrl: method === "invoiced" ? b.hosted_invoice_url || null : null,
        isRecurring: b.is_recurring,
        frequency: b.recurring_frequency,
        completedAt: b.completed_at,
        beforePhotos: b.before_photos || [],
        afterPhotos: b.after_photos || [],
        siteId: b.business_site_id,
      }));

  const signed = agreements?.[0];
  return stripCrewContact({
    ok: true as const,
    account: {
      id: accountId,
      businessName: account?.business_name || identity.accounts[0]?.businessName,
      contactName: account?.contact_name || identity.displayName,
      status: account?.status || "active",
      accountType: account?.account_type || "commercial",
      facilityType: account?.facility_type || null,
      frequency: account?.recurring_frequency || null,
      siteCount: siteList.length,
      upcomingThisPeriod: upcomingThisPeriod.length,
      upcomingTotal: upcoming.length,
      agreementSigned: !!account?.agreement_signed_at,
      billingConfigured: !!account?.billing_configured_at || !!account?.stripe_customer_id,
      contractValueCents: signed?.total_per_visit_cents ?? null,
      term: signed?.term || null,
    },
    billing: {
      method,
      cardOnFile: method === "auto_pay" ? !!account?.stripe_customer_id : false,
      netTerms: method === "invoiced" ? profile?.net_terms || null : null,
      invoiceCycle: profile?.invoice_cycle || null,
      invoices: method === "invoiced" ? invoices : [],
      charges: method === "auto_pay" ? invoices : [],
    },
    coi: {
      status: coiStatus,
      expiresLabel: companyCoiExpiresLabel(),
      expirationDate: coiDoc.expiration_date,
      href: COMPANY_COI_PUBLIC_HREF,
    },
    sites: siteList,
    selectedSite: selected,
    visits: visitsFor(selected?.id || null),
    documents: docs,
  });
}

async function routeCommercialRequest(
  identity: PartnerIdentity,
  kind: "additional_site" | "additional_service" | "schedule_change",
  input: { siteId?: string; message: string; nickname?: string; address?: string },
) {
  const accountId = accountIds(identity)[0];
  if (!accountId) return { ok: false as const, error: "No commercial relationship on this account." };
  const message = String(input.message || "").trim().slice(0, 2000);
  if (!message && kind !== "additional_site") return { ok: false as const, error: "Describe what you need." };
  if (kind === "additional_site" && String(input.address || "").trim().length < 5 && !message) {
    return { ok: false as const, error: "Add the site address so our team can start a walkthrough." };
  }

  const supabase = getAdminSupabase();
  let siteId: string | null = null;
  if (input.siteId) {
    const { data: site } = await supabase
      .from("business_sites")
      .select("id, business_account_id")
      .eq("id", input.siteId)
      .maybeSingle();
    if (site && ownsAccount(identity, site.business_account_id)) siteId = site.id;
  }

  await supabase.from("partner_portal_requests").insert({
    identity_id: identity.id,
    relationship: "commercial",
    kind,
    business_account_id: accountId,
    business_site_id: siteId,
    payload: {
      message: message || null,
      nickname: input.nickname || null,
      address: input.address || null,
      priced: false,
    },
    status: "pending",
  });
  await supabase.from("events").insert({
    event_type: `partner.commercial.${kind}`,
    source: "partner-portal",
    summary: `${identity.accounts[0]?.businessName || identity.email} — ${kind.replace(/_/g, " ")}: ${(message || input.address || "").slice(0, 240)}`,
    data: { business_account_id: accountId, kind, site_id: siteId, priced: false },
  });
  return {
    ok: true as const,
    message:
      kind === "additional_site"
        ? "Thanks — that's with our team. A new site still needs its own walkthrough and pricing before anything is scheduled."
        : "Thanks — our team will review this. It doesn't change your schedule or rate on its own.",
  };
}

export const requestAdditionalSite = (identity: PartnerIdentity, input: { nickname?: string; address?: string; message?: string }) =>
  routeCommercialRequest(identity, "additional_site", { ...input, message: input.message || input.address || "" });

export const requestAdditionalService = (identity: PartnerIdentity, input: { siteId?: string; message: string }) =>
  routeCommercialRequest(identity, "additional_service", input);

export const requestScheduleChange = (identity: PartnerIdentity, input: { siteId?: string; message: string }) =>
  routeCommercialRequest(identity, "schedule_change", input);

export async function reportCommercialIssue(
  identity: PartnerIdentity,
  input: { title: string; description: string; siteId?: string; bookingId?: string },
) {
  const accountId = accountIds(identity)[0];
  if (!accountId) return { ok: false as const, error: "No commercial relationship on this account." };
  const title = String(input.title || "").trim().slice(0, 200);
  const description = String(input.description || "").trim().slice(0, 4000);
  if (!title) return { ok: false as const, error: "Add a short title for the issue." };

  const supabase = getAdminSupabase();
  let bookingId: string | null = null;
  let siteId: string | null = null;
  if (input.bookingId) {
    const { data: b } = await supabase
      .from("bookings")
      .select("id, business_account_id, business_site_id")
      .eq("id", input.bookingId)
      .maybeSingle();
    if (b && ownsAccount(identity, b.business_account_id)) {
      bookingId = b.id;
      siteId = b.business_site_id;
    }
  }
  if (!siteId && input.siteId) {
    const { data: site } = await supabase
      .from("business_sites")
      .select("id, business_account_id")
      .eq("id", input.siteId)
      .maybeSingle();
    if (site && ownsAccount(identity, site.business_account_id)) siteId = site.id;
  }

  const { data: issue, error } = await supabase
    .from("qc_issues")
    .insert({
      booking_id: bookingId,
      business_account_id: accountId,
      business_site_id: siteId,
      partner_identity_id: identity.id,
      issue_type: "complaint",
      severity: "medium",
      status: "open",
      title,
      description,
      reported_via: "partner_portal",
      reported_by_name: identity.displayName || identity.email,
      client_name: identity.accounts[0]?.businessName || identity.email,
      client_email: identity.email,
      client_type: "commercial",
    })
    .select("id, issue_number")
    .single();
  if (error) return { ok: false as const, error: error.message };

  await supabase.from("events").insert({
    event_type: "partner.commercial.issue_reported",
    source: "partner-portal",
    summary: `Commercial client reported an issue: ${title}`,
    data: { business_account_id: accountId, qc_issue_id: issue.id, site_id: siteId, booking_id: bookingId },
  });
  return { ok: true as const, issueId: issue.id, issueNumber: issue.issue_number };
}
