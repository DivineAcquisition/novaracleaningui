// ─── sync-to-ghl ───────────────────────────────────────────────────────────
//
// Centralised Edge Function for pushing data into GoHighLevel via the Private
// Integration Token. Other edge functions can call this in one of two ways:
//
//   1. Direct in-process call via the helpers in `../_shared/ghl-client.ts`
//      (preferred for low-latency, in the same invocation).
//   2. HTTP invocation of this function with a JSON body shaped like:
//
//      { "kind": "lead"       | "waitlist" | "booking" | "reschedule",
//        "payload": { … } }
//
// The function is intentionally permissive — missing GHL credentials short-
// circuit cleanly and return 200 with `{ skipped: true }` so callers that
// fire-and-forget don't surface user-visible failures.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import {
  ghlIsConfigured,
  upsertContact,
  syncContactAndOpportunity,
  fmtMoney,
  ynBool,
  type GhlContactInput,
} from "../_shared/ghl-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Kind = "lead" | "waitlist" | "booking" | "reschedule" | "contact";

interface LeadPayload {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  zipCode?: string;
  city?: string;
  state?: string;
  source?: string;
  market?: string;
  customerSource?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  landingPage?: string;
  fbclid?: string;
  tags?: string[];
}

interface BookingPayload {
  // Customer
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;

  // Booking
  bookingId?: string;
  bookingNumber?: number | string;
  serviceType?: string;          // standard | deep | moveInOut
  cleaningType?: string;         // free-form display, e.g. "Deep Clean"
  serviceDate?: string;
  timeSlot?: string;
  homeSize?: string;
  membershipPlan?: string;
  frequency?: string;

  // Money (cents)
  basePriceCents?: number;
  quotedPriceCents?: number;     // pre-tax/fees
  discountedAmountCents?: number;
  depositCents?: number;
  remainingBalanceCents?: number;
  totalCents?: number;

  // Sales / ops
  csrName?: string;
  callType?: string;
  payOverCall?: boolean;
  depositPaid?: boolean;
  market?: string;
  customerSource?: string;

  // Cleaners (up to 3) — names + phones
  cleaners?: Array<{ name?: string; phone?: string }>;

  // Tracking
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;

  // Tags
  tags?: string[];
}

interface ReschedulePayload extends BookingPayload {
  previousDate?: string;
  previousTimeSlot?: string;
}

function leadToContact(p: LeadPayload, extraTags: string[] = []): GhlContactInput {
  return {
    email: p.email,
    phone: p.phone,
    firstName: p.firstName,
    lastName: p.lastName,
    city: p.city,
    state: p.state,
    postalCode: p.zipCode,
    source: p.source || "Novara Website",
    tags: [...(p.tags ?? []), ...extraTags, p.zipCode ? `zip-${p.zipCode}` : null]
      .filter(Boolean) as string[],
    customFieldsByKey: {
      utm_content: p.utmContent,
      utm_medium: p.utmMedium,
      utm_campaign: p.utmCampaign,
      market: p.market,
      customer_source: p.customerSource,
    },
  };
}

function bookingToContact(p: BookingPayload, extraTags: string[] = []): GhlContactInput {
  // Map (up to 3) cleaners → 1)/2)/3) Contractor + Contractor Number custom fields.
  const contractorFields: Record<string, string | undefined> = {};
  (p.cleaners || []).slice(0, 3).forEach((c, idx) => {
    const n = idx + 1;
    contractorFields[`${n}_contractor`] = c?.name || undefined;
    contractorFields[`${n}_contractor_number`] = c?.phone || undefined;
  });

  return {
    email: p.email,
    phone: p.phone,
    firstName: p.firstName,
    lastName: p.lastName,
    address1: p.address,
    city: p.city,
    state: p.state,
    postalCode: p.zipCode,
    source: "Novara Booking",
    tags: [
      "booking",
      p.serviceType ? `service-${p.serviceType}` : null,
      p.membershipPlan && p.membershipPlan !== "none" ? `member-${p.membershipPlan}` : null,
      p.zipCode ? `zip-${p.zipCode}` : null,
      ...extraTags,
    ].filter(Boolean) as string[],
    customFieldsByKey: {
      // Tracking attribution
      utm_content: p.utmContent,
      utm_medium: p.utmMedium,
      utm_campaign: p.utmCampaign,

      // Service / Scheduling
      cleaning_type: p.cleaningType || p.serviceType,

      // Internal Sales
      csr_name: p.csrName,
      call_type: p.callType,
      pay_over_call_: ynBool(p.payOverCall),
      quoted_price_pretaxfees: fmtMoney(p.quotedPriceCents),

      // Billing & Payments
      deposit_paid: ynBool(p.depositPaid),
      remaining_balance: fmtMoney(p.remainingBalanceCents),
      discounted_amount_: fmtMoney(p.discountedAmountCents),

      // Referral & Lead Source
      market: p.market,

      // General Info
      customer_source: p.customerSource,

      // Ops / Dispatch
      ...contractorFields,
    },
  };
}

function bookingDisplayName(p: BookingPayload): string {
  const ref = p.bookingNumber
    ? `NVC-${String(p.bookingNumber).padStart(4, "0")}`
    : p.bookingId
      ? `BK-${String(p.bookingId).slice(0, 8)}`
      : "Novara Booking";
  const who = [p.firstName, p.lastName].filter(Boolean).join(" ");
  return who ? `${ref} — ${who}` : ref;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!ghlIsConfigured()) {
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: "ghl-not-configured" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const body = (await req.json()) as { kind?: Kind; payload?: unknown };
    const kind = body.kind;
    const payload = (body.payload as Record<string, unknown>) || {};

    let contactId: string | null = null;
    let opportunityId: string | null = null;

    switch (kind) {
      case "lead":
      case "waitlist":
      case "contact": {
        const tags = kind === "waitlist" ? ["waitlist"] : ["lead"];
        contactId = await upsertContact(leadToContact(payload as LeadPayload, tags));
        break;
      }

      case "booking": {
        const p = payload as BookingPayload;
        const total = p.totalCents ?? 0;
        const result = await syncContactAndOpportunity({
          contact: bookingToContact(p),
          opportunity: {
            name: bookingDisplayName(p),
            status: "open",
            monetaryValue: total ? Math.round(total / 100) : undefined,
            source: "Novara Booking",
            customFieldsByKey: bookingToContact(p).customFieldsByKey,
          },
        });
        contactId = result.contactId;
        opportunityId = result.opportunityId;
        break;
      }

      case "reschedule": {
        const p = payload as ReschedulePayload;
        // Rescheduling: refresh the contact's service-date custom field via the
        // existing cleaning_type field is not appropriate — instead we just
        // re-upsert the contact (which keeps tags fresh) and add a marker tag.
        contactId = await upsertContact(
          bookingToContact(p, ["rescheduled", p.serviceDate ? `svc-${p.serviceDate}` : ""]
            .filter(Boolean) as string[]),
        );
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown kind: ${kind}` }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
        );
    }

    return new Response(
      JSON.stringify({ success: true, kind, contactId, opportunityId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[sync-to-ghl] error", message);
    return new Response(
      JSON.stringify({ error: message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
