import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QuoteEmailRequest {
  email: string;
  firstName: string;
  serviceName: string;
  homeSizeLabel: string;
  frequency: string;
  bedrooms?: number;
  bathrooms?: number;
  basePriceCents: number;
  serviceTierCost: number;
  addOnsCents: number;
  discountPct: number;
  discountCents: number;
  finalPriceCents: number;
  depositCents: number;
  balanceDueCents: number;
  monthlyTotalCents: number;
  isNewCustomer: boolean;
  addOns: string[];
}

function formatCurrency(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function buildQuoteHtml(data: QuoteEmailRequest): string {
  const addOnsHtml = data.addOns.length > 0
    ? data.addOns.map(a => `<li style="color:#6B7280;font-size:14px;">${a}</li>`).join("")
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#F9FAFB;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F9FAFB;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;">
  <tr><td style="background:linear-gradient(135deg,#16A34A,#0E7C3A);padding:32px;text-align:center;">
    <h1 style="color:#ffffff;margin:0;font-size:24px;">Your Cleaning Quote</h1>
    <p style="color:#ffffff;margin:8px 0 0;font-size:14px;opacity:0.9;">NovaraCleaning</p>
  </td></tr>
  <tr><td style="padding:32px;">
    <p style="color:#374151;font-size:16px;margin:0 0 24px;">Hi ${data.firstName || "there"},</p>
    <p style="color:#6B7280;font-size:14px;margin:0 0 24px;">Here's your personalized cleaning quote:</p>
    
    <table width="100%" cellpadding="8" cellspacing="0" style="background-color:#F9FAFB;border-radius:8px;margin-bottom:24px;">
      <tr><td style="color:#6B7280;font-size:13px;border-bottom:1px solid #E5E7EB;">Service</td>
          <td style="color:#374151;font-size:13px;text-align:right;border-bottom:1px solid #E5E7EB;">${data.serviceName}</td></tr>
      <tr><td style="color:#6B7280;font-size:13px;border-bottom:1px solid #E5E7EB;">Home Size</td>
          <td style="color:#374151;font-size:13px;text-align:right;border-bottom:1px solid #E5E7EB;">${data.homeSizeLabel}</td></tr>
      ${data.bedrooms ? `<tr><td style="color:#6B7280;font-size:13px;border-bottom:1px solid #E5E7EB;">Bedrooms</td><td style="color:#374151;font-size:13px;text-align:right;border-bottom:1px solid #E5E7EB;">${data.bedrooms}</td></tr>` : ""}
      ${data.bathrooms ? `<tr><td style="color:#6B7280;font-size:13px;border-bottom:1px solid #E5E7EB;">Bathrooms</td><td style="color:#374151;font-size:13px;text-align:right;border-bottom:1px solid #E5E7EB;">${data.bathrooms}</td></tr>` : ""}
      <tr><td style="color:#6B7280;font-size:13px;border-bottom:1px solid #E5E7EB;">Frequency</td>
          <td style="color:#374151;font-size:13px;text-align:right;border-bottom:1px solid #E5E7EB;">${data.frequency}</td></tr>
      <tr><td style="color:#6B7280;font-size:13px;border-bottom:1px solid #E5E7EB;">Base Price</td>
          <td style="color:#374151;font-size:13px;text-align:right;border-bottom:1px solid #E5E7EB;">${formatCurrency(data.basePriceCents)}</td></tr>
      ${data.serviceTierCost > 0 ? `<tr><td style="color:#6B7280;font-size:13px;border-bottom:1px solid #E5E7EB;">Service Upgrade</td><td style="color:#374151;font-size:13px;text-align:right;border-bottom:1px solid #E5E7EB;">+${formatCurrency(data.serviceTierCost)}</td></tr>` : ""}
      ${data.discountPct > 0 ? `<tr><td style="color:#16A34A;font-size:13px;border-bottom:1px solid #E5E7EB;">${data.frequency} Discount (${data.discountPct}%)</td><td style="color:#16A34A;font-size:13px;text-align:right;border-bottom:1px solid #E5E7EB;">-${formatCurrency(data.discountCents)}</td></tr>` : ""}
      ${data.isNewCustomer ? `<tr><td style="color:#16A34A;font-size:13px;border-bottom:1px solid #E5E7EB;">New Customer Discount</td><td style="color:#16A34A;font-size:13px;text-align:right;border-bottom:1px solid #E5E7EB;">-$60.00</td></tr>` : ""}
    </table>

    <table width="100%" cellpadding="12" cellspacing="0" style="background:linear-gradient(135deg,#16A34A11,#0E7C3A11);border:1px solid #16A34A33;border-radius:8px;margin-bottom:24px;">
      <tr><td style="color:#16A34A;font-size:18px;font-weight:bold;">Per Clean</td>
          <td style="color:#16A34A;font-size:18px;font-weight:bold;text-align:right;">${formatCurrency(data.finalPriceCents)}</td></tr>
      <tr><td style="color:#374151;font-size:14px;">💰 Deposit Today</td>
          <td style="color:#374151;font-size:14px;text-align:right;">${formatCurrency(data.depositCents)}</td></tr>
      <tr><td style="color:#6B7280;font-size:14px;">Balance After Service</td>
          <td style="color:#6B7280;font-size:14px;text-align:right;">${formatCurrency(data.balanceDueCents)}</td></tr>
      ${data.frequency !== "One-Time" ? `<tr><td style="color:#6B7280;font-size:14px;">📅 Monthly Total</td><td style="color:#6B7280;font-size:14px;text-align:right;">${formatCurrency(data.monthlyTotalCents)}</td></tr>` : ""}
    </table>

    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td align="center" style="padding:16px 0;">
        <a href="https://try.novaracleaning.com/book/zip" style="background:linear-gradient(135deg,#16A34A,#0E7C3A);color:#ffffff;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:8px;display:inline-block;font-size:16px;">Book Now →</a>
      </td></tr>
    </table>

    <p style="color:#6B7280;font-size:12px;text-align:center;margin:24px 0 0;">Questions? Call us at (844) 735-2070</p>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const data: QuoteEmailRequest = await req.json();
    console.log("[SEND-SALES-QUOTE-EMAIL] Sending quote to", data.email);

    if (!data.email) {
      throw new Error("Email is required");
    }

    const html = buildQuoteHtml(data);

    const emailResponse = await resend.emails.send({
      from: "Novara Cleaning <hello@novaracleaning.com>",
      to: [data.email],
      subject: `Your NovaraCleaning Quote - ${formatCurrency(data.finalPriceCents)}/clean ✨`,
      html,
    });

    console.log("[SEND-SALES-QUOTE-EMAIL] Sent successfully", emailResponse);

    return new Response(JSON.stringify({ success: true, messageId: emailResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("[SEND-SALES-QUOTE-EMAIL] ERROR", error.message);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  }
});
