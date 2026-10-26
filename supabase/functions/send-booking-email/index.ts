import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import React from 'https://esm.sh/react@18.3.1';
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22';
import { PaymentReceipt } from '../_shared/email-templates/PaymentReceipt.tsx';
import { BookingModification } from '../_shared/email-templates/BookingModification.tsx';
import { generateICalFile } from '../_shared/calendar-utils.ts';
import { deliverCompliantEmail } from '../_shared/email-compliance-send.ts';

const supabaseAdmin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-BOOKING-EMAIL] ${step}${detailsStr}`);
};

// Migma template conversation IDs
const MIGMA_TEMPLATES = {
  booking_confirmation: '698acaea41154eb80fab602e',
};

interface BookingEmailRequest {
  type: 'confirmation' | 'payment_receipt' | 'modification' | 'cancellation' | 'completion' | 'photo_gallery';
  email: string;
  data: {
    firstName?: string;
    lastName?: string;
    bookingId?: string;
    bookingNumber?: string;
    serviceDate?: string;
    timeSlot?: string;
    arrivalWindow?: string;
    serviceType?: string;
    homeSize?: string;
    homeSizeId?: string;
    bedrooms?: number;
    bathrooms?: number;
    sqft?: string;
    address?: string;
    city?: string;
    state?: string;
    zipCode?: string;
    totalAmount?: number;
    depositAmount?: number;
    balanceAmount?: number;
    paymentOption?: string;
    paymentMethod?: string;
    useCredit?: boolean;
    addOns?: string[];
    frequency?: string;
    newCustomerDiscount?: number;
    membershipDiscount?: number;
    fullPaymentDiscount?: number;
    priceDifference?: string;
    referralCode?: string;
    referralLink?: string;
    hostedInvoiceUrl?: string;
    paymentReceiptUrl?: string;
    membershipPlan?: string;
    rescheduleLink?: string;
    cancellationLink?: string;
    /**
     * Public link to the service-specific checklist
     * (https://try.novaracleaning.com/checklist/<slug>). Surfaced in
     * the confirmation email so customers can see the full list of
     * line items their cleaner will execute before the visit.
     */
    checklistLink?: string;
  };
  bookingData?: any;
}

async function fetchMigmaTemplate(conversationId: string): Promise<string | null> {
  const apiKey = Deno.env.get("MIGMA_API_KEY");
  if (!apiKey) {
    logStep("MIGMA_API_KEY not configured, falling back to React Email");
    return null;
  }

  try {
    const response = await fetch(`https://api.migma.ai/v1/export/html/${conversationId}`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      logStep("Migma API error", { status: response.status, statusText: response.statusText });
      return null;
    }

    const result = await response.json();
    // The API may return { html: "..." } or the HTML directly
    const html = typeof result === 'string' ? result : (result.html || result.data?.html || null);
    
    if (html) {
      logStep("Migma template fetched successfully", { length: html.length });
    }
    return html;
  } catch (err: any) {
    logStep("Error fetching Migma template", { error: err.message });
    return null;
  }
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatServiceDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}-${day}-${year}`;
}

function populateMigmaTemplate(html: string, data: BookingEmailRequest['data']): string {
  const serviceTypeLabels: Record<string, string> = {
    standard: 'Standard Cleaning',
    deep: 'Deep Cleaning',
    moveInOut: 'Move In/Out Cleaning',
  };

  const fullAddress = `${data.address || ''}, ${data.city || ''}, ${data.state || ''} ${data.zipCode || ''}`.trim();
  const serviceType = serviceTypeLabels[data.serviceType || 'standard'] || data.serviceType || 'Cleaning';

  // Build a map of GHL placeholders to actual values
  const replacements: Record<string, string> = {
    '{{contact.first_name}}': data.firstName || 'there',
    '{{opportunity.name}}': data.bookingNumber || data.bookingId?.substring(0, 8) || '',
    '{{appointment.start_date}}': data.serviceDate ? formatServiceDate(data.serviceDate) : '',
    '{{contact.service_start_time}}': data.arrivalWindow || data.timeSlot || '',
    '{{contact.address1}}': fullAddress,
    '{{contact.novara_glow_plan}}': data.membershipPlan || 'N/A',
    '{{contact.cleaning_type}}': serviceType,
    '{{contact.service_frequency}}': data.frequency || 'One-Time',
    '{{contact.bedrooms}}': String(data.bedrooms ?? 0),
    '{{contact.bathrooms}}': String(data.bathrooms ?? 0),
    '{{contact.estimated_sqft}}': data.sqft || data.homeSizeId || '',
    '{{contact.add_ons}}': data.addOns?.length ? data.addOns.join(', ') : 'None',
    '{{contact.final_cost_}}': data.totalAmount ? formatCurrency(data.totalAmount) : '$0.00',
    '{{contact.deposit_amount_}}': data.depositAmount ? formatCurrency(data.depositAmount) : '$0.00',
    '{{contact.remaining_balance}}': data.balanceAmount ? formatCurrency(data.balanceAmount) : '$0.00',
    '{{contact.last_invoice_url}}': data.hostedInvoiceUrl || '#',
    '{{contact.referral_link}}': data.referralLink || '#',
    '{{appointment.reschedule_link}}': data.rescheduleLink || '#',
    '{{appointment.cancellation_link}}': data.cancellationLink || '#',
    // Public service checklist (e.g. /checklist/standard-clean) so the
    // Migma template can render a "See what's included" CTA without
    // hard-coding service-type → URL logic in the HTML editor.
    '{{appointment.checklist_link}}': data.checklistLink || '#',
    '{{unsubscribe_link}}': '#',
  };

  let result = html;

  // Replace both raw and URL-encoded variants of each placeholder
  for (const [placeholder, value] of Object.entries(replacements)) {
    result = result.replaceAll(placeholder, value);
    // Handle URL-encoded version (e.g. %7B%7Bcontact.first_name%7D%7D)
    const encoded = encodeURIComponent(placeholder);
    result = result.replaceAll(encoded, value);
  }

  // Replace year in footer
  const currentYear = new Date().getFullYear();
  result = result.replaceAll('© 2026', `© ${currentYear}`);

  return result;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Function started");

    const { type, email, data, bookingData }: BookingEmailRequest = await req.json();
    logStep("Email request received", { type, email });

    if (!email) {
      throw new Error("Email address is required");
    }

    let html: string;
    let subject: string;
    let attachments: any[] = [];

    if (type === 'confirmation') {
      // The in-app card is the confirmation. The remote Migma layout is the
      // old template and does not carry this footer.
      const { BookingConfirmation } = await import('../_shared/email-templates/BookingConfirmation.tsx');
      html = await renderAsync(React.createElement(BookingConfirmation, data));
      logStep("Using the Novara card for confirmation email");

      // service_date is a calendar day ("2026-08-05"), not an instant. Parsing
      // it bare gives UTC midnight, which formats as the day BEFORE in every
      // timezone we operate in — so the subject line of the confirmation email
      // would name the wrong day.
      const serviceDayAt = (ymd: string) =>
        new Date(/^\d{4}-\d{2}-\d{2}$/.test(ymd) ? `${ymd}T12:00:00` : ymd);

      const formattedDate = data.serviceDate
        ? serviceDayAt(data.serviceDate).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : '';
      subject = `Booking Confirmed! Your Novara Cleaning on ${formattedDate} ✨`;

      // Generate calendar attachment
      if (data.serviceDate && data.timeSlot) {
        try {
          const timeSlotParts = data.timeSlot.split('-');
          const startHour = parseInt(timeSlotParts[0]);
          const endHour = parseInt(timeSlotParts[1]);
          
          const serviceDate = serviceDayAt(data.serviceDate);
          const startDate = new Date(serviceDate);
          startDate.setHours(startHour, 0, 0, 0);

          const endDate = new Date(serviceDate);
          endDate.setHours(endHour, 0, 0, 0);

          const serviceTypeLabels: Record<string, string> = {
            standard: 'Standard Cleaning',
            deep: 'Deep Cleaning',
            moveInOut: 'Move In/Out Cleaning',
          };

          const calendarEvent = {
            title: `Novara Cleaning - ${serviceTypeLabels[data.serviceType || 'standard'] || 'Cleaning Service'}`,
            description: `${serviceTypeLabels[data.serviceType || 'standard'] || 'Cleaning'} for ${data.homeSize || 'your home'}.\n\nBooking ID: ${data.bookingId}\nContact: Novara Cleaning\nPhone: +1 (833) 700-2611`,
            location: `${data.address}, ${data.city}, ${data.state} ${data.zipCode}`,
            startDate,
            endDate,
          };

          const icalContent = generateICalFile(calendarEvent);
          const base64Content = btoa(icalContent);
          
          attachments.push({
            filename: `novara-cleaning-${data.bookingId || 'booking'}.ics`,
            content: base64Content,
          });

          logStep("Calendar attachment generated", { bookingId: data.bookingId });
        } catch (calError: any) {
          logStep("Error generating calendar attachment", { error: calError?.message || String(calError) });
        }
      }
    } else if (type === 'payment_receipt') {
      html = await renderAsync(React.createElement(PaymentReceipt, data));
      subject = `Payment Received - Novara Cleaning Receipt`;
    } else if (type === 'modification') {
      html = await renderAsync(React.createElement(BookingModification, { bookingData }));
      subject = `Booking Updated - Your Changes Have Been Saved`;
    } else if (type === 'cancellation') {
      const { BookingCancellation } = await import('../_shared/email-templates/BookingCancellation.tsx');
      html = await renderAsync(React.createElement(BookingCancellation, { bookingData }));
      subject = `Booking Cancelled - Novara Cleaning`;
    } else if (type === 'completion') {
      const { BookingThankYou } = await import('../_shared/email-templates/BookingThankYou.tsx');
      html = await renderAsync(React.createElement(BookingThankYou, data));
      subject = `Thank You for Choosing Novara Cleaning! ✨`;
    } else if (type === 'photo_gallery') {
      const first = (data.firstName as string) || 'there';
      const galleryUrl = (data.galleryUrl as string) || 'https://try.novaracleaning.com';
      const beforeCount = Number(data.beforeCount || 0);
      const afterCount = Number(data.afterCount || 0);
      const countLine = (beforeCount || afterCount)
        ? `${beforeCount} before &amp; ${afterCount} after photo${(beforeCount + afterCount) === 1 ? '' : 's'}`
        : 'your before &amp; after photos';
      html = `
        <h1 style="margin:0 0 14px;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">Your clean is done, ${first}</h1>
        <p style="margin:0 0 16px;font-size:16px;line-height:1.5;color:#d4d4d8;">We've uploaded ${countLine} from your cleaning. Use the button to view the gallery. No login needed.</p>
        <p style="margin:0 0 16px;"><a class="novara-btn" href="${galleryUrl}" style="display:inline-block;background:#e7e7ea;color:#18181b;text-decoration:none;font-weight:600;font-size:16px;padding:14px 28px;border-radius:12px;">View before and after photos</a></p>
        <p style="margin:0;font-size:13px;line-height:1.5;color:#a1a1aa;">Questions? Call (844) 735-2070 or reply to this email.</p>`;
      subject = `Your before & after photos are ready 📸`;
    } else {
      throw new Error(`Unknown email type: ${type}`);
    }

    // Billing gets a copy of every financial email (purchases, receipts,
    // price-changing modifications, cancellations with potential fees).
    const FINANCIAL_TYPES = ['confirmation', 'payment_receipt', 'modification', 'cancellation'];
    const billingCc = FINANCIAL_TYPES.includes(type) ? ['billing@novaracleaning.com'] : undefined;
    const templateKey = type === 'confirmation'
      ? 'booking_confirmation'
      : type === 'payment_receipt'
        ? 'booking_payment_receipt'
        : type === 'modification'
          ? 'booking_modification'
          : type === 'cancellation'
            ? 'booking_cancellation'
            : type === 'completion'
              ? 'booking_completion'
              : 'booking_photo_gallery';

    const emailResponse = await deliverCompliantEmail(supabaseAdmin, {
      apiKey: Deno.env.get("RESEND_API_KEY") || "",
      to: email,
      subject,
      html,
      templateKey,
      declaredType: "customer_service",
      bookingId: data?.bookingId || bookingData?.bookingId || null,
      cc: billingCc,
      attachments: attachments.length > 0 ? attachments : undefined,
    });
    if (!emailResponse.ok) {
      throw new Error(emailResponse.error || "Email was not sent.");
    }

    logStep("Email sent successfully", { messageId: emailResponse.id, type: emailResponse.type });

    return new Response(JSON.stringify({ success: true, messageId: emailResponse.id, warnings: emailResponse.warnings }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    logStep("ERROR sending email", { message: error.message });

    // Queue failed email for retry
    try {
      const body = await req.clone().json().catch(() => null);
      if (body?.email && body?.type) {
        await supabaseAdmin
          .from('email_retry_queue')
          .insert({
            booking_id: body.data?.bookingId || body.bookingData?.bookingId || null,
            email_type: body.type,
            // Column on the table is `recipient_email`. Sending
            // `email_address` here used to silently fail (which
            // also broke the retry loop because no row landed) so
            // failed emails never got retried.
            recipient_email: body.email,
            email_data: body.data || body.bookingData || {},
            status: 'pending',
            retry_count: 0,
            next_retry_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          });
        logStep("Queued failed email for retry", { type: body.type, email: body.email });
      }
    } catch (queueError) {
      logStep("Failed to queue email for retry", { error: queueError });
    }

    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
