import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GHL_API = "https://services.leadconnectorhq.com";
const GHL_TOKEN = Deno.env.get("GHL_API_KEY") || "";
const GHL_LOCATION_ID = Deno.env.get("GHL_LOCATION_ID") || "fJddieqJDUjUoYAGOvbk";

const PIPELINE_ID = "uKlxEl5MAe0zLIqxwDHC";
const STAGES: Record<string, string> = {
  new_lead:           "c72020ff-7d43-4a92-8573-52306ad47cc7",
  contacted:          "a285bbf7-b531-4835-b5aa-78b2af3e2594",
  cold:               "36763bf7-1fae-4566-adc2-82d70a9830fd",
  quote_sent:         "5350f3dc-73a0-4ea1-8a31-7878a8d109d5",
  deposit_pending:    "7086a5c3-4db7-43b6-a0e3-27dc848d5da5",
  paid_confirmed:     "15f56c03-aba3-4a14-b6ea-d5e5a8d1be0a",
  reschedule:         "504acdf3-d24f-4853-b9b6-12bb29868592",
  job_completed:      "874eeff3-6c76-4232-b355-d7bbd92d7a5a",
  upsell_membership:  "22433a54-2ea4-4131-a84e-78421145e2ee",
  membership_active:  "8185018b-bdbc-43c9-9387-f7a483b5a5c2",
  active_recurring:   "88e1de8f-2b0b-44f7-b0a7-f90f7d42abd0",
  canceled_lost:      "4435fb68-8faf-4beb-9c7b-2b8752f70f4d",
  recurring_paused:   "8f5a9bd7-5a13-49aa-9620-09031c4eae6b",
};

const EVENT_TO_STAGE: Record<string, string> = {
  lead_captured:       "contacted",
  checkout_started:    "deposit_pending",
  payment_confirmed:   "paid_confirmed",
  booking_completed:   "job_completed",
  booking_cancelled:   "canceled_lost",
  booking_rescheduled: "reschedule",
  abandoned_cart:      "cold",
  membership_created:  "membership_active",
  membership_cancelled:"canceled_lost",
  upsell_offered:      "upsell_membership",
};

const EVENT_TO_TAGS: Record<string, { add: string[]; remove: string[] }> = {
  lead_captured:       { add: ["lead - contacted"],               remove: [] },
  checkout_started:    { add: ["bk - deposit pending"],           remove: [] },
  payment_confirmed:   { add: ["bk - confirmed", "lead - deposit paid", "client - active"], remove: ["bk - deposit pending"] },
  booking_completed:   { add: ["bk - completed"],                 remove: ["bk - confirmed"] },
  booking_cancelled:   { add: [],                                 remove: ["bk - confirmed", "bk - deposit pending"] },
  booking_rescheduled: { add: [],                                 remove: [] },
  abandoned_cart:      { add: ["lead - cold"],                    remove: [] },
  membership_created:  { add: ["client - active", "client - vip"],remove: [] },
  membership_cancelled:{ add: [],                                 remove: ["client - vip"] },
};

const HOME_SIZE_LABELS: Record<string, string> = {
  "0_999":      "Under 1,000 sqft",
  "1000_1500":  "1,000 - 1,500 sqft",
  "1501_2000":  "1,501 - 2,000 sqft",
  "2001_2500":  "2,001 - 2,500 sqft",
  "2501_3000":  "2,501 - 3,000 sqft",
  "3001_3500":  "3,001 - 3,500 sqft",
  "3501_4000":  "3,501 - 4,000 sqft",
  "4001_4500":  "4,001 - 4,500 sqft",
  "4501_5000":  "4,501 - 5,000 sqft",
};

const SERVICE_TYPE_LABELS: Record<string, string> = {
  standard:  "Standard Cleaning",
  deep:      "Deep Cleaning",
  moveInOut: "Move In/Out",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[GHL-SYNC] ${step}${d}`);
};

async function ghlFetch(path: string, options: RequestInit = {}): Promise<any> {
  const resp = await fetch(`${GHL_API}${path}`, {
    ...options,
    headers: {
      "Authorization": `Bearer ${GHL_TOKEN}`,
      "Version": "2021-07-28",
      "Content-Type": "application/json",
      "Accept": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await resp.json();
  if (!resp.ok && resp.status !== 422) {
    logStep("GHL API error", { status: resp.status, path, data });
  }
  return { status: resp.status, data };
}

async function findOrCreateContact(
  contactData: Record<string, any>
): Promise<{ contactId: string; isNew: boolean }> {
  const email = contactData.email?.toLowerCase();
  const phone = contactData.phone;

  if (email) {
    const { data } = await ghlFetch(
      `/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&email=${encodeURIComponent(email)}`
    );
    if (data?.contact?.id) {
      return { contactId: data.contact.id, isNew: false };
    }
  }

  if (phone) {
    const cleanPhone = phone.replace(/\D/g, '');
    if (cleanPhone.length >= 10) {
      const formattedPhone = cleanPhone.length === 10 ? `+1${cleanPhone}` : `+${cleanPhone}`;
      const { data } = await ghlFetch(
        `/contacts/search/duplicate?locationId=${GHL_LOCATION_ID}&phone=${encodeURIComponent(formattedPhone)}`
      );
      if (data?.contact?.id) {
        return { contactId: data.contact.id, isNew: false };
      }
    }
  }

  const createPayload: Record<string, any> = {
    locationId: GHL_LOCATION_ID,
    firstName: contactData.firstName || "",
    lastName: contactData.lastName || "",
    email: email || undefined,
    phone: contactData.phone || undefined,
    address1: contactData.address || undefined,
    city: contactData.city || undefined,
    state: contactData.state || undefined,
    postalCode: contactData.zipCode || undefined,
    source: "Booking Website",
    tags: contactData.tags || [],
  };

  const { status, data } = await ghlFetch("/contacts/", { method: "POST", body: JSON.stringify(createPayload) });
  if (status === 201 && data?.contact?.id) {
    return { contactId: data.contact.id, isNew: true };
  }

  throw new Error(`Failed to create GHL contact: ${JSON.stringify(data)}`);
}

function buildCustomFields(booking: Record<string, any>): Array<{ key: string; field_value: any }> {
  const fields: Array<{ key: string; field_value: any }> = [];
  const set = (key: string, val: any) => {
    if (val !== undefined && val !== null && val !== '') {
      fields.push({ key, field_value: String(val) });
    }
  };

  set("contact.cleaning_type", SERVICE_TYPE_LABELS[booking.serviceType || booking.service_type] || booking.serviceType || booking.service_type);
  set("contact.home_size_range", HOME_SIZE_LABELS[booking.homeSizeId || booking.home_size_id] || booking.homeSizeId || booking.home_size_id);
  set("contact.estimated_sqft", booking.sqft || booking.estimated_sqft);
  set("contact.bedrooms", booking.bedrooms);
  set("contact.bathrooms", booking.bathrooms);
  set("contact.dwelling_type", booking.dwellingType || booking.dwelling_type);
  set("contact.service_frequency", booking.frequency || "One-Time");
  set("contact.preferred_start_date", booking.serviceDate || booking.service_date);
  set("contact.service_start_time", booking.timeSlot || booking.time_slot);
  set("contact.estimated_duration_hrs", booking.estimatedDurationHours || booking.estimated_duration_hours || booking.serviceDuration);

  const totalCents = booking.totalEstimateCents || booking.total_estimate_cents;
  if (totalCents) set("contact.quoted_price_pretaxfees", (totalCents / 100).toFixed(2));

  const depositCents = booking.depositCents || booking.deposit_cents;
  if (depositCents) set("contact.deposit_amount_", (depositCents / 100).toFixed(2));

  const finalCents = booking.finalChargeCents || booking.final_charge_cents;
  if (finalCents) set("contact.final_cost_", (finalCents / 100).toFixed(2));

  set("contact.deposit_type", booking.paymentOption || booking.payment_option);
  set("contact.deposit_paid", booking.status === "confirmed" ? "Yes" : (booking.depositPaid || undefined));
  set("contact.stripe_customer_id", booking.customerId || booking.customer_id);
  set("contact.stripe_subscription_id", booking.subscriptionId || booking.subscription_id);
  set("contact.referral_code", booking.referralCode || booking.referral_code);
  set("contact.novara_glow_plan", booking.membershipPlan || booking.membership_plan);
  set("contact.lead_source", booking.source || "Website");
  set("contact.customer_source", booking.source || "Website");
  set("contact.utm_source", booking.utmSource || booking.utm_source);
  set("contact.utm_medium", booking.utmMedium || booking.utm_medium);
  set("contact.utm_campaign", booking.utmCampaign || booking.utm_campaign);
  set("contact.last_invoice_url", booking.hostedInvoiceUrl || booking.hosted_invoice_url);

  const nextDate = booking.serviceDate || booking.service_date;
  const nextTime = booking.timeSlot || booking.time_slot;
  if (nextDate && nextTime) {
    set("contact.next_service_date__time", `${nextDate} ${nextTime}`);
  }
  if (nextDate) {
    set("contact.service_time__date", `${nextDate} ${nextTime || ""}`);
  }

  return fields;
}

interface SyncRequest {
  event: string;
  contactData: {
    firstName?: string;
    lastName?: string;
    email?: string;
    phone?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  bookingData?: Record<string, any>;
  workflowId?: string;
  notes?: string;
  monetaryValue?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (!GHL_TOKEN) {
      throw new Error("GHL_API_KEY is not configured");
    }

    const {
      event,
      contactData,
      bookingData = {},
      workflowId,
      notes,
      monetaryValue,
    }: SyncRequest = await req.json();

    logStep("Processing sync", { event, email: contactData.email, phone: contactData.phone });

    // 1. Find or create the contact
    const tagConfig = EVENT_TO_TAGS[event] || { add: [], remove: [] };
    const { contactId, isNew } = await findOrCreateContact({
      ...contactData,
      tags: isNew ? tagConfig.add : [],
    });

    logStep(isNew ? "Contact created" : "Contact found", { contactId });

    // 2. Update contact with booking data + custom fields
    const customFields = buildCustomFields({ ...bookingData, ...contactData });

    const updatePayload: Record<string, any> = {
      firstName: contactData.firstName || undefined,
      lastName: contactData.lastName || undefined,
      address1: contactData.address || bookingData?.address || undefined,
      city: contactData.city || bookingData?.city || undefined,
      state: contactData.state || bookingData?.state || undefined,
      postalCode: contactData.zipCode || bookingData?.zipCode || bookingData?.zip_code || undefined,
      customFields,
    };

    await ghlFetch(`/contacts/${contactId}`, {
      method: "PUT",
      body: JSON.stringify(updatePayload),
    });

    logStep("Contact updated", { fields: customFields.length });

    // 3. Manage tags
    if (tagConfig.add.length > 0) {
      await ghlFetch(`/contacts/${contactId}/tags`, {
        method: "POST",
        body: JSON.stringify({ tags: tagConfig.add }),
      });
      logStep("Tags added", { tags: tagConfig.add });
    }

    if (tagConfig.remove.length > 0) {
      await ghlFetch(`/contacts/${contactId}/tags`, {
        method: "DELETE",
        body: JSON.stringify({ tags: tagConfig.remove }),
      });
      logStep("Tags removed", { tags: tagConfig.remove });
    }

    // 4. Move through pipeline
    const targetStage = EVENT_TO_STAGE[event];
    if (targetStage && STAGES[targetStage]) {
      const stageId = STAGES[targetStage];

      const { data: existingOpps } = await ghlFetch(
        `/opportunities/search?location_id=${GHL_LOCATION_ID}&pipeline_id=${PIPELINE_ID}&contact_id=${contactId}`
      );

      const existingOpp = existingOpps?.opportunities?.[0];

      if (existingOpp) {
        await ghlFetch(`/opportunities/${existingOpp.id}`, {
          method: "PUT",
          body: JSON.stringify({
            pipelineStageId: stageId,
            status: targetStage === "canceled_lost" ? "lost" : "open",
            monetaryValue: monetaryValue || existingOpp.monetaryValue || undefined,
          }),
        });
        logStep("Opportunity updated", { oppId: existingOpp.id, stage: targetStage });
      } else {
        const value = monetaryValue || (bookingData?.total_estimate_cents ? bookingData.total_estimate_cents / 100 : 0);
        const { data: newOpp } = await ghlFetch("/opportunities/", {
          method: "POST",
          body: JSON.stringify({
            pipelineId: PIPELINE_ID,
            locationId: GHL_LOCATION_ID,
            name: `${contactData.firstName || ""} ${contactData.lastName || ""} - Booking`.trim(),
            pipelineStageId: stageId,
            contactId,
            status: "open",
            monetaryValue: Math.round(value),
          }),
        });
        logStep("Opportunity created", { oppId: newOpp?.opportunity?.id, stage: targetStage });
      }
    }

    // 5. Add notes if provided
    if (notes) {
      await ghlFetch(`/contacts/${contactId}/notes`, {
        method: "POST",
        body: JSON.stringify({ body: notes }),
      });
      logStep("Note added");
    }

    // 6. Trigger workflow if specified
    if (workflowId) {
      const { status } = await ghlFetch(`/contacts/${contactId}/workflow/${workflowId}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      logStep("Workflow triggered", { workflowId, status });
    }

    // 7. Store GHL contact ID back in Supabase for future lookups
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    if (contactData.email) {
      await supabase
        .from("customers")
        .update({ analytics_source: `ghl:${contactId}` })
        .eq("email", contactData.email);
    }

    logStep("Sync complete", { event, contactId, isNew });

    return new Response(
      JSON.stringify({ success: true, contactId, isNew, event }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    logStep("ERROR", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
