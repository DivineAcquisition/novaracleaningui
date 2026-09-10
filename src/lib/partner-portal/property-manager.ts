// ─── Property Manager portal view ──────────────────────────────────────────
//
// The third view on the type-aware Partner Portal. Same shell, same
// passwordless identity, same least-visibility rules as Host and Commercial —
// the difference is what the landing view is about.
//
// A host lands on a calendar of turnovers. A property manager lands on their
// portfolio: every registered unit, its standing rates, and what has happened
// on it. Turnovers are events under a unit, not the top-level object, because
// the unit is what the manager actually manages.
//
// Everything here is read-only on rates, and the crew sanitizer runs over the
// whole payload on the way out.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendPartnershipMessage } from "@/lib/partnership-comms/server";
import { listPmInvoices } from "@/lib/property-manager/billing";
import {
  PM_SERVICE_LABELS,
  PM_SERVICE_SUMMARIES,
  PM_SERVICE_TYPES,
  formatRate,
  resolveVolumeDiscount,
  unitDisplayName,
  type PmServiceType,
} from "@/lib/property-manager/pricing";
import { loadVolumeDiscounts } from "@/lib/property-manager/pricing-server";
import {
  UNIT_COLS,
  countRegisteredUnits,
  publicUnit,
  registerUnit,
  updateUnitAccess,
} from "@/lib/property-manager/registry";
import {
  TURNOVER_COLS,
  bookTurnover,
  cancelTurnover,
  isPmServiceType,
  publicTurnover,
} from "@/lib/property-manager/turnovers";
import { describeCustomerPaymentMethod, netTermsLabel } from "./stripe-billing";
import type { PartnerIdentity } from "./identity";
import { stripCrewContact } from "./sanitize";

// eslint-disable-next-line
type Admin = any;
type Row = Record<string, unknown>;

export const PM_AGREEMENT_BUCKET = "pm-agreements";

function pmIds(identity: PartnerIdentity): string[] {
  return identity.propertyManagers.map((p) => p.id);
}

function ownsPm(identity: PartnerIdentity, pmAccountId: string): boolean {
  return pmIds(identity).includes(pmAccountId);
}

async function signedUrl(supabase: Admin, bucket: string, path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabase.storage.from(bucket).createSignedUrl(path, 3600);
  return data?.signedUrl || null;
}

// ─── Overview ──────────────────────────────────────────────────────────────

/**
 * The portfolio-level default view, optionally drilled into one unit.
 *
 * `unitId` narrows the turnover history and photo documentation to that unit
 * without hiding the rest of the registry — drilling in should feel like
 * focusing, not navigating away.
 */
export async function propertyManagerOverview(identity: PartnerIdentity, unitId?: string | null) {
  const ids = pmIds(identity);
  if (!ids.length) {
    return { ok: false as const, error: "No property management relationship on this account." };
  }
  const supabase = getAdminSupabase();
  const pmAccountId = ids[0];

  const [{ data: account }, { data: units }, { data: turnovers }, { data: agreements }] =
    await Promise.all([
      supabase
        .from("property_manager_accounts")
        .select(
          "id, company_name, contact_name, status, billing_method, invoice_cycle, net_terms, stripe_customer_id, default_payment_method_id, volume_discount_percent, volume_discount_label",
        )
        .eq("id", pmAccountId)
        .maybeSingle(),
      supabase
        .from("property_manager_units")
        .select(UNIT_COLS)
        .eq("pm_account_id", pmAccountId)
        .neq("status", "inactive")
        .order("created_at", { ascending: true }),
      supabase
        .from("property_manager_turnovers")
        .select(TURNOVER_COLS)
        .eq("pm_account_id", pmAccountId)
        .order("needed_by_date", { ascending: false })
        .limit(200),
      supabase
        .from("property_manager_agreements")
        .select("id, signed_at, signer_name, document_path")
        .eq("pm_account_id", pmAccountId)
        .order("signed_at", { ascending: false })
        .limit(3),
    ]);

  const unitRows = (units || []) as Row[];
  const turnoverRows = (turnovers || []) as Row[];
  const unitById = new Map(unitRows.map((u) => [String(u.id), u]));

  // Photo documentation lives on the booking, exactly as it does for every
  // other job. The turnover just points at it.
  const bookingIds = turnoverRows.map((t) => t.booking_id).filter(Boolean) as string[];
  const photosByBooking = new Map<string, { before: unknown[]; after: unknown[] }>();
  if (bookingIds.length) {
    const { data: bookings } = await supabase
      .from("bookings")
      .select("id, before_photos, after_photos")
      .in("id", bookingIds.slice(0, 200));
    for (const b of (bookings || []) as Row[]) {
      photosByBooking.set(String(b.id), {
        before: (b.before_photos as unknown[]) || [],
        after: (b.after_photos as unknown[]) || [],
      });
    }
  }

  const activeCount = unitRows.filter((u) => String(u.status) === "active").length;
  const discountConfig = await loadVolumeDiscounts(supabase);
  const discount = resolveVolumeDiscount(discountConfig, activeCount);

  const publicUnits = unitRows.map((u) => {
    const forUnit = turnoverRows.filter((t) => String(t.unit_id) === String(u.id));
    const upcoming = forUnit.filter((t) =>
      ["scheduled", "assigned", "confirmed", "in_progress"].includes(String(t.status)),
    );
    const completed = forUnit.filter((t) => String(t.status) === "completed");
    return {
      ...publicUnit(u),
      turnoverCount: forUnit.length,
      upcomingCount: upcoming.length,
      lastServicedOn:
        completed
          .map((t) => String(t.completed_at || t.scheduled_date || t.needed_by_date).slice(0, 10))
          .sort()
          .pop() || null,
      nextNeededBy:
        upcoming
          .map((t) => String(t.needed_by_date))
          .sort()
          .shift() || null,
    };
  });

  const selectedUnitId = unitId && unitById.has(unitId) ? unitId : null;
  const visibleTurnovers = (selectedUnitId
    ? turnoverRows.filter((t) => String(t.unit_id) === selectedUnitId)
    : turnoverRows
  ).map((t) => {
    const photos = t.booking_id ? photosByBooking.get(String(t.booking_id)) : null;
    return {
      ...publicTurnover(t, unitById.get(String(t.unit_id)) || null),
      beforePhotos: photos?.before || [],
      afterPhotos: photos?.after || [],
    };
  });

  const acct = (account || {}) as Row;
  const billingMethod = String(acct.billing_method || "invoiced") as "invoiced" | "auto_pay";
  const payment =
    billingMethod === "auto_pay"
      ? await describeCustomerPaymentMethod(
          acct.stripe_customer_id as string,
          acct.default_payment_method_id as string,
        )
      : { onFile: false, id: null, brand: null, last4: null, type: null };

  const invoices = await listPmInvoices(supabase, pmAccountId);

  const documents: Array<{ label: string; url: string | null; date: string; kind: string }> = [];
  for (const a of (agreements || []) as Row[]) {
    documents.push({
      label: `Property Management Services Agreement — signed ${String(a.signed_at).slice(0, 10)}`,
      url: await signedUrl(supabase, PM_AGREEMENT_BUCKET, (a.document_path as string) || null),
      date: String(a.signed_at),
      kind: "agreement",
    });
  }
  documents.push({
    label: "Unit Registry & Standing Rates (current, Company-set)",
    url: "/api/partner-portal/property-manager?download=unit_registry",
    date: new Date().toISOString(),
    kind: "unit_registry",
  });

  return stripCrewContact({
    ok: true as const,
    account: {
      id: pmAccountId,
      companyName: (acct.company_name as string) || identity.propertyManagers[0]?.companyName,
      contactName: (acct.contact_name as string) || identity.displayName,
      status: (acct.status as string) || "active",
      unitCount: activeCount,
      pendingReviewCount: unitRows.filter((u) => String(u.status) === "pending_review").length,
      upcomingTurnovers: turnoverRows.filter((t) =>
        ["scheduled", "assigned", "confirmed", "in_progress"].includes(String(t.status)),
      ).length,
      agreementSigned: !!(agreements || []).length,
    },
    discount: {
      percent: discount.percent,
      label: discount.label,
      unitsToNextTier: discount.unitsToNextTier,
      nextPercent: discount.nextPercent,
      // The manager is told the discount is already in the rate they see, so
      // nobody goes hunting for it at checkout.
      note:
        discount.percent > 0
          ? `Your ${discount.percent}% portfolio discount is already reflected in every standing rate below.`
          : null,
    },
    billing: {
      method: billingMethod,
      invoiceCycle: (acct.invoice_cycle as string) || "monthly",
      netTerms: (acct.net_terms as string) || null,
      netTermsLabel: netTermsLabel(acct.net_terms as string),
      cardOnFile: payment.onFile,
      paymentBrand: payment.brand,
      paymentLast4: payment.last4,
      canUpdatePayment: billingMethod === "auto_pay",
      invoices,
    },
    services: PM_SERVICE_TYPES.map((service) => ({
      key: service,
      label: PM_SERVICE_LABELS[service],
      summary: PM_SERVICE_SUMMARIES[service],
    })),
    units: publicUnits,
    selectedUnitId,
    turnovers: visibleTurnovers,
    documents,
    rateEditable: false as const,
  });
}

// ─── Booking ───────────────────────────────────────────────────────────────

/**
 * Book a turnover from the portal. No quote, no walkthrough: pick the unit,
 * the service, and the date it has to be ready by.
 */
export async function bookPortalTurnover(
  identity: PartnerIdentity,
  input: { unitId: string; serviceType: string; neededByDate: string; neededByTime?: string; notes?: string },
) {
  const pmAccountId = pmIds(identity)[0];
  if (!pmAccountId) {
    return { ok: false as const, error: "No property management relationship on this account." };
  }
  if (!isPmServiceType(input.serviceType)) {
    return { ok: false as const, error: "Pick Move-Out, Move-In, or Standard." };
  }

  const supabase = getAdminSupabase();
  const { data: unit } = await supabase
    .from("property_manager_units")
    .select("id, pm_account_id")
    .eq("id", input.unitId)
    .maybeSingle();
  if (!unit || !ownsPm(identity, String((unit as Row).pm_account_id))) {
    return { ok: false as const, error: "That unit isn't in your portfolio." };
  }

  const result = await bookTurnover(supabase, {
    pmAccountId,
    unitId: input.unitId,
    serviceType: input.serviceType as PmServiceType,
    neededByDate: input.neededByDate,
    neededByTime: input.neededByTime || null,
    notes: input.notes || null,
    bookedByName: identity.displayName || identity.email,
    bookedVia: "portal",
  });
  if (!result.ok) return { ok: false as const, error: result.message };
  return {
    ok: true as const,
    message: result.message,
    turnoverId: result.turnoverId,
    priceCents: result.priceCents,
  };
}

export async function cancelPortalTurnover(
  identity: PartnerIdentity,
  input: { turnoverId: string; reason?: string },
) {
  const pmAccountId = pmIds(identity)[0];
  if (!pmAccountId) {
    return { ok: false as const, error: "No property management relationship on this account." };
  }
  const supabase = getAdminSupabase();
  const result = await cancelTurnover(supabase, {
    pmAccountId,
    turnoverId: input.turnoverId,
    reason: input.reason || null,
    actorName: identity.displayName || identity.email,
  });
  return result.ok
    ? { ok: true as const, message: result.message }
    : { ok: false as const, error: result.message };
}

// ─── Adding a unit ─────────────────────────────────────────────────────────

/**
 * Add a unit from the portal.
 *
 * A typical unit prices itself immediately and is bookable when this returns.
 * Only the genuinely unusual ones route to a person, and the manager is told
 * which happened rather than being left to guess.
 */
export async function addPortalUnit(
  identity: PartnerIdentity,
  input: {
    unitLabel?: string;
    address: string;
    city?: string;
    state?: string;
    zipCode?: string;
    sqft?: number;
    bedrooms?: number;
    bathrooms?: number;
    accessMethod?: string;
    accessCode?: string;
    accessNotes?: string;
    parkingNotes?: string;
    notes?: string;
    flagNonStandard?: boolean;
  },
) {
  const pmAccountId = pmIds(identity)[0];
  if (!pmAccountId) {
    return { ok: false as const, error: "No property management relationship on this account." };
  }
  const supabase = getAdminSupabase();

  const result = await registerUnit(supabase, {
    pmAccountId,
    unitLabel: input.unitLabel,
    address: input.address,
    city: input.city,
    state: input.state,
    zipCode: input.zipCode,
    sqft: input.sqft,
    bedrooms: input.bedrooms,
    bathrooms: input.bathrooms,
    accessMethod: input.accessMethod,
    accessCode: input.accessCode,
    accessNotes: input.accessNotes,
    parkingNotes: input.parkingNotes,
    notes: input.notes,
    flaggedNonStandard: !!input.flagNonStandard,
    source: "portal",
    actorName: identity.displayName || identity.email,
  });
  if (!result.ok) return { ok: false as const, error: result.message };

  if (result.routedForReview) {
    await supabase.from("partner_portal_requests").insert({
      identity_id: identity.id,
      relationship: "property_manager",
      kind: "additional_unit",
      pm_account_id: pmAccountId,
      pm_unit_id: result.unitId || null,
      payload: {
        address: input.address,
        unit_label: input.unitLabel || null,
        sqft: input.sqft ?? null,
        bedrooms: input.bedrooms ?? null,
        review_reason: result.reviewReason || null,
        priced: false,
      },
      status: "pending",
    });
  }

  const unitCount = await countRegisteredUnits(supabase, pmAccountId);
  const discount = resolveVolumeDiscount(await loadVolumeDiscounts(supabase), unitCount);

  return {
    ok: true as const,
    message: result.message,
    unitId: result.unitId,
    unit: result.unit,
    autoPriced: !!result.autoPriced,
    routedForReview: !!result.routedForReview,
    // Adding a unit can move the whole portfolio into a better tier; say so
    // rather than letting the manager notice their rates changed.
    discountPercent: discount.percent,
    discountLabel: discount.label,
  };
}

export async function updatePortalUnitAccess(
  identity: PartnerIdentity,
  input: {
    unitId: string;
    accessMethod?: string;
    accessCode?: string;
    accessNotes?: string;
    parkingNotes?: string;
  },
) {
  const pmAccountId = pmIds(identity)[0];
  if (!pmAccountId) {
    return { ok: false as const, error: "No property management relationship on this account." };
  }
  const supabase = getAdminSupabase();
  const { data: unit } = await supabase
    .from("property_manager_units")
    .select("id, pm_account_id")
    .eq("id", input.unitId)
    .maybeSingle();
  if (!unit || !ownsPm(identity, String((unit as Row).pm_account_id))) {
    return { ok: false as const, error: "That unit isn't in your portfolio." };
  }
  const result = await updateUnitAccess(supabase, {
    unitId: input.unitId,
    accessMethod: input.accessMethod,
    accessCode: input.accessCode,
    accessNotes: input.accessNotes,
    parkingNotes: input.parkingNotes,
    actorName: identity.displayName || identity.email,
  });
  return result.ok
    ? { ok: true as const, message: result.message }
    : { ok: false as const, error: result.message };
}

// ─── Reporting an issue ────────────────────────────────────────────────────

/**
 * Feed the existing QC queue, tagged to the specific unit.
 *
 * Tagging by unit is the point: "the Adams Street 2B turnover was short" has
 * to be answerable against that apartment's history, not just against one
 * job id the manager may not have to hand.
 */
export async function reportPropertyManagerIssue(
  identity: PartnerIdentity,
  input: { title: string; description: string; unitId?: string; turnoverId?: string },
) {
  const pmAccountId = pmIds(identity)[0];
  if (!pmAccountId) {
    return { ok: false as const, error: "No property management relationship on this account." };
  }
  const title = String(input.title || "").trim().slice(0, 200);
  const description = String(input.description || "").trim().slice(0, 4000);
  if (!title) return { ok: false as const, error: "Add a short title for the issue." };

  const supabase = getAdminSupabase();

  let unitId: string | null = null;
  let turnoverId: string | null = null;
  let bookingId: string | null = null;

  if (input.turnoverId) {
    const { data: t } = await supabase
      .from("property_manager_turnovers")
      .select("id, unit_id, pm_account_id, booking_id")
      .eq("id", input.turnoverId)
      .maybeSingle();
    if (t && ownsPm(identity, String((t as Row).pm_account_id))) {
      turnoverId = String((t as Row).id);
      unitId = String((t as Row).unit_id);
      bookingId = ((t as Row).booking_id as string) || null;
    }
  }
  if (!unitId && input.unitId) {
    const { data: u } = await supabase
      .from("property_manager_units")
      .select("id, pm_account_id")
      .eq("id", input.unitId)
      .maybeSingle();
    if (u && ownsPm(identity, String((u as Row).pm_account_id))) unitId = String((u as Row).id);
  }

  const { data: issue, error } = await supabase
    .from("qc_issues")
    .insert({
      booking_id: bookingId,
      pm_account_id: pmAccountId,
      pm_unit_id: unitId,
      pm_turnover_id: turnoverId,
      partner_identity_id: identity.id,
      issue_type: "complaint",
      severity: "medium",
      status: "open",
      title,
      description,
      reported_via: "partner_portal",
      reported_by_name: identity.displayName || identity.email,
      client_name: identity.propertyManagers[0]?.companyName || identity.email,
      client_email: identity.email,
      client_type: "residential",
    })
    .select("id, issue_number")
    .single();
  if (error) return { ok: false as const, error: error.message };

  await supabase.from("events").insert({
    event_type: "partner.property_manager.issue_reported",
    source: "partner-portal",
    summary: `Property manager reported an issue: ${title}`,
    data: {
      pm_account_id: pmAccountId,
      pm_unit_id: unitId,
      pm_turnover_id: turnoverId,
      qc_issue_id: (issue as Row).id,
    },
  });

  return {
    ok: true as const,
    issueId: String((issue as Row).id),
    issueNumber: (issue as Row).issue_number,
    message: "Reported. Our QC team picks this up against that unit's history.",
  };
}

// ─── Unit registry document ────────────────────────────────────────────────

/**
 * Plain-text registry the manager can download. Deliberately the same numbers
 * they see on screen and the same numbers attached to the agreement — there
 * is only ever one rate for a unit.
 */
export async function unitRegistryText(identity: PartnerIdentity): Promise<string | null> {
  const pmAccountId = pmIds(identity)[0];
  if (!pmAccountId) return null;
  const supabase = getAdminSupabase();
  const [{ data: account }, { data: units }] = await Promise.all([
    supabase
      .from("property_manager_accounts")
      .select("company_name, volume_discount_percent, volume_discount_label")
      .eq("id", pmAccountId)
      .maybeSingle(),
    supabase
      .from("property_manager_units")
      .select(UNIT_COLS)
      .eq("pm_account_id", pmAccountId)
      .neq("status", "inactive")
      .order("created_at", { ascending: true }),
  ]);

  const acct = (account || {}) as Row;
  const lines: string[] = [
    "UNIT REGISTRY & STANDING RATES",
    String(acct.company_name || ""),
    `Generated ${new Date().toISOString().slice(0, 10)}`,
    "",
    "Rates are set by Novara Cleaning and hold for every turnover on the unit",
    "until we change them. They are not editable from the portal.",
    "",
  ];
  if (Number(acct.volume_discount_percent || 0) > 0) {
    lines.push(
      `Portfolio volume discount applied: ${Number(acct.volume_discount_percent)}%` +
        (acct.volume_discount_label ? ` (${String(acct.volume_discount_label)})` : ""),
      "",
    );
  }

  for (const raw of (units || []) as Row[]) {
    const u = raw;
    lines.push(`— ${unitDisplayName(u as { unit_label?: string | null; address?: string | null })}`);
    lines.push(
      `  ${[u.address, u.city, u.state, u.zip_code].filter(Boolean).join(", ")}`,
    );
    const size = [
      u.sqft ? `${Number(u.sqft)} sqft` : null,
      u.bedrooms == null ? null : `${Number(u.bedrooms)} bed`,
      u.bathrooms == null ? null : `${Number(u.bathrooms)} bath`,
      u.zone_code ? `zone ${String(u.zone_code)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (size) lines.push(`  ${size}`);
    if (String(u.status) === "pending_review") {
      lines.push("  Rates pending — with our team for pricing.");
    } else {
      for (const service of PM_SERVICE_TYPES) {
        const cents = Number(u[`standing_${service}_cents`]);
        lines.push(
          `  ${PM_SERVICE_LABELS[service]}: ${Number.isFinite(cents) && cents > 0 ? formatRate(cents) : "—"}`,
        );
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ─── Admin notification ────────────────────────────────────────────────────

export async function notifyPortalPmAdmin(input: {
  subject: string;
  html: string;
  trigger: string;
}): Promise<void> {
  const supabase = getAdminSupabase();
  const { data: setting } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "property_manager_settings")
    .maybeSingle();
  const notify =
    (setting?.value as { notify_email?: string } | null)?.notify_email ||
    process.env.PROPERTY_MANAGER_NOTIFY_EMAIL ||
    process.env.HOST_ONBOARDING_NOTIFY_EMAIL ||
    null;
  if (!notify) return;
  await sendPartnershipMessage(supabase, {
    templateKey: "admin_internal_notice",
    trigger: input.trigger,
    role: "admin",
    email: notify,
    subject: input.subject,
    html: input.html,
    vars: { subject_line: input.subject, body_html: input.html },
  }).catch(() => null);
}
