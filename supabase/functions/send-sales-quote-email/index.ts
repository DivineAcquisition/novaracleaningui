import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { sendThroughCompliance } from "../_shared/email-compliance-send.ts";

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

function quoteRow(label: string, value: string): string {
  return `<tr><td style="padding:8px 0;border-bottom:1px solid #3a3a40;">${label}</td><td style="padding:8px 0;border-bottom:1px solid #3a3a40;text-align:right;font-weight:600;">${value}</td></tr>`;
}

function buildQuoteHtml(data: QuoteEmailRequest): string {
  const addOns = data.addOns.length > 0
    ? `<p style="margin:16px 0 8px;font-weight:600;">Add-ons</p><ul style="margin:0;padding-left:20px;">${data.addOns.map((a) => `<li>${a}</li>`).join("")}</ul>`
    : "";
  return `<h1 style="margin:0 0 14px;font-family:Inter,Arial,sans-serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">Your cleaning quote</h1>
<p style="margin:0 0 16px;">Hi ${data.firstName || "there"},</p>
<p style="margin:0 0 16px;">Here is the quote for this home.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 16px;">
${quoteRow("Service", data.serviceName)}
${quoteRow("Home size", data.homeSizeLabel)}
${data.bedrooms ? quoteRow("Bedrooms", String(data.bedrooms)) : ""}
${data.bathrooms ? quoteRow("Bathrooms", String(data.bathrooms)) : ""}
${quoteRow("Frequency", data.frequency)}
${quoteRow("Base price", formatCurrency(data.basePriceCents))}
${data.serviceTierCost > 0 ? quoteRow("Service upgrade", `+${formatCurrency(data.serviceTierCost)}`) : ""}
${data.discountPct > 0 ? quoteRow(`${data.frequency} discount (${data.discountPct}%)`, `-${formatCurrency(data.discountCents)}`) : ""}
${data.isNewCustomer ? quoteRow("New customer discount", "-$60.00") : ""}
${quoteRow("Per clean", formatCurrency(data.finalPriceCents))}
${quoteRow("Deposit today", formatCurrency(data.depositCents))}
${quoteRow("Balance after service", formatCurrency(data.balanceDueCents))}
${data.frequency !== "One-Time" ? quoteRow("Monthly total", formatCurrency(data.monthlyTotalCents)) : ""}
</table>
${addOns}
<p style="margin:22px 0 0;"><a class="novara-btn" href="https://try.novaracleaning.com/book/zip" style="display:inline-block;padding:14px 28px;background:#e7e7ea;color:#18181b;text-decoration:none;border-radius:12px;font-weight:600;">Book now</a></p>`;
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

    const emailResponse = await sendThroughCompliance(Deno.env.get("RESEND_API_KEY") || "", {
      to: data.email,
      subject: `Your NovaraCleaning Quote - ${formatCurrency(data.finalPriceCents)}/clean`,
      html,
      templateKey: "quote_customer",
      declaredType: "customer_service",
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
