// ─── Server: STR landing estimate + Claim This Rate / Book a Call ──────────
//
// The page never prices in the browser. Estimate, Claim, and Book a Call all
// come through here so they share the Part Two reference bands, the existing
// typical/unusual split, and the EXISTING tokenized host onboarding session.
//
// Claim captures name, email, phone, and the individual-vs-entity answer
// only. It then mints properties at their band rate and hands off to
// `startHostOnboardingSession` — the same three pages an admin-sent proposal
// opens. No parallel onboarding.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { requestIsLocal } from "@/lib/partner-portal/origins";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import {
  onboardingUrl,
  HOST_ONBOARDING_PATH,
} from "@/lib/host-onboarding/session";
import {
  sendHostOnboardingLink,
  startHostOnboardingSession,
} from "@/lib/host-onboarding/admin";
import {
  ACTIVE_INTRO_RATE,
  introDisclosure,
  quoteBreakdown,
} from "@/lib/host-onboarding/rate-bands";
import {
  LANDING_PROPERTY_TAG,
  STR_CAL_LINK,
  STR_PATH,
  STR_QUOTE_LOCK_HOURS,
  STR_URL,
  claimContactError,
  estimateStr,
  parseClaimContact,
  parseStrProperties,
  requiresPersonalGuarantee,
  type StrCta,
  type StrEstimateResult,
  type StrPropertyInput,
} from "./landing";

type Admin = ReturnType<typeof getAdminSupabase>;

const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function escapeHtml(value: string): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function quoteLockedUntilIso(): string {
  return new Date(Date.now() + STR_QUOTE_LOCK_HOURS * 3600_000).toISOString();
}

export function strEstimate(properties: StrPropertyInput[]): StrEstimateResult {
  return estimateStr(properties, introDisclosure(ACTIVE_INTRO_RATE));
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

export function discoveryCalendarUrl(raw: Record<string, unknown> | null | undefined): string {
  const fromSettings = clip(raw?.discovery_calendar_url, 400);
  const fromEnv = clip(process.env.NEXT_PUBLIC_STR_DISCOVERY_CALENDAR_URL, 400);
  const url = fromSettings || fromEnv;
  if (url && /^https:\/\//i.test(url)) return url;
  return `https://cal.com/${STR_CAL_LINK}`;
}

async function notifyHostAdmin(
  supabase: Admin,
  input: { subject: string; html: string; eventType: string; summary: string; data: Record<string, unknown> },
): Promise<void> {
  await supabase.from("events").insert({
    event_type: input.eventType,
    source: "str-landing",
    summary: input.summary,
    data: input.data,
  });

  const notify = process.env.HOST_ONBOARDING_NOTIFY_EMAIL || process.env.PROPERTY_MANAGER_NOTIFY_EMAIL || null;
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

// ─── Host + property provisioning ──────────────────────────────────────────

async function upsertHost(
  supabase: Admin,
  input: { name: string; email: string; phone: string },
): Promise<{ ok: true; id: string } | { ok: false; status: number; message: string }> {
  const email = input.email.toLowerCase();
  const { data: existing } = await supabase
    .from("hosts")
    .select("id")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from("hosts")
      .update({ name: input.name, phone: input.phone })
      .eq("id", existing.id);
    return { ok: true, id: String(existing.id) };
  }

  const { data, error } = await supabase
    .from("hosts")
    .insert({ name: input.name, email, phone: input.phone })
    .select("id")
    .single();
  if (error || !data?.id) {
    return { ok: false, status: 400, message: error?.message || "Could not create the host record." };
  }
  return { ok: true, id: String(data.id) };
}

/**
 * Write each claimed property at its Part Two band rate. A re-claim from the
 * same landing page updates the matching property rather than duplicating it.
 * Every row lands priced — `startHostOnboardingSession` refuses unpriced ones
 * (§5.2), which is the guardrail we want, not one to work around.
 */
async function ensurePricedProperties(
  supabase: Admin,
  hostId: string,
  estimate: StrEstimateResult,
): Promise<{ ok: true; count: number } | { ok: false; status: number; message: string }> {
  const { data: existingRows } = await supabase
    .from("properties")
    .select("id, address")
    .eq("host_id", hostId);
  const byAddress = new Map(
    ((existingRows || []) as Array<{ id: string; address: string | null }>).map((r) => [
      String(r.address || "").trim().toLowerCase(),
      String(r.id),
    ]),
  );

  let count = 0;
  for (const p of estimate.properties) {
    const rate = p.quote.standardRate;
    if (rate == null) {
      return {
        ok: false,
        status: 409,
        message: p.quote.message || "One of these properties needs a custom quote.",
      };
    }
    const row = {
      host_id: hostId,
      nickname: p.label,
      address: p.address,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      laundry_included: p.linen,
      restock_included: p.restock,
      turnover_price: rate,
      special_notes: `${LANDING_PROPERTY_TAG}: ${quoteBreakdown(p.quote)}`,
    };
    const existingId = byAddress.get(p.address.trim().toLowerCase());
    const { error } = existingId
      ? await supabase.from("properties").update(row).eq("id", existingId)
      : await supabase.from("properties").insert(row);
    if (error) return { ok: false, status: 400, message: error.message };
    count += 1;
  }
  return { ok: true, count };
}

/**
 * The submission row carries the individual-vs-entity answer. It is what
 * `sessionPayload` reads to decide whether the Personal Guarantee block is
 * presented at signature, so the claim must write it.
 */
async function recordSubmission(
  supabase: Admin,
  input: {
    hostId: string;
    fullName: string;
    email: string;
    phone: string;
    entityType: "individual" | "entity";
    entityName: string | null;
    lockedUntil: string;
    estimate: StrEstimateResult;
  },
): Promise<string | null> {
  const { data } = await supabase
    .from("host_onboarding_submissions")
    .insert({
      host_id: input.hostId,
      full_name: input.fullName,
      email: input.email,
      phone: input.phone,
      entity_type: input.entityType,
      entity_name: input.entityName,
      // The claimed submission — this is what Page 2 pre-fills from on the
      // self-serve path, in place of the admin-generated proposal.
      properties: input.estimate.properties.map((p) => ({
        nickname: p.label,
        address: p.address,
        bedrooms: p.bedrooms,
        bathrooms: p.bathrooms,
        linen: p.linen,
        restock: p.restock,
        band: p.quote.bandLabel,
        turnover_price: p.quote.standardRate,
        breakdown: quoteBreakdown(p.quote),
        quote_locked_until: input.lockedUntil,
        source: LANDING_PROPERTY_TAG,
      })),
      status: "pending_pricing",
    })
    .select("id")
    .maybeSingle();
  return data?.id ? String(data.id) : null;
}

// ─── Claim This Rate ───────────────────────────────────────────────────────

export interface ClaimResult {
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
  propertyCount?: number;
  requiresPersonalGuarantee?: boolean;
  estimate?: StrEstimateResult;
}

export async function claimStrRate(
  supabase: Admin,
  req: Request,
  body: Record<string, unknown>,
): Promise<ClaimResult> {
  const contact = parseClaimContact(body);
  const invalid = claimContactError(contact);
  if (invalid) return { ok: false, status: 400, message: invalid };
  // Narrowed by claimContactError; re-stated so the type follows.
  const entityType = contact.entityType as "individual" | "entity";

  const properties = parseStrProperties(body.properties);
  const estimate = strEstimate(properties);
  if (estimate.cta !== "claim" || !estimate.ok) {
    return {
      ok: false,
      status: 409,
      cta: "book_call",
      estimate,
      message:
        estimate.cta === "incomplete"
          ? "Add a bedroom count for every property before claiming a rate."
          : estimate.reasons[0]?.message ||
            "These properties need a call rather than an instant rate.",
    };
  }

  const lockedUntil = quoteLockedUntilIso();
  const host = await upsertHost(supabase, {
    name: contact.fullName,
    email: contact.email,
    phone: contact.phone,
  });
  if (host.ok === false) return { ok: false, status: host.status, message: host.message };

  const priced = await ensurePricedProperties(supabase, host.id, estimate);
  if (priced.ok === false) {
    return { ok: false, status: priced.status, cta: "book_call", message: priced.message, estimate };
  }

  await recordSubmission(supabase, {
    hostId: host.id,
    fullName: contact.fullName,
    email: contact.email,
    phone: contact.phone,
    entityType,
    entityName: contact.entityName,
    lockedUntil,
    estimate,
  });

  // The existing tokenized session. `send: false` because we send the link
  // ourselves below, after we know the continue-in-browser URL.
  const started = await startHostOnboardingSession(supabase, {
    hostId: host.id,
    actorName: "str-landing",
    recipientName: contact.fullName,
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
    hostId: host.id,
    hostName: contact.fullName,
    recipientName: contact.fullName,
    recipientEmail: contact.email,
    recipientPhone: contact.phone,
    link: continueUrl,
    rateSummary: estimate.properties
      .map((p) => `${p.label}: $${p.quote.standardRate}/turnover (locked ${STR_QUOTE_LOCK_HOURS}h)`)
      .join("; "),
  });

  await supabase.from("events").insert({
    event_type: "host.landing.claimed",
    source: "str-landing",
    summary: `${contact.fullName} claimed an STR turnover rate (${estimate.propertyCount} propert${
      estimate.propertyCount === 1 ? "y" : "ies"
    }).`,
    data: {
      host_id: host.id,
      session_id: started.sessionId,
      property_count: estimate.propertyCount,
      entity_type: entityType,
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
    propertyCount: estimate.propertyCount,
    requiresPersonalGuarantee: requiresPersonalGuarantee(entityType),
    estimate,
  };
}

// ─── Book a Call ───────────────────────────────────────────────────────────

export async function bookStrCall(
  supabase: Admin,
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  status: number;
  message?: string;
  calendarUrl?: string | null;
  leadId?: string | null;
}> {
  const contact = parseClaimContact(body);
  // Book a Call is a lead, not a signature — the entity answer is optional here.
  if (contact.fullName.length < 2) return { ok: false, status: 400, message: "Enter your name." };
  if (!/.+@.+\..+/.test(contact.email)) return { ok: false, status: 400, message: "Enter a valid email address." };
  if (contact.phone.replace(/\D/g, "").length < 10) {
    return { ok: false, status: 400, message: "Enter a valid phone number." };
  }

  const properties = parseStrProperties(body.properties);
  const estimate = strEstimate(properties);
  const notes = clip(body.notes, 2000);
  const timing = clip(body.timing, 80);

  const summary = estimate.properties
    .slice(0, 8)
    .map((p) => {
      const size = [
        p.bedrooms != null ? `${p.bedrooms} bd` : null,
        p.bathrooms != null ? `${p.bathrooms} ba` : null,
      ]
        .filter(Boolean)
        .join(" · ");
      return `${p.label}${size ? ` (${size})` : ""}`;
    })
    .join("; ");

  const [firstName, ...rest] = contact.fullName.split(/\s+/);
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
    lead_score: estimate.propertyCount >= 5 ? "hot" : "warm",
    service_type: "str_turnover",
    property_type: "short_term_rental",
    urgency: timing || null,
    notes: [
      `Name: ${contact.fullName}`,
      `Properties: ${estimate.propertyCount}`,
      summary ? `Preview: ${summary}` : null,
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

  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "host_onboarding_settings")
    .maybeSingle();
  const calendarUrl = discoveryCalendarUrl((setting?.value || null) as Record<string, unknown> | null);

  await notifyHostAdmin(supabase, {
    subject: `STR discovery call — ${contact.fullName}`,
    html: [
      `<p><strong>${escapeHtml(contact.fullName)}</strong> asked to book a call from the STR landing page.</p>`,
      `<p>${escapeHtml(contact.email)} · ${escapeHtml(contact.phone)}</p>`,
      `<p>${estimate.propertyCount} propert${estimate.propertyCount === 1 ? "y" : "ies"}. ${escapeHtml(
        estimate.reasons.map((r) => r.message).join(" ") || "Outside the standard reference bands.",
      )}</p>`,
      summary ? `<p>${escapeHtml(summary)}</p>` : "",
      notes ? `<p>${escapeHtml(notes)}</p>` : "",
      `<p>Price the properties under Section 5 before sending onboarding. Do not auto-send.</p>`,
    ].join(""),
    eventType: "host.landing.call_requested",
    summary: `${contact.fullName} booked an STR discovery call (${estimate.propertyCount} properties).`,
    data: { lead_id: leadId, property_count: estimate.propertyCount, reasons: estimate.reasons },
  });

  return {
    ok: true,
    status: 200,
    calendarUrl,
    leadId,
    message: "Pick a time below — we'll price these properties before onboarding.",
  };
}
