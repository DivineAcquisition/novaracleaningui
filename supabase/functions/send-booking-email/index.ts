import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";
import React from 'https://esm.sh/react@18.3.1';
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22';
import { PaymentReceipt } from '../_shared/email-templates/PaymentReceipt.tsx';
import { BookingModification } from '../_shared/email-templates/BookingModification.tsx';
import { generateICalFile } from '../_shared/calendar-utils.ts';

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

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
  type: 'confirmation' | 'payment_receipt' | 'modification';
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
      // Try Migma template first, fall back to React Email
      const migmaHtml = await fetchMigmaTemplate(MIGMA_TEMPLATES.booking_confirmation);
      
      if (migmaHtml) {
        html = populateMigmaTemplate(migmaHtml, data);
        logStep("Using Migma template for confirmation email");
      } else {
        // Fallback to React Email
        const { BookingConfirmation } = await import('../_shared/email-templates/BookingConfirmation.tsx');
        html = await renderAsync(React.createElement(BookingConfirmation, data));
        logStep("Using React Email fallback for confirmation email");
      }

      const formattedDate = data.serviceDate
        ? new Date(data.serviceDate).toLocaleDateString('en-US', {
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
          
          const serviceDate = new Date(data.serviceDate);
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
            description: `${serviceTypeLabels[data.serviceType || 'standard'] || 'Cleaning'} for ${data.homeSize || 'your home'}.\n\nBooking ID: ${data.bookingId}\nContact: Novara Cleaning\nPhone: (555) 123-4567`,
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
    } else {
      throw new Error(`Unknown email type: ${type}`);
    }

    const emailResponse = await resend.emails.send({
      from: "Novara Cleaning <hello@novaracleaning.com>",
      to: [email],
      subject,
      html,
      attachments: attachments.length > 0 ? attachments : undefined,
    });

    logStep("Email sent successfully", { messageId: emailResponse });

    return new Response(JSON.stringify({ success: true, messageId: emailResponse }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error: any) {
    logStep("ERROR sending email", { message: error.message });
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
});
