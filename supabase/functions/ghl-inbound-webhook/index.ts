import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-ghl-signature',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const GHL_WEBHOOK_SECRET = Deno.env.get("GHL_WEBHOOK_SECRET") || "";

const logStep = (step: string, details?: any) => {
  console.log(`[GHL-INBOUND-WEBHOOK] ${step}`, details ? JSON.stringify(details) : '');
};

interface GHLContactPayload {
  // GHL Contact fields
  id?: string;
  contact_id?: string;
  contactId?: string;
  first_name?: string;
  firstName?: string;
  last_name?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address1?: string;
  city?: string;
  state?: string;
  postal_code?: string;
  postalCode?: string;
  country?: string;
  source?: string;
  tags?: string[];
  customFields?: Record<string, any>;
  custom_fields?: Record<string, any>;
  // GHL Event type
  type?: string;
  event?: string;
  // Booking specific
  service_type?: string;
  serviceType?: string;
  home_size?: string;
  homeSize?: string;
  service_date?: string;
  serviceDate?: string;
  time_slot?: string;
  timeSlot?: string;
  notes?: string;
}

interface GHLWebhookPayload {
  type?: string;
  event?: string;
  contact?: GHLContactPayload;
  data?: GHLContactPayload;
  // Direct fields (some webhooks send flat)
  first_name?: string;
  firstName?: string;
  last_name?: string;
  lastName?: string;
  email?: string;
  phone?: string;
}

// Map GHL service types to internal types
function mapServiceType(ghlType: string): string {
  const mapping: Record<string, string> = {
    'standard': 'standard',
    'standard cleaning': 'standard',
    'standard clean': 'standard',
    'deep': 'deep',
    'deep cleaning': 'deep',
    'deep clean': 'deep',
    'move': 'moveInOut',
    'move in': 'moveInOut',
    'move out': 'moveInOut',
    'move in/out': 'moveInOut',
    'move-in/out': 'moveInOut',
  };
  return mapping[ghlType?.toLowerCase()] || 'standard';
}

// Map GHL home size to internal home size ID
function mapHomeSize(ghlSize: string): string {
  const mapping: Record<string, string> = {
    'under 1000': '0_999',
    '0-999': '0_999',
    '< 1000': '0_999',
    '1000-1500': '1000_1500',
    '1000 - 1500': '1000_1500',
    '1501-2000': '1501_2000',
    '1501 - 2000': '1501_2000',
    '2001-2500': '2001_2500',
    '2001 - 2500': '2001_2500',
    '2501-3000': '2501_3000',
    '2501 - 3000': '2501_3000',
    '3001-3500': '3001_3500',
    '3001 - 3500': '3001_3500',
    '3501-4000': '3501_4000',
    '3501 - 4000': '3501_4000',
    '4001-4500': '4001_4500',
    '4001 - 4500': '4001_4500',
    '4501-5000': '4501_5000',
    '4501 - 5000': '4501_5000',
    '5000+': '5000_plus',
    'over 5000': '5000_plus',
    '> 5000': '5000_plus',
  };
  return mapping[ghlSize?.toLowerCase()] || '1501_2000'; // Default to medium size
}

// Map time slot from various formats
function mapTimeSlot(ghlSlot: string): string {
  const slot = ghlSlot?.toLowerCase() || '';
  if (slot.includes('morning') || slot.includes('8') || slot.includes('9') || slot.includes('10') || slot.includes('11')) {
    return '8-12';
  }
  if (slot.includes('afternoon') || slot.includes('12') || slot.includes('1') || slot.includes('2') || slot.includes('3')) {
    return '12-16';
  }
  if (slot.includes('evening') || slot.includes('4') || slot.includes('5') || slot.includes('6') || slot.includes('7')) {
    return '16-20';
  }
  return '8-12'; // Default to morning
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  try {
    // Parse the incoming GHL webhook
    const rawPayload: GHLWebhookPayload = await req.json();
    
    logStep("Received GHL webhook", { 
      type: rawPayload.type || rawPayload.event,
      hasContact: !!rawPayload.contact,
      hasData: !!rawPayload.data
    });

    // Normalize contact data from various GHL formats
    const contact = rawPayload.contact || rawPayload.data || rawPayload;
    
    const firstName = contact.first_name || contact.firstName || rawPayload.first_name || rawPayload.firstName || '';
    const lastName = contact.last_name || contact.lastName || rawPayload.last_name || rawPayload.lastName || '';
    const email = contact.email || rawPayload.email || '';
    const phone = contact.phone || rawPayload.phone || '';
    const address = contact.address1 || '';
    const city = contact.city || '';
    const state = contact.state || '';
    const zipCode = contact.postal_code || contact.postalCode || '';

    if (!email && !phone) {
      logStep("Invalid payload - missing email and phone");
      return new Response(
        JSON.stringify({ 
          success: false, 
          error: "Missing required contact information (email or phone)" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 }
      );
    }

    // Get custom fields if present
    const customFields = contact.customFields || contact.custom_fields || {};
    
    // Extract booking details from custom fields or direct fields
    const serviceType = mapServiceType(
      customFields.service_type || customFields.serviceType || 
      contact.service_type || contact.serviceType || 'standard'
    );
    const homeSizeId = mapHomeSize(
      customFields.home_size || customFields.homeSize || 
      contact.home_size || contact.homeSize || ''
    );
    const serviceDate = customFields.service_date || customFields.serviceDate || 
      contact.service_date || contact.serviceDate || '';
    const timeSlot = mapTimeSlot(
      customFields.time_slot || customFields.timeSlot || 
      contact.time_slot || contact.timeSlot || ''
    );
    const notes = contact.notes || customFields.notes || '';
    const source = contact.source || 'GHL Webhook';

    // Log incoming webhook to database for monitoring
    await supabase.from('webhook_logs').insert({
      webhook_type: 'ghl_inbound',
      event_type: rawPayload.type || rawPayload.event || 'contact',
      payload: rawPayload,
      processed_at: new Date().toISOString(),
      status: 'received'
    });

    // Determine if this is a booking request or just a lead
    const isBookingRequest = serviceDate && serviceDate.length > 0;
    const eventType = rawPayload.type || rawPayload.event || '';

    if (isBookingRequest) {
      logStep("Processing as booking request", { serviceDate, timeSlot, serviceType });
      
      // Check for existing customer
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id, stripe_customer_id')
        .eq('email', email)
        .maybeSingle();

      // Count existing bookings for booking number
      const { count: bookingCount } = await supabase
        .from('bookings')
        .select('id', { count: 'exact', head: true })
        .eq('email', email);

      const bookingNumber = (bookingCount || 0) + 1;

      // Create the booking
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .insert({
          email,
          first_name: firstName,
          last_name: lastName,
          phone,
          address,
          city,
          state,
          zip_code: zipCode,
          home_size_id: homeSizeId,
          service_type: serviceType,
          service_date: serviceDate,
          time_slot: timeSlot,
          status: 'pending_payment',
          booking_channel: 'GHL',
          booker_source: source,
          team_notes: notes ? `GHL Notes: ${notes}` : 'Booking from GHL webhook',
          booking_number: bookingNumber,
          customer_id: existingCustomer?.stripe_customer_id || null,
        })
        .select()
        .single();

      if (bookingError) {
        logStep("Error creating booking", { error: bookingError });
        throw bookingError;
      }

      logStep("Booking created successfully", { bookingId: booking.id });

      // Trigger Zapier webhook for the new booking
      try {
        await supabase.functions.invoke('send-zapier-webhook', {
          body: { bookingId: booking.id }
        });
        logStep("Zapier webhook triggered for new booking");
      } catch (webhookError) {
        logStep("Zapier webhook failed (non-critical)", { error: webhookError });
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          type: 'booking',
          bookingId: booking.id,
          bookingNumber: booking.booking_number,
          message: "Booking created successfully"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    } else {
      // Process as a lead capture
      logStep("Processing as lead capture", { email, source });

      // Create or update customer record
      const { data: customer, error: customerError } = await supabase
        .from('customers')
        .upsert({
          email,
          first_name: firstName,
          last_name: lastName,
          phone,
          address,
          city,
          state,
          zip_code: zipCode,
          source: source,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'email',
        })
        .select()
        .single();

      if (customerError) {
        logStep("Error creating/updating customer", { error: customerError });
        throw customerError;
      }

      logStep("Lead captured successfully", { customerId: customer.id });

      // Optionally trigger abandoned cart flow if they visited booking page
      if (eventType === 'form_submitted' || eventType === 'contact.created') {
        try {
          await supabase.functions.invoke('track-abandoned-cart', {
            body: {
              email,
              firstName,
              lastName,
              phone,
              zipCode,
              source: 'GHL'
            }
          });
        } catch (err) {
          logStep("Abandoned cart tracking failed (non-critical)", { error: err });
        }
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          type: 'lead',
          customerId: customer.id,
          message: "Lead captured successfully"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
      );
    }

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: errorMessage });

    // Log failure to database
    try {
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
      );
      await supabase.from('webhook_logs').insert({
        webhook_type: 'ghl_inbound',
        event_type: 'error',
        payload: { error: errorMessage },
        processed_at: new Date().toISOString(),
        status: 'failed'
      });
    } catch (_) {}

    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
