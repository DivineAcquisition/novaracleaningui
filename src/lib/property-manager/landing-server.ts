// ─── Server: public portfolio landing estimate + conversion ────────────────
//
// The page never prices in the browser. Estimate, Get Started, and Book a
// Call all come through here so they share the live residential engine, the
// existing typical/unusual split, the unit registry, and the tokenized
// onboarding session.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { onboardingUrl, PM_ONBOARDING_PATH } from "@/lib/property-manager/onboarding/session";
import { startPmOnboardingSession } from "@/lib/property-manager/onboarding/admin";
import { requestIsLocal } from "@/lib/partner-portal/origins";
import { notifyPmAdmin, registerUnit } from "@/lib/property-manager/registry";
import {
  expandEstimateUnits,
  portfolioCtaFor,
  ESTIMATE_DISCLAIMER,
  type EstimateUnitInput,
  type PortfolioCta,
  type PortfolioEstimateInput,
  type PortfolioEstimateResult,
} from "./landing";
import { estimatePortfolioFromContext } from "./landing-estimate";
import {
  loadPmPricingContext,
  loadPmSettings,
  resolveUnitZone,
  type PmPricingContext,
} from "./pricing-server";

type Admin = ReturnType<typeof getAdminSupabase>;
type Row = Record<string, unknown>;

const clip = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);

function emailOk(value: string): boolean {
  return /.+@.+\..+/.test(value);
}

export function parseEstimateInput(body: Record<string, unknown>): PortfolioEstimateInput {
  const mode = body.mode === "mixed" ? "mixed" : "uniform";
  const rawUnits = Array.isArray(body.units) ? body.units : [];
  const avg = (body.average || {}) as Record<string, unknown>;
  return {
    mode,
    unitCount: Number(body.unitCount || rawUnits.length || 0),
    portfolioZip: clip(body.portfolioZip, 10) || null,
    flaggedAtypical: body.flaggedAtypical === true,
    average: {
      sqft: avg.sqft == null ? null : Number(avg.sqft),
      bedrooms: avg.bedrooms == null ? null : Number(avg.bedrooms),
      bathrooms: avg.bathrooms == null ? null : Number(avg.bathrooms),
    },
    units: rawUnits.map((row) => {
      const u = (row || {}) as Record<string, unknown>;
      return {
        label: clip(u.label, 80) || null,
        sqft: u.sqft == null ? null : Number(u.sqft),
        bedrooms: u.bedrooms == null ? null : Number(u.bedrooms),
        bathrooms: u.bathrooms == null ? null : Number(u.bathrooms),
        zipCode: clip(u.zipCode || u.zip, 10) || null,
        address: clip(u.address, 300) || null,
        city: clip(u.city, 120) || null,
        state: clip(u.state, 40) || null,
        flaggedNonStandard: u.flaggedNonStandard === true,
      } satisfies EstimateUnitInput;
    }),
  };
}

async function zoneHints(
  supabase: Admin,
  ctx: PmPricingContext,
  units: EstimateUnitInput[],
) {
  const zoneByIndex: Array<PmPricingContext["zones"][number] | null> = [];
  const zoneServedByIndex: Array<boolean | undefined> = [];
  for (const unit of units) {
    const zip = String(unit.zipCode || "").trim();
    if (!/^\d{5}$/.test(zip)) {
      zoneByIndex.push(null);
      zoneServedByIndex.push(undefined);
      continue;
    }
    const resolved = await resolveUnitZone(supabase, zip, ctx.zones);
    zoneByIndex.push(resolved.zone);
    zoneServedByIndex.push(resolved.served);
  }
  return { zoneByIndex, zoneServedByIndex };
}

export async function estimateLandingPortfolio(
  supabase: Admin,
  input: PortfolioEstimateInput,
): Promise<PortfolioEstimateResult> {
  const ctx = await loadPmPricingContext(supabase);
  if (!ctx) {
    const units = expandEstimateUnits(input);
    const settings = await loadPmSettings(supabase);
    const split = portfolioCtaFor(units, {
      flaggedAtypical: input.flaggedAtypical,
      bounds: settings.bounds,
    });
    return {
      ok: false,
      cta: "book_call",
      estimate: true,
      disclaimer: ESTIMATE_DISCLAIMER,
      unitCount: units.length,
      units,
      discount: { percent: 0, label: null, unitCount: units.length, unitsToNextTier: null, nextPercent: null },
      ranges: [],
      unitEstimates: [],
      reasons: split.reasons,
      message: "Live pricing isn't available right now. Book a call and we'll price the portfolio.",
    };
  }

  const units = expandEstimateUnits(input);
  const hints = await zoneHints(supabase, ctx, units);
  return estimatePortfolioFromContext(ctx, input, hints);
}

export function landingOnboardingUrl(req: Request, token: string): string {
  if (requestIsLocal(req)) {
    const url = new URL(req.url);
    const host = req.headers.get("host") || url.host;
    const proto = url.protocol === "https:" ? "https" : "http";
    return `${proto}://${host}${PM_ONBOARDING_PATH}/${token}`;
  }
  return onboardingUrl(token);
}

export function discoveryCalendarUrl(raw: Record<string, unknown> | null | undefined): string | null {
  const fromSettings = clip(raw?.discovery_calendar_url, 400);
  const fromEnv = clip(process.env.NEXT_PUBLIC_PM_DISCOVERY_CALENDAR_URL, 400);
  const url = fromSettings || fromEnv;
  if (!url) return null;
  if (!/^https:\/\//i.test(url)) return null;
  return url;
}

async function upsertPmAccount(
  supabase: Admin,
  input: {
    companyName: string;
    contactName: string;
    email: string;
    phone: string;
    notes?: string | null;
  },
): Promise<{ ok: true; id: string } | { ok: false; status: number; message: string }> {
  const email = input.email.toLowerCase();
  const { data: existing } = await supabase
    .from("property_manager_accounts")
    .select("id, notes")
    .ilike("email", email)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing?.id) {
    await supabase
      .from("property_manager_accounts")
      .update({
        company_name: input.companyName,
        contact_name: input.contactName,
        phone: input.phone || null,
        notes: input.notes || (existing as Row).notes || null,
      })
      .eq("id", existing.id);
    return { ok: true, id: String(existing.id) };
  }
  const { data, error } = await supabase
    .from("property_manager_accounts")
    .insert({
      company_name: input.companyName,
      contact_name: input.contactName,
      email,
      phone: input.phone || null,
      notes: input.notes || null,
      created_by_name: "portfolio-landing",
    })
    .select("id")
    .maybeSingle();
  if (error || !data?.id) {
    return { ok: false, status: 400, message: error?.message || "Could not create the account." };
  }
  return { ok: true, id: String(data.id) };
}

function contactFrom(body: Record<string, unknown>) {
  const companyName = clip(body.companyName || body.company, 200);
  const contactName = clip(body.contactName || body.name, 120);
  const email = clip(body.email, 200).toLowerCase();
  const phone = clip(body.phone, 40).replace(/\D/g, "");
  return { companyName, contactName, email, phone };
}

function contactError(c: { companyName: string; contactName: string; email: string; phone: string }): string | null {
  if (c.companyName.length < 2) return "Add the management company or owner name.";
  if (c.contactName.length < 2) return "Add your name.";
  if (!emailOk(c.email)) return "A valid email is required.";
  if (c.phone.length < 10) return "A valid phone number is required.";
  return null;
}

function unitAddress(unit: EstimateUnitInput, index: number): string {
  const typed = clip(unit.address, 300);
  if (typed.length >= 5) return typed;
  const zip = clip(unit.zipCode, 10);
  const label = clip(unit.label, 80) || `Unit ${index + 1}`;
  if (zip) return `${label}, ${zip}`;
  return label.length >= 5 ? label : `${label} — address at onboarding`;
}

export async function startTypicalPortfolio(
  supabase: Admin,
  req: Request,
  body: Record<string, unknown>,
): Promise<{
  ok: boolean;
  status: number;
  cta?: PortfolioCta;
  message?: string;
  onboardingUrl?: string;
  sessionId?: string;
  unitCount?: number;
  estimate?: PortfolioEstimateResult;
}> {
  const contact = contactFrom(body);
  const invalid = contactError(contact);
  if (invalid) return { ok: false, status: 400, message: invalid };

  const input = parseEstimateInput(body);
  const estimate = await estimateLandingPortfolio(supabase, input);
  if (estimate.cta !== "get_started") {
    return {
      ok: false,
      status: 409,
      cta: "book_call",
      estimate,
      message: "This portfolio needs a call rather than instant onboarding.",
    };
  }

  const missingZip = estimate.units.some((u) => !/^\d{5}$/.test(String(u.zipCode || "")));
  if (missingZip) {
    return {
      ok: false,
      status: 400,
      message: "Add a 5-digit ZIP for the portfolio (or each unit) so we can set the service zone.",
    };
  }

  const account = await upsertPmAccount(supabase, {
    ...contact,
    notes: `Landing estimate: ${estimate.unitCount} units. ${estimate.disclaimer}`,
  });
  if (account.ok === false) return { ok: false, status: account.status, message: account.message };

  const { data: existingUnits } = await supabase
    .from("property_manager_units")
    .select("address")
    .eq("pm_account_id", account.id)
    .neq("status", "inactive");
  const seen = new Set(
    ((existingUnits || []) as Array<{ address?: string | null }>).map((u) =>
      clip(u.address, 300).toLowerCase(),
    ),
  );

  const ctx = await loadPmPricingContext(supabase);
  for (let i = 0; i < estimate.units.length; i++) {
    const unit = estimate.units[i];
    const address = unitAddress(unit, i);
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    const registered = await registerUnit(
      supabase,
      {
        pmAccountId: account.id,
        unitLabel: unit.label,
        address,
        city: unit.city,
        state: unit.state,
        zipCode: unit.zipCode,
        sqft: unit.sqft,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        flaggedNonStandard: !!unit.flaggedNonStandard,
        source: "onboarding",
        actorName: "portfolio-landing",
      },
      ctx,
    );
    if (!registered.ok) {
      return { ok: false, status: registered.status, message: registered.message };
    }
    if (registered.routedForReview) {
      return {
        ok: false,
        status: 409,
        cta: "book_call",
        message: registered.message || "A unit in this portfolio needs review — book a call instead.",
      };
    }
  }

  const started = await startPmOnboardingSession(supabase, {
    pmAccountId: account.id,
    actorName: "portfolio-landing",
    recipientName: contact.contactName,
    recipientEmail: contact.email,
    recipientPhone: contact.phone,
    send: true,
  });
  if (!started.ok || !started.token) {
    return {
      ok: false,
      status: started.status || 400,
      message: started.message || "Could not open onboarding.",
    };
  }

  return {
    ok: true,
    status: 200,
    cta: "get_started",
    onboardingUrl: landingOnboardingUrl(req, started.token),
    sessionId: started.sessionId,
    unitCount: started.unitCount,
    estimate,
  };
}

export async function bookCallPortfolio(
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
  const estimate = await estimateLandingPortfolio(supabase, input);
  const notes = clip(body.notes, 2000);
  const timing = clip(body.timing, 80);
  const summaryUnits = estimate.units
    .slice(0, 8)
    .map((u, i) => {
      const size = [u.bedrooms ? `${u.bedrooms} bd` : null, u.sqft ? `${u.sqft} sqft` : null]
        .filter(Boolean)
        .join(" · ");
      return `${u.label || `Unit ${i + 1}`}${size ? ` (${size})` : ""}`;
    })
    .join("; ");

  const account = await upsertPmAccount(supabase, {
    ...contact,
    notes: [
      "Book-a-call from try.novaracleaning.com/portfolio.",
      `${estimate.unitCount} units.`,
      estimate.reasons.map((r) => r.message).join(" "),
      notes,
    ]
      .filter(Boolean)
      .join(" "),
  });
  if (account.ok === false) return { ok: false, status: account.status, message: account.message };

  const [firstName, ...rest] = contact.contactName.split(/\s+/);
  const { data: existingLead } = await supabase
    .from("leads")
    .select("id")
    .ilike("email", contact.email)
    .eq("source", "portfolio_landing")
    .not("status", "in", "(won,lost,closed)")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const leadPatch = {
    first_name: firstName,
    last_name: rest.join(" ") || "",
    email: contact.email,
    phone: contact.phone,
    source: "portfolio_landing",
    channel: "try.novaracleaning.com/portfolio",
    status: "new",
    lead_score: estimate.unitCount >= 20 ? "hot" : "warm",
    service_type: "property_manager",
    property_type: "property_manager",
    sqft: estimate.units[0]?.sqft ?? null,
    urgency: timing || null,
    notes: [
      `Company: ${contact.companyName}`,
      `Units: ${estimate.unitCount}`,
      summaryUnits ? `Preview: ${summaryUnits}` : null,
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

  const settings = await loadPmSettings(supabase);
  const calendarUrl = discoveryCalendarUrl(settings.raw);

  await notifyPmAdmin(supabase, {
    subject: `PM discovery call — ${contact.companyName}`,
    html: [
      `<p><strong>${escapeHtml(contact.contactName)}</strong> (${escapeHtml(contact.companyName)}) asked to book a call from the portfolio landing page.</p>`,
      `<p>${escapeHtml(contact.email)} · ${escapeHtml(contact.phone)}</p>`,
      `<p>${estimate.unitCount} unit${estimate.unitCount === 1 ? "" : "s"}. ${escapeHtml(
        estimate.reasons.map((r) => r.message).join(" ") || "Unusual or large portfolio.",
      )}</p>`,
      summaryUnits ? `<p>${escapeHtml(summaryUnits)}</p>` : "",
      notes ? `<p>${escapeHtml(notes)}</p>` : "",
      `<p>Review in Admin → Commercial → Portfolio. Do not auto-send onboarding until the units are priced.</p>`,
    ].join(""),
    eventType: "property_manager.landing.call_requested",
    summary: `${contact.contactName} booked a PM discovery call (${estimate.unitCount} units).`,
    data: {
      pm_account_id: account.id,
      lead_id: leadId,
      unit_count: estimate.unitCount,
      reasons: estimate.reasons,
    },
  });

  return {
    ok: true,
    status: 200,
    calendarUrl,
    leadId,
    message: calendarUrl
      ? "Pick a time below — we'll review the portfolio before onboarding."
      : "Request received. We'll reach out to schedule a call, usually within one business day.",
  };
}

function escapeHtml(value: string): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
