// book-partner-job
//
// The single internal booking engine for Commercial / Office / STR-Airbnb —
// the partner analogue of book-as-va. The booking it creates is the single
// source of truth for the job: everything the contractor portal shows is
// composed from it, never re-entered.
//
// Hard gates (spec): a booking is NOT accepted without
//   • a clear access method  (how the crew gets in)
//   • a defined scope        (service type + scope notes/checklist)
//   • a deadline             (STR next check-in / commercial finish time
//                             — or an explicit arrival window)
//
// Commercial and office add three more, because the failure modes are
// different at this size:
//   • a SITE under the account — a commercial job is never a loose address
//   • a current COI and a signed agreement on the ACCOUNT — the same
//     "nothing goes live without agreement + payment" rule, and an account
//     level gap blocks every site under it
//   • at or above the walkthrough threshold, a completed walkthrough with a
//     firm price — a 30,000 sqft facility has too many variables to price
//     sight-unseen, and being wrong at that size is expensive both ways
//
// What it does:
//   1. Validates gates + resolves the account/site (commercial/office) or
//      host/property (STR) linkage.
//   2. Creates the bookings row: pay locked at booking (price × tier %),
//      access/scope/deadline composed into the portal-facing fields
//      (access_notes / dispatch_notes / team_notes) AND stored structured in
//      partner_details. Client personal contact details are NOT copied onto
//      the booking — contractors see logistics, not phone numbers.
//   3. Payment status: 'paid' | 'invoice' | 'card_on_file' | 'unpaid'
//      → payment_option/payment_received_at so the existing no-unpaid-dispatch
//      gate keeps holding.
//   4. Crew: assigns preferred cleaners via admin-booking-assign (their portal
//      reflects the job immediately), else routes to dispatch approval.
//   5. Optionally saves a partner_recurring_schedules row for the cadence.
//
// Auth: admin/VA JWT, or service-role (recurring generator).

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  computeCommercialQuote,
  photoZonesForSite,
  windowHoursBetween,
  type CommercialQuote,
} from "../_shared/commercial-pricing.ts";
import {
  accountCompliance,
  latestCompletedWalkthrough,
  loadCommercialConfig,
  walkthroughById,
  type WalkthroughRecord,
} from "../_shared/commercial-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}
const log = (m: string, d?: unknown) =>
  console.log(`[book-partner-job] ${m}${d === undefined ? "" : " " + JSON.stringify(d)}`);

// deno-lint-ignore no-explicit-any
type SB = any;

interface BookBody {
  bookingType?: "commercial" | "office" | "str_turnover";
  // Linkage
  businessAccountId?: string;
  businessSiteId?: string;
  hostId?: string;
  propertyId?: string;
  // When
  serviceDate?: string;        // YYYY-MM-DD (required)
  arrivalWindow?: string;      // e.g. "After 6 PM" / "10:00 AM - 12:00 PM" (required)
  hardDeadline?: string;       // STR: next check-in · commercial: must-finish-by (required)
  strCheckoutTime?: string;
  // Access (gated)
  accessMethod?: string;       // lockbox / smart lock / key / on-site contact / badge…
  accessCode?: string;
  accessNotes?: string;        // parking, entry, unit…
  // Scope (gated)
  serviceType?: string;        // turnover | commercial | office | deep …
  scopeNotes?: string;
  addOns?: string[];
  // STR specifics
  linenNotes?: string;
  restockNotes?: string;
  stagingNotes?: string;
  // Commercial/office specifics
  securityNotes?: string;      // alarm codes, lock-up, notify on arrival
  coiRequired?: boolean;
  officeNotes?: string;        // desk policy, electronics, floors/suites, trash
  // Commercial pricing inputs (facility type × scope level × size tier)
  facilityTypeKey?: string;    // office | warehouse | retail | restaurant | …
  scopeLevel?: string;         // light | standard | detailed
  squareFootage?: number;      // overrides the site's sqft on file
  serviceWindowStart?: string; // "22:00" — sizes the crew, not the price
  serviceWindowEnd?: string;   // "02:00"
  windowHours?: number;        // explicit alternative to start/end
  walkthroughId?: string;      // required at/above the walkthrough threshold
  numCleanersOverride?: number; // admin override of the recommended crew size
  // Special instructions (all types)
  specialInstructions?: string;
  // Pay (locked)
  priceCents?: number;
  cleanerPayPct?: number;      // default 35
  numCleaners?: number;
  // Payment status
  paymentStatus?: "paid" | "card_on_file" | "invoice" | "unpaid";
  // Crew
  cleanerIds?: string[];
  // Recurring — commercial work is overwhelmingly contract work, and daily
  // service is routine at this scale in a way it never is residentially.
  recurring?: {
    cadence: "daily" | "weekly" | "biweekly" | "monthly";
    daysOfWeek?: number[];
    dayOfMonth?: number;
  };
  // internal (generator)
  scheduleId?: string;
}

async function ensureAdminOrVaOrService(admin: SB, req: Request): Promise<string> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Not signed in.");
  // Service-role key (recurring generator) is allowed straight through.
  if (jwt === (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "")) return "service";
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const ok = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!ok) throw new Error("Admins or VAs only.");
  return u.user.id;
}

const s = (v: unknown, max = 500) => String(v ?? "").trim().slice(0, max);

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const callerId = await ensureAdminOrVaOrService(admin, req);
    const body = (await req.json().catch(() => ({}))) as BookBody;

    const bookingType = body.bookingType;
    if (!bookingType || !["commercial", "office", "str_turnover"].includes(bookingType)) {
      return json({ ok: false, error: "bookingType must be commercial | office | str_turnover" }, 400);
    }
    const isStr = bookingType === "str_turnover";

    // ─── The three completeness gates ────────────────────────────────────
    const accessMethod = s(body.accessMethod, 100);
    const serviceDate = s(body.serviceDate, 10);
    const arrivalWindow = s(body.arrivalWindow, 60);
    const hardDeadline = s(body.hardDeadline, 120);
    const scopeNotes = s(body.scopeNotes, 3000);
    // service_type drives the type-appropriate QC checklist in the hub:
    // turnover / commercial / office specs in _shared/contractor-checklists.
    const defaultServiceType = isStr ? "turnover" : bookingType;
    const requested = s(body.serviceType, 40);
    const serviceType = requested && requested !== "commercial" ? requested : defaultServiceType;

    if (!serviceDate || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
      return json({ ok: false, error: "A service date is required." }, 400);
    }
    if (!accessMethod) {
      return json({ ok: false, error: "Access method is required — a booking without a clear way in is not complete." }, 400);
    }
    if (!scopeNotes && !(body.addOns || []).length) {
      return json({ ok: false, error: "Scope is required — the cleaner must know exactly what's included." }, 400);
    }
    if (!hardDeadline && !arrivalWindow) {
      return json({ ok: false, error: isStr ? "The next check-in deadline is required for a turnover." : "A service window or hard finish time is required." }, 400);
    }

    // ─── Resolve linkage ─────────────────────────────────────────────────
    let clientLabel = "";
    let email: string | null = null;
    let address = "", city = "", state = "", zip = "";
    let sqft: number | null = null;
    let account: Record<string, unknown> | null = null;
    let site: Record<string, unknown> | null = null;
    let property: Record<string, unknown> | null = null;

    if (isStr) {
      if (!body.propertyId) return json({ ok: false, error: "propertyId required for a turnover." }, 400);
      const { data: prop } = await admin.from("properties").select("*").eq("id", body.propertyId).maybeSingle();
      if (!prop) return json({ ok: false, error: "Property not found." }, 404);
      property = prop;
      const { data: host } = await admin.from("hosts").select("id, name, email, status").eq("id", prop.host_id).maybeSingle();
      if (!host) return json({ ok: false, error: "Host not found for property." }, 404);
      if (String(host.status) === "blocked") return json({ ok: false, error: "This host is blocked." }, 400);
      clientLabel = `${prop.nickname || "STR"} (${host.name || "Host"})`;
      email = host.email || null;
      address = String(prop.address || "");
      sqft = prop.sqft != null ? Number(prop.sqft) : null;
    } else {
      if (!body.businessAccountId) return json({ ok: false, error: "businessAccountId required." }, 400);
      const { data: acct } = await admin.from("business_accounts").select("*").eq("id", body.businessAccountId).maybeSingle();
      if (!acct) return json({ ok: false, error: "Business account not found." }, 404);
      account = acct;
      clientLabel = String(acct.business_name || "Business");
      email = acct.email || null;
      address = String(acct.address || "");
      city = String(acct.city || "");
      state = String(acct.state || "");
      zip = String(acct.zip_code || "");
      // A commercial booking belongs to a SITE, never a loose address: the
      // site is what carries the square footage, the access and security
      // procedure, and the service window that a second booking must not have
      // to re-enter. When an account has exactly one active site the choice is
      // not a choice, so resolve it rather than making the caller state it —
      // that is also what keeps existing recurring schedules generating.
      let siteId = s(body.businessSiteId, 40);
      if (!siteId) {
        const { data: activeSites } = await admin.from("business_sites")
          .select("id").eq("business_account_id", acct.id).eq("active", true).limit(2);
        if ((activeSites || []).length === 1) siteId = String(activeSites[0].id);
      }
      if (siteId) {
        const { data: siteRow } = await admin.from("business_sites").select("*").eq("id", siteId).maybeSingle();
        if (!siteRow) return json({ ok: false, error: "That site no longer exists on this account." }, 404);
        if (String(siteRow.business_account_id) !== String(acct.id)) {
          return json({ ok: false, error: "That site belongs to a different account." }, 400);
        }
        site = siteRow;
        clientLabel = `${acct.business_name} — ${siteRow.nickname}`;
        address = String(siteRow.address || address);
        city = String(siteRow.city || city);
        state = String(siteRow.state || state);
        zip = String(siteRow.zip_code || zip);
        sqft = siteRow.sqft != null ? Number(siteRow.sqft) : null;
      } else {
        return json({
          ok: false,
          error: `${acct.business_name} has no active site. A commercial job belongs to a site under the account — add one first so its address, access, and square footage live in one place.`,
          code: "site_required",
        }, 400);
      }
    }
    if (!address) return json({ ok: false, error: "The location has no address on file — add it first." }, 400);

    // ─── Commercial gates: compliance, pricing, walkthrough ──────────────
    let quote: CommercialQuote | null = null;
    let walkthrough: WalkthroughRecord | null = null;
    let priceSource: "formula" | "walkthrough" | "manual" | null = null;
    let photoZones: string[] = [];
    let complianceWarnings: string[] = [];
    let scopeLevel = "";
    let facilityTypeKey = "";
    let windowHours: number | null = null;

    if (!isStr && account) {
      // Nothing goes live without a signed agreement and a current COI. The
      // gap is on the ACCOUNT, so it blocks every site under it — a second
      // location does not get to be an exception to the first one's paperwork.
      const compliance = await accountCompliance(admin, String(account.id));
      if (!compliance.ok) {
        return json({
          ok: false,
          error: `${account.business_name} can't be booked yet — ${compliance.blockers.join(" ")}`,
          code: "account_compliance_blocked",
          blockers: compliance.blockers,
        }, 409);
      }
      complianceWarnings = compliance.warnings;

      const config = await loadCommercialConfig(admin);

      facilityTypeKey = s(body.facilityTypeKey, 40) ||
        String(site?.facility_type_key || "") ||
        String(account.facility_type || "");
      scopeLevel = (s(body.scopeLevel, 20) || String(site?.scope_level || "") || "standard").toLowerCase();
      const effectiveSqft = Number(body.squareFootage) > 0
        ? Math.round(Number(body.squareFootage))
        : Number(sqft) > 0 ? Number(sqft) : 0;
      if (effectiveSqft > 0) sqft = effectiveSqft;

      windowHours = Number(body.windowHours) > 0
        ? Number(body.windowHours)
        : windowHoursBetween(
          body.serviceWindowStart || (site?.service_window_start as string),
          body.serviceWindowEnd || (site?.service_window_end as string),
        );

      quote = computeCommercialQuote(config, {
        sqft: effectiveSqft,
        facilityTypeKey,
        scopeLevel,
        windowHours,
      });
      photoZones = photoZonesForSite(config, effectiveSqft, site?.photo_zones);

      // At or above the threshold the formula is an anchor, not a price. The
      // firm number has to come from what someone actually saw on site.
      if (quote.requiresWalkthrough) {
        walkthrough = s(body.walkthroughId, 40)
          ? await walkthroughById(admin, s(body.walkthroughId, 40))
          : await latestCompletedWalkthrough(admin, String(site?.id || ""));

        if (!walkthrough || walkthrough.status !== "completed" || !walkthrough.firm_price_cents) {
          const anchor = quote.ok
            ? ` Formula anchor: $${(quote.formulaCents / 100).toFixed(2)} (estimate $${(quote.estimateLowCents / 100).toFixed(2)}–$${(quote.estimateHighCents / 100).toFixed(2)}).`
            : "";
          return json({
            ok: false,
            error:
              `${effectiveSqft.toLocaleString()} sq ft is at or above the ${quote.walkthroughThresholdSqft.toLocaleString()} sq ft walkthrough threshold. ` +
              `A facility this size can't be firm-quoted from a desk — complete a walkthrough and set the price from its findings first.${anchor}`,
            code: "walkthrough_required",
            estimate: {
              formulaCents: quote.formulaCents,
              lowCents: quote.estimateLowCents,
              highCents: quote.estimateHighCents,
              thresholdSqft: quote.walkthroughThresholdSqft,
            },
          }, 409);
        }
        if (site?.id && String(walkthrough.business_site_id) !== String(site.id)) {
          return json({ ok: false, error: "That walkthrough was conducted at a different site." }, 400);
        }
      }
    }

    // ─── Price ───────────────────────────────────────────────────────────
    // Where the number comes from is recorded, not just the number: a firm
    // price set from a walkthrough, an auto-quote from the formula, and a
    // negotiated override are three different things when the job is reviewed
    // later, and only one of them is reproducible from the config.
    const priceCents = Math.max(0, Math.round(Number(body.priceCents) || 0));
    const strDefault = property?.turnover_price != null ? Math.round(Number(property.turnover_price) * 100) : 0;

    let finalPriceCents = priceCents > 0 ? priceCents : strDefault;
    if (!isStr && account) {
      if (walkthrough?.firm_price_cents) {
        // The walkthrough IS the price at this size. An admin may still
        // override it, but that override is recorded as such.
        finalPriceCents = priceCents > 0 && priceCents !== walkthrough.firm_price_cents
          ? priceCents
          : Number(walkthrough.firm_price_cents);
        priceSource = finalPriceCents === Number(walkthrough.firm_price_cents) ? "walkthrough" : "manual";
      } else if (priceCents > 0) {
        priceSource = quote?.ok && priceCents === quote.formulaCents ? "formula" : "manual";
        finalPriceCents = priceCents;
      } else if (quote?.ok) {
        finalPriceCents = quote.formulaCents;
        priceSource = "formula";
      }
    }
    if (finalPriceCents <= 0) {
      return json({
        ok: false,
        error: isStr
          ? "A job price is required (property has no turnover rate set)."
          : "A job price is required — pick a facility type, scope level, and square footage to quote one, or enter it directly.",
      }, 400);
    }

    // ─── Crew: sized to the scope and the window ─────────────────────────
    // Residential crews are one or two people. A 30,000 sqft warehouse on a
    // four-hour overnight window is not that job, so the crew size follows
    // from the work rather than from a fixed default.
    const recommendedCrew = quote?.crew?.crewSize ?? null;
    const requestedCrew = Number(body.numCleanersOverride) > 0
      ? Math.round(Number(body.numCleanersOverride))
      : Number(body.numCleaners) > 0
      ? Math.round(Number(body.numCleaners))
      : null;
    const crewSize = Math.max(1, Math.min(12, requestedCrew ?? recommendedCrew ?? 1));

    // ─── Pay: locked at booking ──────────────────────────────────────────
    const payPct = Math.min(60, Math.max(20, Number(body.cleanerPayPct) || 35));
    const cleanerPayoutCents = Math.floor((finalPriceCents * payPct) / 100);
    const platformFeeCents = Math.max(0, finalPriceCents - cleanerPayoutCents);

    // ─── Payment status → dispatch gate fields ───────────────────────────
    const paymentStatus = ["paid", "card_on_file", "invoice", "unpaid"].includes(String(body.paymentStatus))
      ? String(body.paymentStatus)
      : "invoice";
    const nowIso = new Date().toISOString();

    // ─── Compose the portal-facing narrative fields ──────────────────────
    // (These are what get-cleaner-portal / job checklist / dispatch show —
    //  the single source of truth reflected without re-entry.)
    // Security and access detail captured once on the site flows onto every
    // booking against it — the crew gets the badge/alarm/dock procedure
    // without anyone retyping it per visit. The ACCESS: prefix is what keeps
    // codes time-scoped in the portal (48h before the visit, never earlier).
    const siteAccessParts = site
      ? [
        site.badge_required ? "Badge / keycard required — check in at the desk." : null,
        site.alarm_code ? `Alarm code: ${s(site.alarm_code, 60)}` : null,
        site.security_contact_name
          ? `On-site security contact: ${s(site.security_contact_name, 80)}${site.security_contact_phone ? ` — ${s(site.security_contact_phone, 40)}` : ""}`
          : null,
        site.after_hours_access_notes ? `After-hours: ${s(site.after_hours_access_notes, 400)}` : null,
        site.loading_dock_notes ? `Loading dock: ${s(site.loading_dock_notes, 400)}` : null,
      ].filter(Boolean)
      : [];
    const accessParts = [
      `ACCESS: ${accessMethod}${body.accessCode ? ` — code: ${s(body.accessCode, 60)}` : ""}`,
      s(body.accessNotes, 800) || null,
      ...siteAccessParts,
      site?.access_instructions ? s(String(site.access_instructions), 800) : null,
    ].filter(Boolean);
    const deadlineLine = hardDeadline
      ? (isStr ? `⏰ NEXT CHECK-IN (HARD DEADLINE): ${hardDeadline}` : `⏰ MUST FINISH BY: ${hardDeadline}`)
      : null;
    const teamParts = [
      deadlineLine,
      isStr && body.strCheckoutTime ? `Guest checkout: ${s(body.strCheckoutTime, 40)}` : null,
      scopeNotes ? `SCOPE: ${scopeNotes}` : null,
      isStr && body.linenNotes ? `LINEN/LAUNDRY: ${s(body.linenNotes, 500)}` : null,
      isStr && body.restockNotes ? `RESTOCK: ${s(body.restockNotes, 500)}` : null,
      isStr && body.stagingNotes ? `STAGING: ${s(body.stagingNotes, 500)}` : null,
      !isStr && body.securityNotes ? `SECURITY/LOCK-UP: ${s(body.securityNotes, 600)}` : null,
      bookingType === "office" && body.officeNotes ? `OFFICE RULES: ${s(body.officeNotes, 600)}` : null,
      s(body.specialInstructions, 1000) ? `SPECIAL: ${s(body.specialInstructions, 1000)}` : null,
      isStr ? "Report any damage or missing items found — it protects the host." : null,
      !isStr && body.coiRequired ? "COI required on file for this site." : null,
      quote?.breakdown
        ? `FACILITY: ${quote.breakdown.facility_type_label} · ${quote.breakdown.sqft.toLocaleString()} sq ft · ${quote.breakdown.scope_label} scope`
        : null,
      photoZones.length
        ? `PHOTOS: before and after for each zone — ${photoZones.join(", ")}. One pair for the whole site is not documentation at this size.`
        : null,
      crewSize > 1 ? `CREW OF ${crewSize} — coordinate coverage so no zone is cleaned twice or missed.` : null,
    ].filter(Boolean);

    // ─── Create the booking (client personal contact NOT copied on) ──────
    const { data: booking, error: insErr } = await admin
      .from("bookings")
      .insert({
        booking_type: bookingType,
        business_account_id: account?.id || null,
        business_site_id: site?.id || null,
        business_name: clientLabel,
        facility_type: isStr
          ? "Airbnb / Short-term rental"
          : (quote?.breakdown?.facility_type_label || site?.facility_type || account?.facility_type || null),
        facility_type_key: facilityTypeKey || null,
        scope_level: !isStr ? (scopeLevel || null) : null,
        square_footage: sqft,
        // Contractors see the business/property label, never a personal name+phone.
        first_name: clientLabel.slice(0, 80),
        last_name: "",
        email,                     // needed for comms/invoicing; not surfaced in the portal
        phone: "",                 // deliberately blank — client contact stays off the job
        address, city, state, zip_code: zip,
        service_type: serviceType,
        home_size_id: "commercial",
        add_ons: body.addOns || [],
        service_date: serviceDate,
        time_slot: arrivalWindow || hardDeadline,
        arrival_window: arrivalWindow || null,
        hard_deadline: hardDeadline || null,
        access_method: accessMethod,
        access_notes: accessParts.join("\n"),
        team_notes: teamParts.join("\n"),
        dispatch_notes: deadlineLine,
        partner_details: {
          booking_type: bookingType,
          business_account_id: account?.id || null,
          business_site_id: site?.id || null,
          host_id: property?.host_id || null,
          property_id: property?.id || null,
          str_checkout_time: s(body.strCheckoutTime, 40) || null,
          linen: s(body.linenNotes, 500) || null,
          restock: s(body.restockNotes, 500) || null,
          staging: s(body.stagingNotes, 500) || null,
          security: s(body.securityNotes, 600) || null,
          office_rules: s(body.officeNotes, 600) || null,
          coi_required: body.coiRequired === true,
          payment_status: paymentStatus,
          pay_pct_locked: payPct,
          schedule_id: body.scheduleId || null,
          compliance_warnings: complianceWarnings.length ? complianceWarnings : null,
        },
        commercial_walkthrough_id: walkthrough?.id || null,
        price_source: priceSource,
        estimate_low_cents: quote?.ok ? quote.estimateLowCents : null,
        estimate_high_cents: quote?.ok ? quote.estimateHighCents : null,
        commercial_pricing: quote?.breakdown
          ? {
            ...quote.breakdown,
            price_source: priceSource,
            requires_walkthrough: quote.requiresWalkthrough,
            walkthrough_threshold_sqft: quote.walkthroughThresholdSqft,
            walkthrough_id: walkthrough?.id || null,
            firm_price_cents: walkthrough?.firm_price_cents ?? null,
            crew: quote.crew,
          }
          : null,
        recommended_crew_size: recommendedCrew,
        service_window_hours: windowHours,
        photo_zones: photoZones.length ? photoZones : null,
        base_price_cents: finalPriceCents,
        total_estimate_cents: finalPriceCents,
        final_charge_cents: finalPriceCents,
        custom_quote_cents: finalPriceCents,
        deposit_cents: 0,
        platform_fee_cents: platformFeeCents,
        cleaner_payout_cents: cleanerPayoutCents,
        payout_status: "pending",
        num_cleaners_assigned: crewSize,
        payment_option: paymentStatus === "paid" ? "full" : paymentStatus === "card_on_file" ? "preauth" : "deposit",
        payment_received_at: paymentStatus === "paid" ? nowIso : null,
        payment_method: paymentStatus === "card_on_file" ? "Card on file" : paymentStatus === "invoice" ? "Invoice" : null,
        is_recurring: Boolean(body.recurring),
        recurring_frequency: body.recurring?.cadence || null,
        status: "confirmed",
        confirmed_at: nowIso,
        booking_channel: "admin_partner",
        booker_source: callerId === "service" ? "partner_recurring" : "partner_hub",
        estimated_duration_hours: quote?.crew?.projectedHours
          ? Math.max(1, Math.round(quote.crew.projectedHours * 10) / 10)
          : sqft ? Math.max(2, Math.min(8, Math.round(sqft / 1200))) : 3,
      })
      .select("id, booking_number")
      .single();
    if (insErr) throw insErr;
    const bookingId = booking.id as string;
    const ref = booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : bookingId.slice(0, 8);

    // ─── Recurring schedule (optional) ───────────────────────────────────
    let scheduleId: string | null = null;
    if (body.recurring && callerId !== "service") {
      const cadence = body.recurring.cadence;
      const next = new Date(`${serviceDate}T12:00:00`);
      if (cadence === "daily") next.setDate(next.getDate() + 1);
      else if (cadence === "weekly") next.setDate(next.getDate() + 7);
      else if (cadence === "biweekly") next.setDate(next.getDate() + 14);
      else next.setMonth(next.getMonth() + 1);
      const { data: sched } = await admin.from("partner_recurring_schedules").insert({
        booking_type: bookingType,
        business_account_id: account?.id || null,
        business_site_id: site?.id || null,
        facility_type_key: facilityTypeKey || null,
        scope_level: !isStr ? (scopeLevel || null) : null,
        sqft,
        service_window_hours: windowHours,
        num_cleaners: crewSize,
        host_id: property?.host_id || null,
        property_id: property?.id || null,
        cadence,
        days_of_week: body.recurring.daysOfWeek || null,
        day_of_month: body.recurring.dayOfMonth || null,
        preferred_window: arrivalWindow || null,
        hard_deadline: hardDeadline || null,
        price_cents: finalPriceCents,
        cleaner_pay_pct: payPct,
        service_type: serviceType,
        access_method: accessMethod,
        access_notes: accessParts.join("\n"),
        scope_notes: scopeNotes,
        special_instructions: s(body.specialInstructions, 1000) || null,
        preferred_cleaner_ids: (body.cleanerIds || []).length ? body.cleanerIds : null,
        next_service_date: next.toISOString().slice(0, 10),
        last_generated_date: serviceDate,
        created_by: callerId === "service" ? null : callerId,
      }).select("id").maybeSingle();
      scheduleId = sched?.id || null;
    }

    // ─── Crew: assign now (portal reflects immediately) or dispatch ──────
    let assignment: Record<string, unknown> | null = null;
    // A commercial crew is not capped at the residential two — a large
    // facility on a short window legitimately needs six.
    const cleanerIds = (body.cleanerIds || []).map(String).filter(Boolean).slice(0, 12);
    if (cleanerIds.length > 0) {
      const res = await admin.functions.invoke("admin-booking-assign", {
        body: { bookingId, cleanerIds, mode: "replace", allowUnpaid: paymentStatus !== "unpaid", notify: true },
      });
      assignment = res.data || null;
      if (res.error || (res.data && res.data.error)) {
        log("assign failed (booking still created)", { bookingId, error: res.error?.message || res.data?.error });
      }
    } else {
      await admin.functions.invoke("auto-dispatch-booking", { body: { bookingId, sendOffers: false } })
        .catch((e: unknown) => log("dispatch queue failed (non-blocking)", { error: String(e) }));
    }

    // ─── Ops visibility ──────────────────────────────────────────────────
    await admin.from("events").insert({
      event_type: "booking.created",
      booking_id: bookingId,
      source: "book-partner-job",
      summary: `${ref} — ${bookingType.replace("_", " ")} booked for ${clientLabel} on ${serviceDate}` +
        `${hardDeadline ? ` (deadline: ${hardDeadline})` : ""} · $${(finalPriceCents / 100).toFixed(2)}` +
        `${priceSource ? ` (${priceSource})` : ""}` +
        `${crewSize > 1 ? ` · crew of ${crewSize}` : ""}` +
        ` · crew pay locked $${(cleanerPayoutCents / 100).toFixed(2)} (${payPct}%)` +
        `${cleanerIds.length ? "" : " · awaiting dispatch"}`,
      data: {
        booking_type: bookingType,
        price_cents: finalPriceCents,
        price_source: priceSource,
        payment_status: paymentStatus,
        crew_size: crewSize,
        walkthrough_id: walkthrough?.id || null,
        compliance_warnings: complianceWarnings,
      },
    }).then(() => undefined, () => undefined);

    return json({
      ok: true,
      bookingId,
      ref,
      scheduleId,
      assigned: cleanerIds.length > 0,
      assignment,
      priceCents: finalPriceCents,
      priceSource,
      crewSize,
      recommendedCrewSize: recommendedCrew,
      photoZones,
      warnings: complianceWarnings,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log("ERROR", msg);
    const status = msg.includes("Not signed in") ? 401 : msg.includes("only") ? 403 : 500;
    return json({ ok: false, error: msg }, status);
  }
});
