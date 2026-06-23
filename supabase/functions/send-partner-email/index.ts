// --- send-partner-email --------------------------------------------------
//
// Branded transactional emails for the Airbnb/STR Host Portal
// (partner.novaracleaning.com). Mirrors the existing Resend-based senders.
// Callable server-to-server by the partner-turnover edge function
// (verify_jwt is false). Never throws fatally - email is best-effort.
//
// Types:
//   welcome            - host account created
//   turnover_confirmed - payment received, turnover booked (receipt)
//   turnover_assigned  - a cleaner has been assigned
//   turnover_cancelled - turnover cancelled

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
  primaryDark: "#3D00B8",
  light: "#918CFF",
  lavender: "#EDE9FE",
  gradient: "linear-gradient(135deg, #5500FF 0%, #3D00B8 100%)",
  gray50: "#F9FAFB",
  gray200: "#E5E7EB",
  gray600: "#6B7280",
  gray700: "#374151",
  gray900: "#111827",
  logo: "https://app.novaracleaning.com/novara-email-logo.png",
  supportEmail: "support@novaracleaning.com",
  supportPhone: "+1 (844) 735-2070",
  portalUrl: "https://partner.novaracleaning.com/partner",
};
const FROM_ADDRESS = "Novara Cleaning <hello@novaracleaning.com>";

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

interface Row { label: string; value: string; }

function renderHtml(opts: {
  preheader: string; heading: string; bodyHtml: string;
  rows?: Row[]; ctaLabel?: string; ctaUrl?: string;
}): string {
  const rowsHtml = (opts.rows || []).filter((r) => r.value)
    .map((r) => `<tr><td style="padding:8px 0;font-size:14px;color:${BRAND.gray600};">${r.label}</td><td style="padding:8px 0;font-size:14px;color:${BRAND.gray900};font-weight:600;text-align:right;">${r.value}</td></tr>`)
    .join("");
  const detailsBlock = rowsHtml
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:8px 0 4px;border-top:1px solid ${BRAND.gray200};border-bottom:1px solid ${BRAND.gray200};">${rowsHtml}</table>`
    : "";
  const ctaBlock = opts.ctaLabel && opts.ctaUrl
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;"><tr><td align="center" style="background:${BRAND.gradient};border-radius:8px;"><a href="${opts.ctaUrl}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${opts.ctaLabel}</a></td></tr></table>`
    : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${opts.heading}</title></head><body style="margin:0;padding:0;background:${BRAND.gray50};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${BRAND.gray900};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${opts.preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.gray50};padding:20px 0;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-bottom:none;border-radius:8px 8px 0 0;padding:20px 20px 12px;text-align:center;">
<img src="${BRAND.logo}" alt="${BRAND.name}" width="200" height="27" style="display:block;margin:0 auto 8px;" />
<div style="font-size:13px;font-weight:700;letter-spacing:.04em;color:${BRAND.primary};text-transform:uppercase;">HOST PORTAL</div>
</td></tr>
<tr><td style="background:${BRAND.gradient};color:#ffffff;padding:26px 30px;text-align:center;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};">
<h1 style="margin:0;font-size:26px;font-weight:bold;color:#ffffff;">${opts.heading}</h1>
</td></tr>
<tr><td style="background:#ffffff;padding:30px;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};font-size:16px;line-height:1.6;color:${BRAND.gray700};">
${opts.bodyHtml}
${detailsBlock}
${ctaBlock}
</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-top:none;border-radius:0 0 8px 8px;padding:20px;text-align:center;font-size:13px;color:${BRAND.gray600};">
<div style="margin:8px 0;">Questions? Email <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.supportEmail}</a> or call ${BRAND.supportPhone}.</div>
<div style="margin:8px 0;">&copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

interface PartnerEmailData {
  name?: string; property?: string; address?: string; date?: string;
  window?: string; price?: string; cleaner?: string;
}

function build(type: string, d: PartnerEmailData): { subject: string; html: string } | null {
  const hi = d.name ? `Hi ${d.name},` : "Hi there,";
  const rows: Row[] = [
    { label: "Property", value: d.property || "" },
    { label: "Address", value: d.address || "" },
    { label: "Date", value: d.date || "" },
    { label: "Window", value: d.window || "" },
    { label: "Price", value: d.price || "" },
  ];
  switch (type) {
    case "welcome":
      return {
        subject: "Welcome to the Novara Host Portal",
        html: renderHtml({
          preheader: "Your host account is ready - add a property to get started.",
          heading: "You're all set!",
          bodyHtml: `<p>${hi}</p><p>Welcome to the Novara Host Portal. Here's how it works:</p><ul style="padding-left:18px;margin:12px 0;"><li>Add your rental properties (address + access details).</li><li>Our team sets your per-turnover rate.</li><li>Request a turnover, pay, and we assign a vetted cleaner - guest-ready by your next check-in.</li></ul><p>You'll get a confirmation and assignment update by email and text for every turnover.</p>`,
          ctaLabel: "Open my portal", ctaUrl: BRAND.portalUrl,
        }),
      };
    case "turnover_confirmed":
      return {
        subject: `Turnover confirmed - ${d.property || "your property"} on ${d.date || ""}`.trim(),
        html: renderHtml({
          preheader: "Payment received - we're matching you with a cleaner.",
          heading: "Turnover confirmed",
          bodyHtml: `<p>${hi}</p><p>Thanks - your payment was received and your turnover is booked. We're assigning your cleaning crew now and will email you the moment it's confirmed.</p>`,
          rows,
          ctaLabel: "View my turnovers", ctaUrl: "https://partner.novaracleaning.com/partner/dashboard",
        }),
      };
    case "turnover_assigned":
      return {
        subject: `Your cleaner is assigned - ${d.property || "your property"}`.trim(),
        html: renderHtml({
          preheader: "A cleaner is confirmed for your turnover.",
          heading: "Your cleaner is assigned",
          bodyHtml: `<p>${hi}</p><p>Good news - <strong>${d.cleaner || "your cleaner"}</strong> is assigned to your turnover. We'll have the property guest-ready by the end of your window.</p>`,
          rows: [...rows, { label: "Cleaner", value: d.cleaner || "" }],
          ctaLabel: "View my turnovers", ctaUrl: "https://partner.novaracleaning.com/partner/dashboard",
        }),
      };
    case "turnover_cancelled":
      return {
        subject: `Turnover cancelled - ${d.property || "your property"}`.trim(),
        html: renderHtml({
          preheader: "Your turnover has been cancelled.",
          heading: "Turnover cancelled",
          bodyHtml: `<p>${hi}</p><p>Your turnover has been cancelled. If this was a mistake or you'd like to rebook, you can request a new turnover anytime from your dashboard.</p>`,
          rows,
          ctaLabel: "Request a turnover", ctaUrl: "https://partner.novaracleaning.com/partner/dashboard",
        }),
      };
    default:
      return null;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: true });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let body: { type?: string; email?: string; data?: PartnerEmailData };
  try { body = await req.json(); } catch { return json({ ok: true }); }
  const type = String(body?.type || "");
  const email = String(body?.email || "").trim().toLowerCase();
  if (!type || !email || !email.includes("@")) return json({ ok: true });

  const built = build(type, body.data || {});
  if (!built) return json({ ok: true });

  const resendKey = await resolveSecret(admin, "RESEND_API_KEY");
  if (!resendKey) {
    console.error("[send-partner-email] RESEND_API_KEY missing - cannot send");
    return json({ ok: true });
  }
  const resend = new Resend(resendKey);

  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [email],
      subject: built.subject,
      html: built.html,
      replyTo: BRAND.supportEmail,
    });
    if ((result as { error?: unknown })?.error) {
      console.error("[send-partner-email] resend error", type, email, (result as { error?: unknown }).error);
    } else {
      console.log("[send-partner-email] sent", type, email);
    }
  } catch (e) {
    console.error("[send-partner-email] exception", type, email, String((e as Error).message));
  }
  return json({ ok: true });
});
