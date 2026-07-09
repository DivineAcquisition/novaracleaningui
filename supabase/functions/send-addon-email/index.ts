// send-addon-email
//
// Customer email when an admin adds add-on services to a booking (including
// after completion). Two types:
//   addon_charged  - card on file was charged for the add-ons (receipt)
//   addon_invoiced - no card on file: includes a hosted invoice pay link
//
// Branded, inline HTML (no React templates). Best-effort; never throws fatally.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BRAND = {
  name: "Novara Cleaning",
  primary: "#5500FF",
  gradient: "linear-gradient(135deg, #5500FF 0%, #3D00B8 100%)",
  gray50: "#F9FAFB",
  gray200: "#E5E7EB",
  gray600: "#6B7280",
  gray700: "#374151",
  gray900: "#111827",
  logo: "https://app.novaracleaning.com/novara-logo.png",
  supportEmail: "support@novaracleaning.com",
  supportPhone: "+1 (844) 735-2070",
};
const FROM_ADDRESS = "Novara Cleaning <hello@novaracleaning.com>";
// Finance mailbox is CC'd on every add-on charge / invoice email so
// billing always has a copy of financial updates and purchases.
const BILLING_CC = "billing@novaracleaning.com";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

// deno-lint-ignore no-explicit-any
async function resolveSecret(supabase: any, key: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return (data?.value as string) || Deno.env.get(key) || "";
  } catch {
    return Deno.env.get(key) || "";
  }
}

interface AddonEmailData {
  name?: string;
  addOns?: string[];       // human labels
  amount?: string;         // e.g. "$70.00"
  serviceDate?: string;
  bookingRef?: string;
  hostedInvoiceUrl?: string;
}

function renderHtml(opts: { heading: string; bodyHtml: string; rows: Array<{ label: string; value: string }>; ctaLabel?: string; ctaUrl?: string }): string {
  const rowsHtml = opts.rows.filter((r) => r.value)
    .map((r) => `<tr><td style="padding:8px 0;font-size:14px;color:${BRAND.gray600};">${r.label}</td><td style="padding:8px 0;font-size:14px;color:${BRAND.gray900};font-weight:600;text-align:right;">${r.value}</td></tr>`)
    .join("");
  const cta = opts.ctaLabel && opts.ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;"><tr><td align="center" style="background:${BRAND.gradient};border-radius:8px;"><a href="${opts.ctaUrl}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${opts.ctaLabel}</a></td></tr></table>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${opts.heading}</title></head><body style="margin:0;padding:0;background:${BRAND.gray50};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${BRAND.gray900};">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.gray50};padding:20px 0;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-bottom:none;border-radius:8px 8px 0 0;padding:20px 20px 12px;text-align:center;">
<img src="${BRAND.logo}" alt="${BRAND.name}" width="140" height="48" style="display:block;margin:0 auto;" />
</td></tr>
<tr><td style="background:${BRAND.gradient};color:#ffffff;padding:26px 30px;text-align:center;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};">
<h1 style="margin:0;font-size:24px;font-weight:bold;color:#ffffff;">${opts.heading}</h1>
</td></tr>
<tr><td style="background:#ffffff;padding:30px;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};font-size:16px;line-height:1.6;color:${BRAND.gray700};">
${opts.bodyHtml}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 4px;border-top:1px solid ${BRAND.gray200};border-bottom:1px solid ${BRAND.gray200};">${rowsHtml}</table>
${cta}
</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-top:none;border-radius:0 0 8px 8px;padding:20px;text-align:center;font-size:13px;color:${BRAND.gray600};">
<div style="margin:8px 0;">Questions? Email <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.supportEmail}</a> or call ${BRAND.supportPhone}.</div>
<div style="margin:8px 0;">&copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

function build(type: string, d: AddonEmailData): { subject: string; html: string } | null {
  const hi = d.name ? `Hi ${d.name},` : "Hi there,";
  const list = (d.addOns || []).join(", ") || "additional services";
  const rows = [
    { label: "Booking", value: d.bookingRef || "" },
    { label: "Service date", value: d.serviceDate || "" },
    { label: "Add-ons", value: list },
    { label: "Amount", value: d.amount || "" },
  ];
  if (type === "addon_charged") {
    return {
      subject: `Add-on services added to your cleaning${d.amount ? ` - ${d.amount}` : ""}`,
      html: renderHtml({
        heading: "Add-on services confirmed",
        bodyHtml: `<p>${hi}</p><p>We've added the following service(s) to your cleaning and charged the card on file: <strong>${list}</strong>.</p>`,
        rows,
      }),
    };
  }
  if (type === "addon_invoiced") {
    return {
      subject: `Invoice for add-on services${d.amount ? ` - ${d.amount}` : ""}`,
      html: renderHtml({
        heading: "Add-on services - invoice",
        bodyHtml: `<p>${hi}</p><p>We've added the following service(s) to your cleaning: <strong>${list}</strong>. Please complete payment using the secure link below.</p>`,
        rows,
        ctaLabel: "Pay invoice",
        ctaUrl: d.hostedInvoiceUrl,
      }),
    };
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: true });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let body: { type?: string; email?: string; data?: AddonEmailData };
  try { body = await req.json(); } catch { return json({ ok: true }); }
  const type = String(body?.type || "");
  const email = String(body?.email || "").trim().toLowerCase();
  if (!type || !email || !email.includes("@")) return json({ ok: true });

  const built = build(type, body.data || {});
  if (!built) return json({ ok: true });

  const resendKey = await resolveSecret(admin, "RESEND_API_KEY");
  if (!resendKey) { console.error("[send-addon-email] RESEND_API_KEY missing"); return json({ ok: true }); }
  const resend = new Resend(resendKey);

  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS, to: [email], cc: [BILLING_CC], subject: built.subject, html: built.html, replyTo: BRAND.supportEmail,
    });
    if ((result as { error?: unknown })?.error) console.error("[send-addon-email] resend error", type, (result as { error?: unknown }).error);
    else console.log("[send-addon-email] sent", type, email);
  } catch (e) {
    console.error("[send-addon-email] exception", type, String((e as Error).message));
  }
  return json({ ok: true });
});
