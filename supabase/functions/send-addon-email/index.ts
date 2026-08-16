// send-addon-email
//
// Customer email when an admin adds add-on services to a booking (including
// after completion). Types:
//   addon_charged  - card on file was charged for the add-ons (receipt)
//   addon_saved    - add-ons saved on the booking (no immediate card charge)
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
  /** Why the add-on was billed (shown to customer). */
  chargeReason?: string;
  /** On-site cleaner report / notes for the extra work. */
  cleanerReport?: string;
  cleanerName?: string;
  chargeDate?: string;
  paymentRef?: string;
  serviceAddress?: string;
  /** When set, prepends an internal review banner (draft for approver). */
  reviewFor?: string;
  // ─── scope_adjustment ───────────────────────────────────────────────
  /** Price before the scope adjustment, e.g. "$190.00". */
  originalAmount?: string;
  /** Customer-facing name of the reclassified service, e.g. "Deep Clean". */
  serviceLabel?: string;
  /** The justification message the admin approved (same text sent by SMS). */
  justification?: string;
  /** How many condition photos back the adjustment up. */
  photoCount?: number;
  // ─── site_finding (pest light / mold minor) ─────────────────────────
  subject?: string;
  bodyText?: string;
  finding?: string;
  location?: string;
  recurrenceNote?: string;
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
  if (type === "addon_saved") {
    return {
      subject: `Add-on services added to your cleaning${d.amount ? ` - ${d.amount}` : ""}`,
      html: renderHtml({
        heading: "Add-on services added",
        bodyHtml: `<p>${hi}</p><p>We've added the following service(s) to your cleaning: <strong>${list}</strong>.</p><p>Your booking total has been updated${d.amount ? ` by <strong>${d.amount}</strong>` : ""}. No action is needed right now — we'll collect any balance with your cleaning payment.</p>`,
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
  if (type === "addon_receipt") {
    const reviewBanner = d.reviewFor
      ? `<div style="background:#FEF3C7;border:1px solid #F59E0B;border-radius:8px;padding:16px;margin-bottom:20px;font-size:14px;color:#92400E;"><strong>Internal review draft</strong> — this email has <em>not</em> been sent to the customer yet. Intended recipient: <strong>${d.reviewFor}</strong>.</div>`
      : "";
    const reasonBlock = d.chargeReason
      ? `<div style="background:#ffffff;border:2px solid ${BRAND.primary};border-radius:8px;padding:20px 22px;margin:20px 0 16px;"><p style="margin:0 0 12px;font-size:17px;font-weight:700;color:${BRAND.primary};">Why you were charged</p><p style="margin:0;font-size:16px;line-height:1.65;color:${BRAND.gray700};">${d.chargeReason}</p></div>`
      : "";
    const reportBlock = d.cleanerReport
      ? `<div style="background:${BRAND.gray50};border-left:4px solid ${BRAND.primary};padding:16px 20px;border-radius:0 8px 8px 0;margin:16px 0 20px;"><p style="margin:0 0 8px;font-size:15px;font-weight:600;color:${BRAND.gray900};">What our cleaner found on site${d.cleanerName ? ` (${d.cleanerName})` : ""}</p><p style="margin:0;white-space:pre-wrap;font-size:15px;line-height:1.6;color:${BRAND.gray700};">${d.cleanerReport}</p></div>`
      : "";
    const detailRows = [
      { label: "Booking", value: d.bookingRef || "" },
      { label: "Service date", value: d.serviceDate || "" },
      { label: "Service address", value: d.serviceAddress || "" },
      { label: "Additional service", value: list },
      { label: "Amount charged", value: d.amount || "" },
      { label: "Charge date", value: d.chargeDate || "" },
      { label: "Payment reference", value: d.paymentRef || "" },
    ];
    const subjectPrefix = d.reviewFor ? "[REVIEW] " : "";
    const intro = d.serviceDate
      ? `During your cleaning on <strong>${d.serviceDate}</strong>, our crew completed extra work in your bathroom that goes beyond what is included in a standard cleaning.`
      : "During your recent cleaning, our crew completed extra work in your bathroom that goes beyond what is included in a standard cleaning.";
    return {
      subject: `${subjectPrefix}Why you were charged for ${list}${d.amount ? ` (${d.amount})` : ""}`,
      html: renderHtml({
        heading: "Additional charge explanation",
        bodyHtml: `${reviewBanner}<p>${hi}</p><p>${intro}</p><p style="margin-top:16px;">We're writing to explain <strong>why this additional charge was applied</strong> and what work was performed. A copy of the charge details is included below for your records.</p>${reasonBlock}${reportBlock}<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:${BRAND.gray900};">Charge summary</p><p style="margin:0 0 4px;font-size:15px;color:${BRAND.gray700};">The <strong>${list}</strong> add-on (${d.amount || "see below"}) was charged to the card on file after this extra work was completed.</p>`,
        rows: detailRows,
      }),
    };
  }
  if (type === "scope_adjustment") {
    // The job performed differed materially from the one booked. Lead with
    // the justification the admin approved, then show the price movement and
    // note that the condition photos are on file.
    const justification = d.justification
      ? `<div style="background:#ffffff;border:2px solid ${BRAND.primary};border-radius:8px;padding:20px 22px;margin:20px 0 16px;"><p style="margin:0 0 12px;font-size:17px;font-weight:700;color:${BRAND.primary};">Why the rate changed</p><p style="margin:0;font-size:16px;line-height:1.65;color:${BRAND.gray700};">${d.justification}</p></div>`
      : "";
    const photos = d.photoCount
      ? `<p style="margin:16px 0 0;font-size:15px;color:${BRAND.gray700};">${d.photoCount} before/after photo${d.photoCount === 1 ? "" : "s"} documenting the condition ${d.photoCount === 1 ? "is" : "are"} on file with this job. We're happy to share them on request.</p>`
      : "";
    return {
      subject: `Update on your cleaning${d.amount ? ` - adjusted to ${d.amount}` : ""}`,
      html: renderHtml({
        heading: "An update on your clean",
        bodyHtml:
          `<p>${hi}</p>` +
          `<p>Thank you for having us out. The work this job needed went beyond what the booked service covers, so we're writing to explain the adjustment clearly and put the details on record.</p>` +
          `${justification}` +
          `<p style="margin:0 0 8px;font-size:15px;font-weight:600;color:${BRAND.gray900};">Adjustment summary</p>` +
          `${photos}`,
        rows: [
          { label: "Booking", value: d.bookingRef || "" },
          { label: "Service date", value: d.serviceDate || "" },
          { label: "Service address", value: d.serviceAddress || "" },
          { label: "Classified as", value: d.serviceLabel || "" },
          { label: "Original price", value: d.originalAmount || "" },
          { label: "Adjusted price", value: d.amount || "" },
        ],
      }),
    };
  }
  if (type === "site_finding_priced" || type === "site_finding_info") {
    const priced = type === "site_finding_priced";
    const body = String(d.bodyText || "").trim();
    const paragraphs = (body || `${hi} During today's visit our team handled a documented finding.`)
      .split(/\n+/)
      .map((p) => `<p>${p}</p>`)
      .join("");
    return {
      subject: d.subject || "A quick update on today's clean",
      html: renderHtml({
        heading: "A quick update on today's clean",
        bodyHtml: paragraphs,
        rows: [
          { label: "Booking", value: d.bookingRef || "" },
          { label: "Service date", value: d.serviceDate || "" },
          { label: "Service address", value: d.serviceAddress || "" },
          { label: "Finding", value: d.finding || "" },
          { label: "Location", value: d.location || "" },
          { label: "Pricing", value: d.serviceLabel || "" },
          { label: "Original total", value: priced ? (d.originalAmount || "") : "" },
          { label: "Today's total", value: priced ? (d.amount || "") : "Unchanged" },
          { label: "Photos on file", value: d.photoCount ? String(d.photoCount) : "Yes" },
        ],
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

  let body: { type?: string; email?: string; data?: AddonEmailData; skipBillingCc?: boolean; cc?: string[] };
  try { body = await req.json(); } catch { return json({ ok: true }); }
  const type = String(body?.type || "");
  const email = String(body?.email || "").trim().toLowerCase();
  if (!type || !email || !email.includes("@")) return json({ ok: true });

  const built = build(type, body.data || {});
  if (!built) return json({ ok: true });

  const resendKey = await resolveSecret(admin, "RESEND_API_KEY");
  if (!resendKey) { console.error("[send-addon-email] RESEND_API_KEY missing"); return json({ ok: true }); }
  const resend = new Resend(resendKey);

  const isReview = Boolean(body.data?.reviewFor);
  const extraCc = (body.cc || []).map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes("@"));
  const cc = isReview ? [] : (extraCc.length > 0 ? extraCc : (body.skipBillingCc ? [] : [BILLING_CC]));

  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS, to: [email], cc, subject: built.subject, html: built.html, replyTo: BRAND.supportEmail,
    });
    if ((result as { error?: unknown })?.error) console.error("[send-addon-email] resend error", type, (result as { error?: unknown }).error);
    else console.log("[send-addon-email] sent", type, email);
  } catch (e) {
    console.error("[send-addon-email] exception", type, String((e as Error).message));
  }
  return json({ ok: true });
});
