// --- send-partner-auth-email -----------------------------------------------
//
// Branded auth emails for the Airbnb/STR Host Portal
// (partner.novaracleaning.com). Isolated from the shared send-auth-email so
// the customer/cleaner auth path is never touched. Same mechanism: generate
// the real Supabase action link via the admin API, then ship it via Resend
// in a purple Host-Portal template. Every host auth link lands on
// /partner/auth/callback, which resolves recovery vs. first-login.
//
// verify_jwt is false: signup + password-reset must work pre-auth. We never
// reveal whether an email exists (always returns ok:true).
//
// Kinds: signup | password_reset | magic_link

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
  gradient: "linear-gradient(135deg, #5500FF 0%, #3D00B8 100%)",
  gray50: "#F9FAFB",
  gray200: "#E5E7EB",
  gray600: "#6B7280",
  gray700: "#374151",
  gray900: "#111827",
  logo: "https://app.novaracleaning.com/novara-email-logo.png",
  supportEmail: "support@novaracleaning.com",
  supportPhone: "+1 (844) 735-2070",
};
const FROM_ADDRESS = "Novara Cleaning <hello@novaracleaning.com>";
const PARTNER_HOST = "https://partner.novaracleaning.com";
const CALLBACK = `${PARTNER_HOST}/partner/auth/callback`;

type Kind = "signup" | "password_reset" | "magic_link";

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

interface EmailConfig { subject: string; preheader: string; heading: string; bodyHtml: string; ctaLabel: string; expiryNote: string; textVersion: string; }

function configFor(kind: Kind, link: string, firstName: string): EmailConfig {
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  switch (kind) {
    case "signup":
      return {
        subject: "Confirm your Novara Host Portal account",
        preheader: "One quick step - confirm your email to start booking turnovers.",
        heading: "Welcome to the Host Portal",
        bodyHtml: `<p>${greeting}</p><p>Thanks for joining the Novara Host Portal - turnover cleanings for your short-term rentals, booked in seconds. Confirm your email below to add your properties and request your first turnover.</p>`,
        ctaLabel: "Confirm email",
        expiryNote: "This link expires in 24 hours.",
        textVersion: `${greeting}\n\nWelcome to the Novara Host Portal! Confirm your email to get started:\n${link}\n\nThis link expires in 24 hours.`,
      };
    case "password_reset":
      return {
        subject: "Reset your Novara Host Portal password",
        preheader: "Click the link inside to set a new password.",
        heading: "Reset your password",
        bodyHtml: `<p>${greeting}</p><p>We received a request to reset the password for your Novara Host Portal account. Click below to choose a new one. If you didn't request this, you can safely ignore this email.</p>`,
        ctaLabel: "Set a new password",
        expiryNote: "This link expires in 1 hour.",
        textVersion: `${greeting}\n\nReset your Novara Host Portal password:\n${link}\n\nIf you didn't request this, ignore this email. The link expires in 1 hour.`,
      };
    case "magic_link":
      return {
        subject: "Your Novara Host Portal sign-in link",
        preheader: "Tap the link below to sign in - no password needed.",
        heading: "Sign in to the Host Portal",
        bodyHtml: `<p>${greeting}</p><p>Tap the button below to sign in to your Novara Host Portal. No password required.</p>`,
        ctaLabel: "Sign in",
        expiryNote: "This link expires in 1 hour and can only be used once.",
        textVersion: `${greeting}\n\nSign in to the Novara Host Portal:\n${link}\n\nThis link expires in 1 hour and can only be used once.`,
      };
  }
}

function renderHtml(cfg: EmailConfig, link: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${cfg.subject}</title><meta name="x-preheader" content="${cfg.preheader}"></head><body style="margin:0;padding:0;background:${BRAND.gray50};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${BRAND.gray900};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${cfg.preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.gray50};padding:20px 0;"><tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-bottom:none;border-radius:8px 8px 0 0;padding:20px 20px 12px;text-align:center;">
<img src="${BRAND.logo}" alt="${BRAND.name}" width="200" height="27" style="display:block;margin:0 auto 8px;" />
<div style="font-size:13px;font-weight:700;letter-spacing:.04em;color:${BRAND.primary};text-transform:uppercase;">HOST PORTAL</div>
</td></tr>
<tr><td style="background:${BRAND.gradient};color:#ffffff;padding:26px 30px;text-align:center;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};">
<h1 style="margin:0;font-size:28px;font-weight:bold;color:#ffffff;">${cfg.heading}</h1>
</td></tr>
<tr><td style="background:#ffffff;padding:30px;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};font-size:16px;line-height:1.6;color:${BRAND.gray700};">
${cfg.bodyHtml}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;"><tr><td align="center" style="background:${BRAND.gradient};border-radius:8px;"><a href="${link}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${cfg.ctaLabel}</a></td></tr></table>
<p style="font-size:13px;color:${BRAND.gray600};margin:16px 0 8px;text-align:center;">${cfg.expiryNote}</p>
<p style="font-size:13px;color:${BRAND.gray600};margin:16px 0 0;text-align:center;">If the button doesn't work, paste this URL into your browser:</p>
<p style="font-size:12px;color:${BRAND.primary};word-break:break-all;margin:8px 0 0;text-align:center;"><a href="${link}" style="color:${BRAND.primary};text-decoration:underline;">${link}</a></p>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-top:none;border-radius:0 0 8px 8px;padding:20px;text-align:center;font-size:13px;color:${BRAND.gray600};">
<div style="margin:8px 0;">Need help? Email <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.supportEmail}</a> or call ${BRAND.supportPhone}.</div>
<div style="margin:8px 0;">&copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</div>
</td></tr>
</table></td></tr></table></body></html>`;
}

// deno-lint-ignore no-explicit-any
async function generateLink(adminClient: any, kind: Kind, email: string, password: string | undefined, metadata: Record<string, unknown>) {
  const type = kind === "signup" ? "signup" : kind === "password_reset" ? "recovery" : "magiclink";
  try {
    // deno-lint-ignore no-explicit-any
    const opts: any = { redirectTo: CALLBACK };
    // deno-lint-ignore no-explicit-any
    const payload: any = { type, email, options: opts };
    if (type === "signup") {
      if (password) payload.password = password;
      opts.data = metadata;
    }
    let { data, error } = await adminClient.auth.admin.generateLink(payload);
    // Existing/unconfirmed user on signup retry -> fall back to magic link so
    // a working sign-in email always goes out.
    if (error && type === "signup" && /regist|exist|already/i.test(error.message)) {
      ({ data, error } = await adminClient.auth.admin.generateLink({ type: "magiclink", email, options: { redirectTo: CALLBACK } }));
    }
    if (error) return { error: error.message };
    const link = data?.properties?.action_link as string | undefined;
    if (!link) return { error: "no action_link" };
    const firstName = (metadata?.first_name as string) || (data?.user?.user_metadata?.first_name as string) || "";
    return { link, firstName };
  } catch (e) {
    return { error: String((e as Error).message) };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: true });

  const adminClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  let body: { kind?: Kind; email?: string; password?: string; firstName?: string; metadata?: Record<string, unknown> };
  try { body = await req.json(); } catch { return json({ ok: true }); }
  const kind = body?.kind as Kind | undefined;
  const email = String(body?.email || "").trim().toLowerCase();
  const password = body?.password ? String(body.password) : undefined;
  const metadata: Record<string, unknown> = { ...(body?.metadata || {}), is_partner_host: true };
  if (body?.firstName) metadata.first_name = String(body.firstName);

  const valid = new Set<Kind>(["signup", "password_reset", "magic_link"]);
  if (!kind || !valid.has(kind) || !email || !email.includes("@")) return json({ ok: true });

  const linkResult = await generateLink(adminClient, kind, email, password, metadata);
  if ("error" in linkResult) {
    console.warn("[send-partner-auth-email] generateLink failed", kind, linkResult.error);
    return json({ ok: true });
  }

  const resendKey = await resolveSecret(adminClient, "RESEND_API_KEY");
  if (!resendKey) { console.error("[send-partner-auth-email] RESEND_API_KEY missing"); return json({ ok: true }); }
  const resend = new Resend(resendKey);

  const cfg = configFor(kind, linkResult.link, linkResult.firstName);
  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS, to: [email], subject: cfg.subject,
      html: renderHtml(cfg, linkResult.link), text: cfg.textVersion, replyTo: BRAND.supportEmail,
    });
    if ((result as { error?: unknown })?.error) console.error("[send-partner-auth-email] resend error", kind, (result as { error?: unknown }).error);
    else console.log("[send-partner-auth-email] sent", kind, email);
  } catch (e) {
    console.error("[send-partner-auth-email] exception", kind, String((e as Error).message));
  }
  return json({ ok: true });
});
