// send-cleaner-lifecycle-email
//
// Brand-aligned (emerald) cleaner lifecycle email sender. Three kinds:
//   * terminated     — access revoked, payout schedule, support contact
//   * activated      — welcome, dashboard link, training portal link
//   * late_warning   — 1–3 strikes language tied to late_arrival_count
//
// Body: {
//   cleanerId: string,                       (preferred)
//   email?: string, firstName?: string,      (fallback if cleanerId missing)
//   kind: 'terminated' | 'activated' | 'late_warning',
//   context?: { reason?, lateArrivalCount?, lastJobDate? }
// }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BRAND = {
  primary: "#16A34A",
  primaryDark: "#0E7C3A",
  gradient: "linear-gradient(135deg, #16A34A 0%, #0E7C3A 100%)",
  gray50: "#F9FAFB",
  gray200: "#E5E7EB",
  gray600: "#4B5563",
  gray700: "#374151",
  gray900: "#111827",
  rose50: "#FFF1F2",
  rose200: "#FECDD3",
  rose800: "#9F1239",
  amber50: "#FFFBEB",
  amber200: "#FDE68A",
  amber800: "#92400E",
  emerald50: "#ECFDF5",
  emerald200: "#A7F3D0",
  emerald800: "#065F46",
  name: "Novara Cleaning",
  supportEmail: "support@novaracleaning.com",
  supportPhone: "(844) 735-2070",
  contractorPortal: "https://contractor.novaracleaning.com/cleaner/dashboard",
  trainingPortal: "https://contractor.novaracleaning.com/cleaner/training",
  logo: "https://contractor.novaracleaning.com/novara-logo.png",
};

type Kind = "terminated" | "activated" | "late_warning";

interface EmailConfig {
  subject: string;
  preheader: string;
  heading: string;
  bodyHtml: string;
  cta: { label: string; url: string };
  accent: "emerald" | "amber" | "rose";
  tagline: string;
}

function buildConfig(kind: Kind, firstName: string, ctx: any): EmailConfig {
  const safeName = firstName ? firstName : "there";
  switch (kind) {
    case "activated":
      return {
        subject: `🌿 Welcome to the Novara team, ${safeName}!`,
        preheader: "You're activated — your portal is open + your first job offer is on the way.",
        heading: "You're activated!",
        accent: "emerald",
        tagline: "Status: Active · Ready for job offers",
        bodyHtml: `
          <p>Hi ${escape(safeName)},</p>
          <p>You're officially activated and your Novara contractor portal is now open. We'll start sending you nearby job offers right away — every one has a secure link with the full job details, pay, and accept / decline buttons.</p>
          <ul style="padding-left:18px;line-height:1.6;color:${BRAND.gray700};">
            <li><strong>Dashboard</strong> — jobs, earnings, and your schedule</li>
            <li><strong>Training portal</strong> — standards, SOPs, and the 40-point checklist</li>
            <li><strong>Payouts</strong> — Stripe Express is connected and ready</li>
          </ul>
          <p>If you ever need to step back, just toggle <em>Available for offers</em> off in your dashboard.</p>`,
        cta: { label: "Open my dashboard", url: BRAND.contractorPortal },
      };
    case "late_warning": {
      const count = Number(ctx?.lateArrivalCount || 1);
      const lastJob = ctx?.lastJobDate ? new Date(ctx.lastJobDate).toLocaleDateString() : null;
      const strikes = count >= 3 ? "final warning" : count === 2 ? "second warning" : "a friendly heads-up";
      return {
        subject: `⚠️ Late-arrival ${strikes} — Novara`,
        preheader: `On-time arrivals are non-negotiable for customer trust. This is ${strikes}.`,
        heading: "On-time matters",
        accent: "amber",
        tagline: `Late arrivals on record: ${count}`,
        bodyHtml: `
          <p>Hi ${escape(safeName)},</p>
          <p>We track on-time arrival because customers plan their day around the service window we promised them. Records show <strong>${count} late arrival${count === 1 ? "" : "s"}</strong>${lastJob ? `, most recently on <strong>${escape(lastJob)}</strong>` : ""}.</p>
          <p>This is <strong>${strikes}</strong>. Three or more late arrivals can trigger an automatic pause of your offers while we review.</p>
          <p>What helps:</p>
          <ul style="padding-left:18px;line-height:1.6;color:${BRAND.gray700};">
            <li>Tap <strong>En route</strong> in the app when you leave</li>
            <li>Pad +15 min for traffic in the DMV — you can mark "on time" any time within the arrival window</li>
            <li>If something derails the day, message dispatch <em>before</em> the window starts</li>
          </ul>
          <p>If you think any of these arrivals were logged in error, reply to this email and we'll investigate.</p>`,
        cta: { label: "Open my schedule", url: BRAND.contractorPortal },
      };
    }
    case "terminated":
      return {
        subject: "Novara contractor status update",
        preheader: "Your Novara contractor relationship has been closed.",
        heading: "Contractor relationship closed",
        accent: "rose",
        tagline: "Status: Terminated",
        bodyHtml: `
          <p>Hi ${escape(safeName)},</p>
          <p>We're writing to let you know your contractor relationship with Novara has been closed${ctx?.reason ? ` (<em>${escape(String(ctx.reason))}</em>)` : ""}. As of today:</p>
          <ul style="padding-left:18px;line-height:1.6;color:${BRAND.gray700};">
            <li>You will no longer receive job offers.</li>
            <li>Your contractor portal access is suspended.</li>
            <li>Any earned-but-unpaid payouts will run on the normal Stripe schedule — nothing for you to do.</li>
            <li>Pending W-9 / 1099 paperwork (if applicable) will still issue at year-end to the address on file.</li>
          </ul>
          <p>If you believe this was made in error, or you want a written summary, email <a href="mailto:${BRAND.supportEmail}">${BRAND.supportEmail}</a> within 14 days.</p>
          <p>We appreciate the work you put in.</p>`,
        cta: { label: "Contact support", url: `mailto:${BRAND.supportEmail}` },
      };
  }
}

function escape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function renderHtml(cfg: EmailConfig): string {
  const accentBg = { emerald: BRAND.emerald50, amber: BRAND.amber50, rose: BRAND.rose50 }[cfg.accent];
  const accentBorder = { emerald: BRAND.emerald200, amber: BRAND.amber200, rose: BRAND.rose200 }[cfg.accent];
  const accentText = { emerald: BRAND.emerald800, amber: BRAND.amber800, rose: BRAND.rose800 }[cfg.accent];
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(cfg.subject)}</title><meta name="x-preheader" content="${escape(cfg.preheader)}"></head><body style="margin:0;padding:0;background:${BRAND.gray50};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${BRAND.gray900};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${escape(cfg.preheader)}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.gray50};padding:20px 0;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-bottom:none;border-radius:8px 8px 0 0;padding:20px 20px 12px;text-align:center;">
<img src="${BRAND.logo}" alt="${BRAND.name}" width="140" height="48" style="display:block;margin:0 auto 8px;" />
<div style="font-size:14px;font-weight:700;letter-spacing:.04em;color:${BRAND.primary};text-transform:uppercase;">NOVARA CLEANING</div>
</td></tr>
<tr><td style="background:${BRAND.gradient};color:#ffffff;padding:26px 30px;text-align:center;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};">
<h1 style="margin:0;font-size:24px;font-weight:bold;color:#ffffff;">${escape(cfg.heading)}</h1>
<p style="margin:6px 0 0;font-size:13px;color:rgba(255,255,255,0.85);">${escape(cfg.tagline)}</p>
</td></tr>
<tr><td style="background:#ffffff;padding:24px 30px;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};font-size:15px;line-height:1.6;color:${BRAND.gray700};">
${cfg.bodyHtml}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;"><tr><td align="center" style="background:${BRAND.gradient};border-radius:8px;"><a href="${escape(cfg.cta.url)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escape(cfg.cta.label)}</a></td></tr></table>
<div style="margin-top:24px;padding:12px 14px;border-radius:6px;background:${accentBg};border:1px solid ${accentBorder};font-size:13px;color:${accentText};">Questions? Email <a href="mailto:${BRAND.supportEmail}" style="color:${accentText};text-decoration:underline;">${BRAND.supportEmail}</a> or call ${BRAND.supportPhone}.</div>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-top:none;border-radius:0 0 8px 8px;padding:18px 20px;text-align:center;font-size:12px;color:${BRAND.gray600};">
&copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.
</td></tr></table>
</td></tr></table>
</body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const kind = body?.kind as Kind;
    if (!["terminated", "activated", "late_warning"].includes(kind)) {
      return new Response(JSON.stringify({ ok: false, reason: "bad_kind" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");

    let email = body.email as string | undefined;
    let firstName = body.firstName as string | undefined;
    if (body.cleanerId) {
      const { data: c } = await supabase.from("cleaners").select("email, first_name").eq("id", body.cleanerId).maybeSingle();
      if (c?.email) email = c.email;
      if (c?.first_name) firstName = c.first_name;
    }
    if (!email) {
      return new Response(JSON.stringify({ ok: false, reason: "missing_email" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400,
      });
    }

    const resendKey = (Deno.env.get("RESEND_API_KEY") || "").trim();
    if (!resendKey) {
      console.warn("[cleaner-lifecycle-email] RESEND_API_KEY missing — skipping send");
      return new Response(JSON.stringify({ ok: false, reason: "resend_unconfigured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }

    const cfg = buildConfig(kind, firstName || "", body.context || {});
    const html = renderHtml(cfg);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "Novara Cleaning <team@novaracleaning.com>",
        to: [email],
        subject: cfg.subject,
        html,
      }),
    });
    const text = await res.text();
    let parsed: any = null; try { parsed = JSON.parse(text); } catch { /* keep raw */ }
    if (!res.ok) {
      console.error("[cleaner-lifecycle-email] resend failed", res.status, text.slice(0, 300));
      return new Response(JSON.stringify({ ok: false, reason: "resend_error", status: res.status, detail: text.slice(0, 300) }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
      });
    }
    return new Response(JSON.stringify({ ok: true, kind, messageId: parsed?.id || null }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[cleaner-lifecycle-email] error", msg);
    return new Response(JSON.stringify({ ok: false, reason: "server_error", message: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200,
    });
  }
});
