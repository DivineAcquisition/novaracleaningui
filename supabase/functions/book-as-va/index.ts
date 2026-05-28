// ─── book-as-va ──────────────────────────────────────────────────────────
//
// Internal booking endpoint VAs hit from the admin subdomain when they
// finish a call. Atomically:
//
//   1. Upsert the customer row (no auth requirement — VA is the actor)
//   2. Insert the booking row with the canonical pricing fields
//   3. If the source was a lead, advance the lead status to 'booked'
//      and stamp the call outcome so reporting works
//   4. Push the contact + opportunity into the right GHL pipeline
//      (the Sales Pipeline, not the Hiring Pipeline — uses
//      app_secrets.GHL_SALES_PIPELINE_ID)
//   5. Optionally create Stripe invoices:
//        a) $deposit invoice due today (configurable, default 50%)
//        b) $remaining invoice due on the service date
//   6. Send confirmation email + payment receipt + Standard Clean
//      checklist via Resend
//   7. Send confirmation SMS via send-ghl-sms (so it rides the verified
//      GHL number, no Telnyx dependency)
//   8. Return everything the UI needs to copy/paste invoice URLs to the
//      customer while still on the phone.
//
// Body (every field optional except the ones called out):
//   leadId?           — link to an existing public.leads row
//   firstName *required, lastName, email *required, phone *required
//   address, city, state, zipCode
//   homeSizeId *required ('0_999' .. '4501_5000')
//   serviceType *required ('standard' | 'deep' | 'moveInOut' | 'combo')
//   addOns?: ('fridge' | 'oven' | 'windows')[]
//   frequency? ('one-time' | 'recurring')
//   serviceDate *required (YYYY-MM-DD)
//   timeSlot *required (e.g. '10:00 AM - 11:00 AM')
//   bedrooms?, bathrooms?, dwellingType?, pets?, sqft?
//   priceOverride?: { total: cents, deposit?: cents }  — admin override
//   invoiceMode? 'deposit_plus_remaining' | 'full_now' | 'none'
//      defaults to 'deposit_plus_remaining'
//   depositPercent? 0..1 (defaults 0.5)
//   csrName?, customerSource? — booker metadata for reporting
//   notes?, teamNotes?, accessNotes?
//   sendConfirmationSms? bool (default true)
//   sendChecklistEmail? bool (default true based on serviceType==='standard')
//
// Response: { booking, customerId, ghlContactId, ghlOpportunityId,
//             depositInvoice?, remainingInvoice?, fullInvoice?,
//             smsResult, emails }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import Stripe from "https://esm.sh/stripe@18.5.0";
import {
  runPostConfirmFanout,
  checklistLinkForServiceType,
} from "../_shared/post-confirm-booking.ts";
import { getEstimatedHours } from "../_shared/payout-utils.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[BOOK-AS-VA] ${step}${tail}`);
};

// ─── Pricing (must mirror create-payment-intent for consistency) ────
const SERVICE_TIER_MULTIPLIERS: Record<string, number> = {
  standard: 1.0,
  deep: 1.5,
  combo: 2.5,
  moveInOut: 2.0,
};
const ADD_ON_PRICING: Record<string, number> = {
  fridge: 3000,
  oven: 3000,
  windows: 4000,
};
const HOME_SIZE_PRICING: Record<string, number> = {
  "0_999": 27000,
  "1000_1500": 34200,
  "1501_2000": 43200,
  "2001_2500": 50400,
  "2501_3000": 61200,
  "3001_3500": 68400,
  "3501_4000": 79200,
  "4001_4500": 88200,
  "4501_5000": 97200,
  "5000_plus": 0,
};

function computePrice(opts: {
  homeSizeId: string;
  serviceType: string;
  addOns: string[];
}): { base: number; serviceAdj: number; addOnTotal: number; total: number } {
  const base = HOME_SIZE_PRICING[opts.homeSizeId] ?? 0;
  const mult = SERVICE_TIER_MULTIPLIERS[opts.serviceType] ?? 1;
  const serviceAdj = Math.round(base * mult);
  const addOnTotal = (opts.addOns || []).reduce(
    (sum, a) => sum + (ADD_ON_PRICING[a] ?? 0),
    0,
  );
  const total = serviceAdj + addOnTotal;
  return { base, serviceAdj, addOnTotal, total };
}

// ─── E.164 normalizer ───────────────────────────────────────────────
function toE164(input: string | undefined | null): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (raw.startsWith("+")) {
    const d = raw.slice(1).replace(/[^0-9]/g, "");
    return d ? `+${d}` : null;
  }
  const d = raw.replace(/[^0-9]/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return d ? `+${d}` : null;
}

// ─── App-secret resolver ────────────────────────────────────────────
async function resolveSecret(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  name: string,
): Promise<string> {
  let value = "";
  try {
    const { data } = await supabase
      .from("app_secrets")
      .select("value")
      .eq("key", name)
      .maybeSingle();
    if (data?.value && typeof data.value === "string") value = data.value.trim();
  } catch (_) { /* ignore */ }
  if (!value) value = (Deno.env.get(name) || "").trim();
  return value;
}

// ─── Stripe + invoice helpers ───────────────────────────────────────
async function ensureStripeCustomer(
  stripe: Stripe,
  email: string,
  firstName: string,
  lastName: string,
  phoneE164: string | null,
  address: {
    line1?: string;
    city?: string;
    state?: string;
    postal_code?: string;
  },
): Promise<string> {
  const found = await stripe.customers.list({ email, limit: 1 });
  if (found.data.length > 0) return found.data[0].id;
  const created = await stripe.customers.create({
    email,
    name: `${firstName || ""} ${lastName || ""}`.trim() || undefined,
    phone: phoneE164 || undefined,
    address: {
      line1: address.line1 || undefined,
      city: address.city || undefined,
      state: address.state || undefined,
      postal_code: address.postal_code || undefined,
      country: "US",
    },
  });
  return created.id;
}

async function createAndSendInvoice(
  stripe: Stripe,
  customerId: string,
  amountCents: number,
  description: string,
  daysUntilDue: number,
  metadata: Record<string, string>,
): Promise<{ invoiceId: string; hostedInvoiceUrl: string | null }> {
  await stripe.invoiceItems.create({
    customer: customerId,
    amount: amountCents,
    currency: "usd",
    description,
  });
  const invoice = await stripe.invoices.create({
    customer: customerId,
    collection_method: "send_invoice",
    days_until_due: daysUntilDue,
    pending_invoice_items_behavior: "include",
    description,
    metadata,
    auto_advance: true,
  });
  if (!invoice.id) throw new Error("Stripe did not return invoice id");
  const finalized = await stripe.invoices.finalizeInvoice(invoice.id, {
    auto_advance: true,
  });
  await stripe.invoices.sendInvoice(invoice.id);
  return {
    invoiceId: invoice.id,
    hostedInvoiceUrl: finalized.hosted_invoice_url || null,
  };
}

// ─── GHL contact + opportunity push ─────────────────────────────────
const NON_SALES_PIPELINE_RE =
  /\b(hir|recruit|cleaner|team|onboard|driver|contractor|applicant|interview)\b/i;

async function ghlPushBooking(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  bookingRow: Record<string, unknown>,
  total: number,
  token: string,
  locationId: string,
): Promise<{ contactId: string | null; opportunityId: string | null }> {
  if (!token || !locationId) return { contactId: null, opportunityId: null };
  const phoneE164 = toE164(bookingRow.phone as string);
  const contactBody: Record<string, unknown> = {
    locationId,
    email: bookingRow.email,
    phone: phoneE164 || undefined,
    firstName: bookingRow.first_name,
    lastName: bookingRow.last_name,
    address1: bookingRow.address,
    city: bookingRow.city,
    state: bookingRow.state,
    postalCode: bookingRow.zip_code,
    country: "US",
    source: "Novara Admin Booking",
    tags: [
      "booking",
      "admin-booked",
      bookingRow.service_type ? `service-${bookingRow.service_type}` : null,
      bookingRow.zip_code ? `zip-${bookingRow.zip_code}` : null,
    ].filter(Boolean),
  };
  let contactId: string | null = null;
  try {
    const res = await fetch(`${GHL_BASE}/contacts/upsert`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Version: GHL_VERSION,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(contactBody),
    });
    if (res.ok) {
      const json = await res.json();
      contactId = (json?.contact?.id as string | undefined) ||
        (json?.id as string | undefined) || null;
    } else {
      logStep("GHL contact upsert failed", { status: res.status });
    }
  } catch (_) { /* ignore */ }
  if (!contactId) return { contactId: null, opportunityId: null };

  let pipelineId = await resolveSecret(supabase, "GHL_SALES_PIPELINE_ID");
  let stageId = await resolveSecret(supabase, "GHL_SALES_PIPELINE_STAGE_ID");
  if (!pipelineId) {
    pipelineId = (Deno.env.get("GHL_PIPELINE_ID") || "").trim();
    stageId = stageId || (Deno.env.get("GHL_PIPELINE_STAGE_ID") || "").trim();
  }
  if (!pipelineId) {
    try {
      const r = await fetch(
        `${GHL_BASE}/opportunities/pipelines?locationId=${
          encodeURIComponent(locationId)
        }`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Version: GHL_VERSION,
            Accept: "application/json",
          },
        },
      );
      if (r.ok) {
        const j = await r.json();
        const all = (j.pipelines || []) as Array<{
          id?: string;
          name?: string;
          stages?: Array<{ id?: string; name?: string; position?: number }>;
        }>;
        const chosen = all.find((p) =>
          p.id && !NON_SALES_PIPELINE_RE.test(p.name || "")
        );
        if (chosen?.id) {
          pipelineId = chosen.id;
          const stage = (chosen.stages || [])
            .slice()
            .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0];
          if (stage?.id) stageId = stage.id;
        }
      }
    } catch (_) { /* ignore */ }
  }
  let opportunityId: string | null = null;
  if (pipelineId) {
    try {
      const oppBody = {
        locationId,
        contactId,
        pipelineId,
        pipelineStageId: stageId || undefined,
        name: `Novara Booking — ${bookingRow.first_name} ${bookingRow.last_name}`
          .trim(),
        status: "open",
        monetaryValue: Math.round(total / 100),
        source: "Novara Admin Booking",
      };
      const res = await fetch(`${GHL_BASE}/opportunities/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Version: GHL_VERSION,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(oppBody),
      });
      if (res.ok) {
        const json = await res.json();
        opportunityId = (json?.opportunity?.id as string | undefined) ||
          (json?.id as string | undefined) || null;
      }
    } catch (_) { /* ignore */ }
  }
  return { contactId, opportunityId };
}

// ─── Main handler ───────────────────────────────────────────────────
interface VaBookingBody {
  leadId?: string;
  firstName: string;
  lastName?: string;
  email: string;
  phone: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  // Optional geocoded coordinates from the admin AddressAutocomplete.
  // We mirror them onto the customers row so the Ops Map can plot the
  // visit without a second geocode.
  addressLat?: number;
  addressLng?: number;
  homeSizeId: string;
  serviceType: string;
  addOns?: string[];
  frequency?: string;
  serviceDate: string;
  timeSlot: string;
  bedrooms?: number;
  bathrooms?: number;
  dwellingType?: string;
  pets?: string;
  flooringType?: string;
  sqft?: number;
  priceOverride?: { total: number; deposit?: number };
  invoiceMode?: "deposit_plus_remaining" | "full_now" | "none";
  depositPercent?: number;
  csrName?: string;
  customerSource?: string;
  notes?: string;
  teamNotes?: string;
  accessNotes?: string;
  sendConfirmationSms?: boolean;
  sendChecklistEmail?: boolean;
  /**
   * Property details bag forwarded by the admin Internal Booking
   * form's collapsible section. We persist these on the booking row
   * so dispatch + cleaner job offers see them immediately, instead of
   * leaving them blank until the customer revisits /book/details.
   *
   * Field-name conventions mirror what the form actually emits:
   *   • flooring (string)         → bookings.flooring_type
   *   • comboFollowUpDate (date)  → bookings.second_visit_date
   *   • parkingNotes (string)     → appended to bookings.access_notes
   *   • suppliesProvidedBy (string) → appended to bookings.team_notes
   */
  propertyDetails?: {
    bedrooms?: number;
    bathrooms?: number;
    sqft?: number;
    dwellingType?: string;
    pets?: string;
    flooringType?: string;
    flooring?: string | string[];
    parkingNotes?: string;
    suppliesProvidedBy?: string;
    accessNotes?: string;
    secondVisitDate?: string | null;
    comboFollowUpDate?: string | null;
  };
  /** Optional promo code from the admin form. Currently informational only on the VA path. */
  promoCode?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body: VaBookingBody = await req.json();
    if (
      !body.firstName || !body.email || !body.phone || !body.homeSizeId ||
      !body.serviceType || !body.serviceDate || !body.timeSlot
    ) {
      return new Response(
        JSON.stringify({
          error:
            "firstName, email, phone, homeSizeId, serviceType, serviceDate, timeSlot are required",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        },
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // 1. Compute pricing
    const phoneE164 = toE164(body.phone);
    const phoneDigits = (phoneE164 || "").replace(/^\+1/, "").replace(
      /[^0-9]/g,
      "",
    );
    const calc = computePrice({
      homeSizeId: body.homeSizeId,
      serviceType: body.serviceType,
      addOns: body.addOns || [],
    });
    const totalCents = body.priceOverride?.total ?? calc.total;
    const depositPercent = typeof body.depositPercent === "number"
      ? Math.max(0, Math.min(1, body.depositPercent))
      : 0.5;
    const invoiceMode = body.invoiceMode || "deposit_plus_remaining";
    const depositCents = body.priceOverride?.deposit ??
      (invoiceMode === "full_now"
        ? totalCents
        : Math.round(totalCents * depositPercent));
    const remainingCents = Math.max(0, totalCents - depositCents);

    // 2. Upsert the customer row (no Stripe yet). We mirror lat/lng
    //    from the admin AddressAutocomplete so the Ops Map can plot
    //    the customer immediately, instead of waiting on the next
    //    geocode-address pass.
    const { data: customerRow, error: custErr } = await supabase
      .from("customers")
      .upsert(
        {
          email: body.email,
          first_name: body.firstName,
          last_name: body.lastName || "",
          phone: phoneDigits || null,
          address: body.address || null,
          city: body.city || null,
          state: body.state || null,
          zip: body.zipCode || null,
          lat: body.addressLat ?? null,
          lng: body.addressLng ?? null,
        },
        { onConflict: "email" },
      )
      .select("id")
      .single();
    if (custErr) {
      logStep("customer upsert failed", custErr);
      throw custErr;
    }
    const customerId = customerRow.id as string;

    // 3. Insert the booking row
    //
    // VA bookings flow through the same downstream helper as customer
    // bookings (see runPostConfirmFanout below). For that to work we
    // need to stamp the same financial + ops fields create-payment-
    // intent stamps on the customer path: cleaner_payout_cents,
    // platform_fee_cents, payout_status, estimated_duration_hours,
    // offer_type. Otherwise auto-dispatch + payroll see NULL and skip
    // the row.
    const bookingStatus = invoiceMode === "none"
      ? "pending_payment"
      : "confirmed";

    // Cleaner pay = revenue × 35% (Foundation default at booking time
    // — dispatch-job recomputes when offering using the assigned
    // cleaner's actual tier %).
    const DEFAULT_BOOKING_PAY_PCT = 35;
    const cleanerPayoutCents = Math.floor(
      (totalCents * DEFAULT_BOOKING_PAY_PCT) / 100,
    );
    const platformFeeCents = Math.max(0, totalCents - cleanerPayoutCents);

    // Property details bag — accept either flat fields on the body or
    // a nested propertyDetails object. The admin Internal Booking form
    // sends the nested shape; older callers send flat.
    const pd = body.propertyDetails || {};
    const bedrooms = pd.bedrooms ?? body.bedrooms ?? null;
    const bathrooms = pd.bathrooms ?? body.bathrooms ?? null;
    const sqft = pd.sqft ?? body.sqft ?? null;
    const dwellingType = pd.dwellingType || body.dwellingType || null;
    const pets = pd.pets || body.pets || null;
    const flooringRaw = pd.flooringType ?? pd.flooring ?? body.flooringType;
    const flooringType = Array.isArray(flooringRaw)
      ? flooringRaw.join(", ")
      : (flooringRaw || null);
    const accessNotesParts: string[] = [];
    if (pd.accessNotes || body.accessNotes) accessNotesParts.push(String(pd.accessNotes || body.accessNotes));
    if (pd.parkingNotes) accessNotesParts.push(`Parking: ${pd.parkingNotes}`);
    const accessNotes = accessNotesParts.length ? accessNotesParts.join(" · ") : null;
    const teamNotesParts: string[] = [];
    if (body.teamNotes || body.notes) teamNotesParts.push(String(body.teamNotes || body.notes));
    if (pd.suppliesProvidedBy) teamNotesParts.push(`Supplies: ${pd.suppliesProvidedBy}`);
    if (body.promoCode) teamNotesParts.push(`Promo code: ${body.promoCode.toUpperCase()}`);
    const teamNotes = teamNotesParts.length ? teamNotesParts.join(" · ") : null;
    const secondVisitDate = pd.secondVisitDate || pd.comboFollowUpDate || null;

    const { data: booking, error: bookErr } = await supabase
      .from("bookings")
      .insert({
        customer_id: customerId,
        email: body.email,
        first_name: body.firstName,
        last_name: body.lastName || "",
        phone: phoneDigits || null,
        address: body.address || null,
        city: body.city || null,
        state: body.state || null,
        zip_code: body.zipCode || null,
        home_size_id: body.homeSizeId,
        service_type: body.serviceType,
        offer_type: body.serviceType,
        add_ons: body.addOns || [],
        frequency: body.frequency || "one-time",
        service_date: body.serviceDate,
        time_slot: body.timeSlot,
        arrival_window: body.timeSlot,
        bedrooms,
        bathrooms,
        dwelling_type: dwellingType,
        pets,
        flooring_type: flooringType,
        sqft,
        second_visit_date: secondVisitDate,
        base_price_cents: calc.serviceAdj,
        deposit_cents: depositCents,
        total_estimate_cents: totalCents,
        platform_fee_cents: platformFeeCents,
        cleaner_payout_cents: cleanerPayoutCents,
        payout_status: "pending",
        payment_option: invoiceMode === "full_now" ? "full" : "deposit",
        estimated_duration_hours: getEstimatedHours(body.homeSizeId),
        status: bookingStatus,
        // For confirmed VA bookings, treat the moment of insert as the
        // confirmation timestamp so reporting / GHL / dispatch all see
        // a non-null confirmed_at like customer bookings do.
        confirmed_at:
          bookingStatus === "confirmed" ? new Date().toISOString() : null,
        booking_channel: "admin",
        booker_source: body.csrName ? `va_${body.csrName}` : "va_admin",
        sdr_rep_name: body.csrName || null,
        access_notes: accessNotes,
        team_notes: teamNotes,
      })
      .select()
      .single();
    if (bookErr) {
      logStep("booking insert failed", bookErr);
      throw bookErr;
    }
    const bookingId = booking.id as string;
    const bookingRef = booking.booking_number
      ? `NOV-${String(booking.booking_number).padStart(5, "0")}`
      : `BK-${bookingId.slice(0, 8)}`;

    // 4. Advance the lead, if linked
    if (body.leadId) {
      await supabase
        .from("leads")
        .update({
          status: "booked",
          last_call_outcome: "booked",
          existing_customer_id: customerId,
        })
        .eq("id", body.leadId);
    }

    // 5. GHL contact + opportunity (correct Sales Pipeline)
    const ghlToken = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
    const ghlLocation = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
    const { contactId: ghlContactId, opportunityId: ghlOpportunityId } =
      await ghlPushBooking(supabase, booking, totalCents, ghlToken, ghlLocation);

    // 5b. Book the appointment in the GHL Calendar so the contact's
    // calendar block shows the visit. Idempotent — book-ghl-appointment
    // updates an existing GHL appointment if one is already on the row.
    let ghlAppointmentId: string | null = null;
    try {
      const r = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/book-ghl-appointment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          },
          body: JSON.stringify({ bookingId }),
        },
      );
      const j = await r.json();
      if (j?.success) ghlAppointmentId = j.appointmentId || null;
      else logStep("GHL appointment failed (non-blocking)", j);
    } catch (apptErr) {
      logStep("GHL appointment call errored (non-blocking)", apptErr);
    }

    // 6. Stripe invoices (deposit_plus_remaining / full_now / none)
    let depositInvoice: { invoiceId: string; hostedInvoiceUrl: string | null } | null = null;
    let remainingInvoice: { invoiceId: string; hostedInvoiceUrl: string | null } | null = null;
    let fullInvoice: { invoiceId: string; hostedInvoiceUrl: string | null } | null = null;
    if (invoiceMode !== "none" && totalCents > 0) {
      const stripeKey = await resolveSecret(supabase, "STRIPE_SECRET_KEY");
      if (stripeKey) {
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
        const stripeCustomerId = await ensureStripeCustomer(
          stripe,
          body.email,
          body.firstName,
          body.lastName || "",
          phoneE164,
          {
            line1: body.address,
            city: body.city,
            state: body.state,
            postal_code: body.zipCode,
          },
        );
        await supabase
          .from("bookings")
          .update({ customer_id: stripeCustomerId })
          .eq("id", bookingId);

        const svcMs = new Date(`${body.serviceDate}T12:00:00`).getTime();
        const daysToService = Math.max(
          0,
          Math.ceil((svcMs - Date.now()) / 86400000),
        );

        if (invoiceMode === "deposit_plus_remaining") {
          if (depositCents > 0) {
            depositInvoice = await createAndSendInvoice(
              stripe,
              stripeCustomerId,
              depositCents,
              `${bookingRef} — Deposit for ${body.serviceType} cleaning on ${body.serviceDate}`,
              0,
              {
                booking_id: bookingId,
                booking_number: String(booking.booking_number || ""),
                purpose: "deposit",
              },
            );
          }
          if (remainingCents > 0) {
            remainingInvoice = await createAndSendInvoice(
              stripe,
              stripeCustomerId,
              remainingCents,
              `${bookingRef} — Remaining balance for ${body.serviceType} cleaning on ${body.serviceDate}`,
              daysToService,
              {
                booking_id: bookingId,
                booking_number: String(booking.booking_number || ""),
                purpose: "remaining_balance",
              },
            );
            await supabase
              .from("bookings")
              .update({
                stripe_invoice_id: remainingInvoice.invoiceId,
                hosted_invoice_url: remainingInvoice.hostedInvoiceUrl,
              })
              .eq("id", bookingId);
          }
        } else if (invoiceMode === "full_now") {
          fullInvoice = await createAndSendInvoice(
            stripe,
            stripeCustomerId,
            totalCents,
            `${bookingRef} — Full payment for ${body.serviceType} cleaning on ${body.serviceDate}`,
            0,
            {
              booking_id: bookingId,
              booking_number: String(booking.booking_number || ""),
              purpose: "full_payment",
            },
          );
          await supabase
            .from("bookings")
            .update({
              stripe_invoice_id: fullInvoice.invoiceId,
              hosted_invoice_url: fullInvoice.hostedInvoiceUrl,
            })
            .eq("id", bookingId);
        }
      } else {
        logStep("skipping invoice — STRIPE_SECRET_KEY not configured");
      }
    }

    // 7. Confirmation + receipt emails + downstream fan-out.
    //
    // We delegate to the SAME shared helper finalize-booking uses, so
    // VA bookings fire identical side effects to customer bookings:
    //   • Confirmation email (with checklist link)
    //   • Payment receipt email (only when an invoice was created)
    //   • auto-dispatch-booking
    //   • create-google-calendar-event
    //   • send-zapier-webhook (full GHL custom-field map)
    //   • sync-to-anything
    //   • book-ghl-appointment (no-op since we already invoked above)
    //   • send-post-booking-sms (account + referral link)
    //
    // We DO skip the customer SMS in the helper because we still want
    // to send the VA-specific invoice-aware copy below (different from
    // the Telnyx confirmation SMS the customer flow uses).
    //
    // Pre-stamp hosted_invoice_url on the booking row so the helper's
    // confirmation email carries the right "Pay invoice" link.
    if (depositInvoice?.hostedInvoiceUrl || fullInvoice?.hostedInvoiceUrl) {
      const url = depositInvoice?.hostedInvoiceUrl || fullInvoice?.hostedInvoiceUrl;
      if (url) {
        await supabase
          .from("bookings")
          .update({ hosted_invoice_url: url })
          .eq("id", bookingId);
      }
    }
    // For confirmed VA bookings, mark payment_received_at when the
    // VA collected payment in-line (full_now). deposit_plus_remaining
    // leaves it null until the customer actually pays the invoice —
    // the stripe-webhook will stamp it when invoice.payment_succeeded.
    if (bookingStatus === "confirmed" && invoiceMode === "full_now") {
      await supabase
        .from("bookings")
        .update({ payment_received_at: new Date().toISOString() })
        .eq("id", bookingId);
    }

    const emails: Record<string, unknown> = {};
    if (bookingStatus === "confirmed") {
      try {
        // Re-fetch the booking row so the shared helper sees the
        // hosted_invoice_url + payment_received_at + customer_id we
        // just stamped. Otherwise its email payload would miss them.
        const { data: refreshed } = await supabase
          .from("bookings")
          .select("*")
          .eq("id", bookingId)
          .single();

        const fanout = await runPostConfirmFanout(
          supabase,
          refreshed || booking,
          {
            source: "admin",
            checklistLink: checklistLinkForServiceType(body.serviceType),
            // Customer SMS is sent below with VA-specific invoice copy.
            skipCustomerSms: true,
          },
        );
        emails.fanout = fanout;
      } catch (err) {
        emails.fanout_error = err instanceof Error ? err.message : String(err);
        logStep("post-confirm fanout failed (non-blocking)", emails.fanout_error);
      }
    } else {
      logStep("invoiceMode=none → skipping post-confirm fanout (booking still pending_payment)");
    }

    // 8. Confirmation SMS via GHL (uses verified outbound number)
    let smsResult: unknown = null;
    if (body.sendConfirmationSms !== false && phoneE164) {
      try {
        const fname = body.firstName;
        const msgParts = [
          `Novara Cleaning: Hi ${fname}! Your ${body.serviceType} clean is confirmed for ${body.serviceDate} ${body.timeSlot}`,
        ];
        if (body.address) msgParts.push(`at ${body.address}`);
        msgParts.push(`. Total $${(totalCents / 100).toFixed(2)}.`);
        if (depositInvoice) {
          msgParts.push(
            ` Deposit invoice ($${(depositCents / 100).toFixed(2)}) just sent to your email — please pay today.`,
          );
        }
        if (remainingInvoice) {
          msgParts.push(
            ` Remaining $${(remainingCents / 100).toFixed(2)} is due on ${body.serviceDate}.`,
          );
        }
        if (fullInvoice) {
          msgParts.push(` Invoice sent to your email.`);
        }
        msgParts.push(" Reply HELP for help or STOP to opt out.");
        const sms = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-ghl-sms`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
            },
            body: JSON.stringify({
              contactId: ghlContactId || undefined,
              phone: phoneE164,
              email: body.email,
              firstName: body.firstName,
              lastName: body.lastName || "",
              message: msgParts.join(""),
            }),
          },
        );
        smsResult = await sms.json();
      } catch (err) {
        smsResult = { error: err instanceof Error ? err.message : String(err) };
      }
    }

    // 9. Final response — gives the VA everything they need to copy/paste
    return new Response(
      JSON.stringify({
        success: true,
        bookingId,
        bookingNumber: bookingRef,
        customerId,
        ghlContactId,
        ghlOpportunityId,
        ghlAppointmentId,
        invoiceMode,
        totals: {
          totalCents,
          depositCents,
          remainingCents,
        },
        depositInvoice,
        remainingInvoice,
        fullInvoice,
        smsResult,
        emails,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[book-as-va] error", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
