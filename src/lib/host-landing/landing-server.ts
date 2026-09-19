// ─── Server: public STR landing estimate + Claim / Book a Call ─────────────
//
// try.novaracleaning.com/str is an acquisition front door, not a second
// rate table. Estimates and Claim both call computeTurnoverQuote (Agreement
// Part Two). Typical listings mint the existing tokenized host onboarding
// session with properties already priced; unusual ones book a call.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendHostOnboardingLink, startHostOnboardingSession } from "@/lib/host-onboarding/admin";
import { HOST_ONBOARDING_PATH, onboardingUrl } from "@/lib/host-onboarding/session";
import { HOST_QUOTE_LOCK_HOURS } from "@/lib/host-onboarding/rates";
import { requestIsLocal } from "@/lib/partner-portal/origins";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import {
  ESTIMATE_DISCLAIMER,
  LANDING_PROPERTY_TAG,
  STR_CAL_LINK,
  STR_PATH,
  STR_URL,
  estimateStrLanding,
  type StrCta,
  type StrEstimateInput,
  type StrEstimateResult,
  type StrListingInput,
} from "./landing";

type Admin = ReturnType<typeof getAdminSupabase>;
type Row = Record<string, unknown>;

const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function emailOk(value: string): boolean {
  return /.+@.+\..+/.test(value);
}

function numOrNull(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function parseEstimateInput(body: Record<string, unknown>): StrEstimateInput {
  const mode = body.mode === "mixed" ? "mixed" : "uniform";
  const rawListings = Array.isArray(body.listings) ? body.listings : [];
  const avg = (body.average || {}) as Record<string, unknown>;
  return {
    mode,
    listingCount: Number(body.listingCount || rawListings.length || 0),
    flaggedAtypical: body.flaggedAtypical === true,
    average: {
      bedrooms: numOrNull(avg.bedrooms),
      bathrooms: numOrNull(avg.bathrooms),
      linen: avg.linen === true,
      restock: avg.restock === true,
    },
    listings: rawListings.map((row) => {
      const l = (row || {}) as Record<string, unknown>;
      return {
        label: clip(l.label, 80) || null,
        bedrooms: numOrNull(l.bedrooms),
        bathrooms: numOrNull(l.bathrooms),
        linen: l.linen === true,
        restock: l.restock === true,
        flaggedNonStandard: l.flaggedNonStandard === true,
      } satisfies StrListingInput;
    }),
  };
}

export function estimateLandingStr(input: StrEstimateInput): StrEstimateResult {
  return estimateStrLanding(input);
}

export function landingOnboardingUrl(req: Request, token: string): string {
  if (requestIsLocal(req)) {
    const url = new URL(req.url);
    const host = req.headers.get("host") || url.host;
    const proto = url.protocol === "https:" ? "https" : "http";
    return `${proto}://${host}${HOST_ONBOARDING_PATH}/${token}`;
  }
  return onboardingUrl(token);
}

export function discoveryCalendarUrl(): string {
  const fromEnv =
    clip(process.env.NEXT_PUBLIC_STR_DISCOVERY_CALENDAR_URL, 400) ||
    clip(process.env.NEXT_PUBLIC_PM_DISCOVERY_CALENDAR_URL, 400);
  if (fromEnv && /^https:\/\//i.test(fromEnv)) return fromEnv;
  return `https://cal.com/${STR_CAL_LINK}`;
}

function contactFrom(body: Record<string, unknown>) {
  const name = clip(body.contactName || body.name || body.fullName, 120);
  const email = clip(body.email, 200).toLowerCase();
  const phone = clip(body.phone, 40).replace(/\D/g, "");
  return { name, email, phone };
}

function contactError(c: { name: string; email: string; phone: string }): string | null {
  if (c.name.length < 2) return "Add your name.";
  if (!emailOk(c.email)) return "A valid email is required.";
  if (c.phone.length < 10) return "A valid phone number is required.";
  return null;
}

function quoteLockedUntilIso(): string {
  return new Date(Date.now() + HOST_QUOTE_LOCK_HOURS * 3600_000).toISOString();
}

function landingNote(listing: StrEstimateResult["listings"][number], lockedUntil: string): string {
  const extras = [
    listing.linen ? "linen included" : "linen not included",
    listing.restock ? "restock included" : "restock not included",
  ].join(", ");
  return [
    LANDING_PROPERTY_TAG,
    `Quoted from ${STR_URL}.`,
    `Estimate (Agreement Part Two ${listing.quote.band?.label || "band"}): $${listing.quote.min}–$${listing.quote.max}/turnover.`,
    `Claimed rate $${listing.quote.claimed} locked until ${lockedUntil}.`,
    extras,
  ].join(" ");
}

function listingAddress(listing: StrListingInput, index: number): string {
  const label = clip(listing.label, 80) || `Listing ${index + 1}`;
  return `${label} — address confirmed at onboarding`;
}

async function upsertHost(
  supabase: Admin,
  input: { name: string; email: string; phone: string },
): Promise<{ ok: true; id: string } | { ok: false; status: number; message: string }> {
  const email = input.email.toLowerCase();
  const { data: existing } = await supabase
    .from("hosts")
    .select("id, name, phone")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    await supabase
      .from("hosts")
      .update({
        name: input.name || (existing as Row).name || null,
        phone: input.phone || (existing as Row).phone || null,
      })
      .eq("id", existing.id);
    return { ok: true, id: String(existing.id) };
  }
  const { data, error } = await supabase
    .from("hosts")
    .insert({
      email,
      name: input.name || null,
      phone: input.phone || null,
    })
    .select("id")
    .maybeSingle();
  if (error || !data?.id) {
    return { ok: false, status: 400, message: error?.message || "Could not create the host account." };
  }
  return { ok: true, id: String(data.id) };
}

async function ensurePricedLandingProperties(
  supabase: Admin,
  hostId: string,
  estimate: StrEstimateResult,
  lockedUntil: string,
): Promise<{ ok: true } | { ok: false; status: number; message: string; cta?: StrCta }> {
  const { data: existing } = await supabase.from("properties").select("*").eq("host_id", hostId);
  const rows = (existing || []) as Row[];
  const landing = rows.filter((p) => String(p.special_notes || "").includes(LANDING_PROPERTY_TAG));
  const other = rows.filter((p) => !String(p.special_notes || "").includes(LANDING_PROPERTY_TAG));
  const otherUnpriced = other.filter((p) => p.turnover_price == null || Number(p.turnover_price) <= 0);
  if (otherUnpriced.length > 0) {
    return {
      ok: false,
      status: 409,
      cta: "book_call",
      message: "This account already has unpriced properties — book a call and we'll finish the schedule.",
    };
  }

  for (let i = 0; i < estimate.listings.length; i++) {
    const listing = estimate.listings[i];
    const patch = {
      nickname: listing.label || `Listing ${i + 1}`,
      address: listingAddress(listing, i),
      bedrooms: listing.bedrooms,
      bathrooms: listing.bathrooms,
      laundry_included: listing.linen,
      restock_included: listing.restock,
      turnover_price: listing.quote.claimed,
      special_notes: landingNote(listing, lockedUntil),
    };
    const prior = landing[i];
    if (prior?.id) {
      const { error } = await supabase.from("properties").update(patch).eq("id", prior.id);
      if (error) return { ok: false, status: 400, message: error.message };
    } else {
      const { error } = await supabase.from("properties").insert({ host_id: hostId, ...patch });
      if (error) return { ok: false, status: 400, message: error.message };
    }
  }
  return { ok: true };
}

async function recordSubmission(
  supabase: Admin,
  input: {
    hostId: string;
    name: string;
    email: string;
    phone: string;
    estimate: StrEstimateResult;
    lockedUntil: string;
  },
): Promise<string | null> {
  const properties = input.estimate.listings.map((l, i) => ({
    nickname: l.label || `Listing ${i + 1}`,
    address: listingAddress(l, i),
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    linen: l.linen,
    restock: l.restock,
    turnover_price: l.quote.claimed,
    quote_locked_until: input.lockedUntil,
  }));
  const { data } = await supabase
    .from("host_onboarding_submissions")
    .insert({
      host_id: input.hostId,
      full_name: input.name,
      email: input.email,
      phone: input.phone,
      entity_type: "individual",
      properties,
      consent_agreement: false,
      status: "submitted",
    })
    .select("id")
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

export async function claimTypicalHost(
  supabase: Admin,
  req: Request,
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  status: number;
  cta?: StrCta;
  message?: string;
  onboardingUrl?: string;
  sessionId?: string;
  token?: string;
  emailed?: boolean;
  texted?: boolean;
  lockedUntil?: string;
  estimate?: StrEstimateResult;
}> {
  const contact = contactFrom(body);
  const invalid = contactError(contact);
  if (invalid) return { ok: false, status: 400, message: invalid };

  const input = parseEstimateInput(body);
  const estimate = estimateLandingStr(input);
  if (estimate.cta !== "claim" || !estimate.ok) {
    return {
      ok: false,
      status: 409,
      cta: "book_call",
      estimate,
      message: estimate.reasons[0]?.message || "This listing needs a call rather than instant onboarding.",
    };
  }

  const host = await upsertHost(supabase, contact);
  if (host.ok === false) return { ok: false, status: host.status, message: host.message };

  const lockedUntil = quoteLockedUntilIso();
  const priced = await ensurePricedLandingProperties(supabase, host.id, estimate, lockedUntil);
  if (priced.ok === false) {
    return { ok: false, status: priced.status, cta: priced.cta, message: priced.message, estimate };
  }

  await recordSubmission(supabase, {
    hostId: host.id,
    name: contact.name,
    email: contact.email,
    phone: contact.phone,
    estimate,
    lockedUntil,
  });

  const started = await startHostOnboardingSession(supabase, {
    hostId: host.id,
    actorName: "str-landing",
    recipientName: contact.name,
    recipientEmail: contact.email,
    recipientPhone: contact.phone,
    send: false,
  });
  if (!started.ok || !started.token) {
    return {
      ok: false,
      status: started.status || 400,
      message: started.message || "Could not open onboarding.",
      estimate,
    };
  }

  const continueUrl = landingOnboardingUrl(req, started.token);
  const sent = await sendHostOnboardingLink(supabase, {
    sessionId: String(started.sessionId),
    hostName: contact.name,
    recipientName: contact.name,
    recipientEmail: contact.email,
    recipientPhone: contact.phone,
    link: continueUrl,
    hostId: host.id,
    rateSummary: estimate.listings
      .map((p) => `${p.label || "Listing"}: $${p.quote.claimed}/turnover (locked ${HOST_QUOTE_LOCK_HOURS}h)`)
      .join("; "),
  });

  await supabase.from("events").insert({
    event_type: "host.landing.claimed",
    source: "str-landing",
    summary: `${contact.name} claimed an STR rate (${estimate.listingCount} listing${estimate.listingCount === 1 ? "" : "s"}).`,
    data: {
      host_id: host.id,
      session_id: started.sessionId,
      listing_count: estimate.listingCount,
      claimed: estimate.claimed,
      quote_locked_until: lockedUntil,
      path: STR_PATH,
    },
  });

  return {
    ok: true,
    status: 200,
    cta: "claim",
    onboardingUrl: continueUrl,
    sessionId: started.sessionId,
    token: started.token,
    emailed: sent.emailed,
    texted: sent.texted,
    lockedUntil,
    estimate,
  };
}

export async function bookCallStr(
  supabase: Admin,
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  status: number;
  message?: string;
  calendarUrl?: string | null;
  leadId?: string | null;
}> {
  const contact = contactFrom(body);
  const invalid = contactError(contact);
  if (invalid) return { ok: false, status: 400, message: invalid };

  const input = parseEstimateInput(body);
  const estimate = estimateLandingStr(input);
  const notes = clip(body.notes, 2000);
  const summaryListings = estimate.listings
    .slice(0, 8)
    .map((l, i) => {
      const size = [l.bedrooms != null ? `${l.bedrooms} bd` : null, l.bathrooms != null ? `${l.bathrooms} ba` : null]
        .filter(Boolean)
        .join(" · ");
      return `${l.label || `Listing ${i + 1}`}${size ? ` (${size})` : ""}`;
    })
    .join("; ");

  const account = await upsertHost(supabase, contact);
  if (account.ok === false) return { ok: false, status: account.status, message: account.message };

  const [firstName, ...rest] = contact.name.split(/\s+/);
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id")
    .ilike("email", contact.email)
    .eq("source", "str_landing")
    .not("status", "in", "(won,lost,closed)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const leadPatch = {
    first_name: firstName,
    last_name: rest.join(" ") || "",
    email: contact.email,
    phone: contact.phone,
    source: "str_landing",
    channel: STR_URL,
    status: "new",
    lead_score: estimate.listingCount > 4 ? "hot" : "warm",
    service_type: "str_turnover",
    property_type: "short_term_rental",
    urgency: clip(body.timing, 80) || null,
    notes: [
      `Listings: ${estimate.listingCount}`,
      summaryListings ? `Preview: ${summaryListings}` : null,
      estimate.reasons.map((r) => r.message).join(" ") || null,
      notes || null,
    ]
      .filter(Boolean)
      .join("\n"),
  };

  let leadId: string | null = existingLead?.id ? String(existingLead.id) : null;
  if (leadId) {
    await supabase.from("leads").update(leadPatch).eq("id", leadId);
  } else {
    const { data: inserted } = await supabase.from("leads").insert(leadPatch).select("id").maybeSingle();
    leadId = inserted?.id ? String(inserted.id) : null;
  }

  const calendarUrl = discoveryCalendarUrl();

  await notifyStrAdmin(supabase, {
    subject: `STR discovery call — ${contact.name}`,
    html: [
      `<p><strong>${escapeHtml(contact.name)}</strong> asked to book a call from the STR landing page.</p>`,
      `<p>${escapeHtml(contact.email)} · ${escapeHtml(contact.phone)}</p>`,
      `<p>${estimate.listingCount} listing${estimate.listingCount === 1 ? "" : "s"}. ${escapeHtml(
        estimate.reasons.map((r) => r.message).join(" ") || "Unusual or large STR portfolio.",
      )}</p>`,
      summaryListings ? `<p>${escapeHtml(summaryListings)}</p>` : "",
      notes ? `<p>${escapeHtml(notes)}</p>` : "",
      `<p>Review before generating host onboarding. Do not auto-send the agreement until the schedule is priced.</p>`,
    ].join(""),
    eventType: "host.landing.call_requested",
    summary: `${contact.name} booked an STR discovery call (${estimate.listingCount} listings).`,
    data: {
      host_id: account.id,
      lead_id: leadId,
      listing_count: estimate.listingCount,
      reasons: estimate.reasons,
    },
  });

  return {
    ok: true,
    status: 200,
    calendarUrl,
    leadId,
    message: "Pick a time below — we'll review the listings before onboarding.",
  };
}

async function notifyStrAdmin(
  supabase: Admin,
  input: {
    subject: string;
    html: string;
    eventType: string;
    summary: string;
    data: Record<string, unknown>;
  },
): Promise<void> {
  await supabase.from("events").insert({
    event_type: input.eventType,
    source: "str-landing",
    summary: input.summary,
    data: input.data,
  });

  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "host_onboarding_settings")
    .maybeSingle();
  const notify =
    (setting?.value as { notify_email?: string } | null)?.notify_email ||
    process.env.HOST_ONBOARDING_NOTIFY_EMAIL ||
    null;
  if (!notify) return;
  await sendPartnershipMessage(supabase, {
    templateKey: "admin_internal_notice",
    trigger: input.eventType,
    role: "admin",
    email: notify,
    subject: input.subject,
    html: input.html,
    vars: { subject_line: input.subject, body_html: input.html },
  }).catch(() => null);
}

function escapeHtml(value: string): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export { ESTIMATE_DISCLAIMER };
