// ─── send-auth-email ───────────────────────────────────────────────────
//
// Unified, brand-styled sender for every auth email Novara needs:
//
//   - signup_customer        : new customer portal signup confirmation
//   - signup_contractor      : new cleaner / contractor signup confirmation
//   - password_reset_customer: customer portal password reset link
//   - password_reset_cleaner : cleaner portal password reset link
//   - magic_link_customer    : customer magic-link sign-in
//   - magic_link_cleaner     : cleaner magic-link sign-in
//
// Why this exists: Supabase Auth's default mailer is rate-limited and
// flaky, and even when it works it sends a plain unbranded email. We
// bypass it entirely by using the admin API to generate the same
// link Supabase would send, then ship the link via Resend with our
// green-brand template. The user clicks the link, lands on our
// Supabase project as if Supabase had sent it, and the session works
// normally.
//
// IMPORTANT: This function is callable by anonymous users (verify_jwt
// is false) because the password-reset and signup flows must work
// pre-auth. We never reveal whether an email exists — every request
// returns ok:true so we don't leak the user table.

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
  primary: "#16A34A",
  primaryDark: "#0E7C3A",
  gradient: "linear-gradient(135deg, #16A34A 0%, #0E7C3A 100%)",
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

const SITE_HOSTS = {
  app: "https://app.novaracleaning.com",
  contractor: "https://contractor.novaracleaning.com",
};

type Kind =
  | "signup_customer"
  | "signup_contractor"
  | "password_reset_customer"
  | "password_reset_cleaner"
  | "magic_link_customer"
  | "magic_link_cleaner";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

async function resolveSecret(supabase: any, key: string): Promise<string> {
  try {
    const { data } = await supabase.from("app_secrets").select("value").eq("key", key).maybeSingle();
    return (data?.value as string) || Deno.env.get(key) || "";
  } catch {
    return Deno.env.get(key) || "";
  }
}

interface EmailConfig {
  subject: string;
  preheader: string;
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  expiryNote: string;
  textVersion: string;
}

function configFor(kind: Kind, link: string, firstName: string): EmailConfig {
  const greeting = firstName ? `Hi ${firstName},` : "Hi there,";
  switch (kind) {
    case "signup_customer":
      return {
        subject: "Confirm your Novara Cleaning account",
        preheader: "One quick step — confirm your email to finish setting up your account.",
        heading: "Welcome to Novara",
        bodyHtml: `<p>${greeting}</p><p>Thanks for joining Novara Cleaning. Click the button below to confirm your email and unlock your customer portal.</p>`,
        ctaLabel: "Confirm email",
        expiryNote: "This link expires in 24 hours.",
        textVersion: `${greeting}\n\nWelcome to Novara Cleaning! Please confirm your email by visiting:\n${link}\n\nThis link expires in 24 hours.`,
      };
    case "signup_contractor":
      return {
        subject: "Welcome to Novara — confirm your application",
        preheader: "Confirm your email to finish creating your cleaner account.",
        heading: "Welcome to the Novara team",
        bodyHtml: `<p>${greeting}</p><p>Thanks for applying to join Novara as a field cleaner. Confirm your email below and we'll pick up right where you left off in the onboarding flow.</p>`,
        ctaLabel: "Confirm email",
        expiryNote: "This link expires in 24 hours.",
        textVersion: `${greeting}\n\nWelcome to Novara Cleaning! Please confirm your email to continue onboarding:\n${link}\n\nThis link expires in 24 hours.`,
      };
    case "password_reset_customer":
    case "password_reset_cleaner":
      return {
        subject: "Reset your Novara Cleaning password",
        preheader: "Click the link inside to set a new password.",
        heading: "Reset your password",
        bodyHtml: `<p>${greeting}</p><p>We received a request to reset the password for your Novara account. Click the button below to choose a new one. If you didn't request this, you can safely ignore this email.</p>`,
        ctaLabel: "Set a new password",
        expiryNote: "This link expires in 1 hour.",
        textVersion: `${greeting}\n\nWe received a request to reset your Novara password. To set a new one, visit:\n${link}\n\nIf you didn't request this, ignore this email. The link expires in 1 hour.`,
      };
    case "magic_link_customer":
    case "magic_link_cleaner":
      return {
        subject: "Your Novara sign-in link",
        preheader: "Tap the link below to sign in — no password needed.",
        heading: "Sign in to Novara",
        bodyHtml: `<p>${greeting}</p><p>Tap the button below to sign in to your Novara account. No password required.</p>`,
        ctaLabel: "Sign in",
        expiryNote: "This link expires in 1 hour and can only be used once.",
        textVersion: `${greeting}\n\nUse this link to sign in to Novara:\n${link}\n\nThis link expires in 1 hour and can only be used once.`,
      };
  }
}

function renderHtml(cfg: EmailConfig, link: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${cfg.subject}</title><meta name="x-preheader" content="${cfg.preheader}"></head><body style="margin:0;padding:0;background:${BRAND.gray50};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${BRAND.gray900};">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">${cfg.preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${BRAND.gray50};padding:20px 0;">
<tr><td align="center">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;width:100%;">
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-bottom:none;border-radius:8px 8px 0 0;padding:20px 20px 12px;text-align:center;">
<img src="${BRAND.logo}" alt="${BRAND.name}" width="140" height="48" style="display:block;margin:0 auto 8px;" />
<div style="font-size:14px;font-weight:700;letter-spacing:.04em;color:${BRAND.primary};text-transform:uppercase;">NOVARACLEANING</div>
</td></tr>
<tr><td style="background:${BRAND.gradient};color:#ffffff;padding:26px 30px;text-align:center;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};">
<h1 style="margin:0;font-size:28px;font-weight:bold;color:#ffffff;">${cfg.heading}</h1>
</td></tr>
<tr><td style="background:#ffffff;padding:30px;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};font-size:16px;line-height:1.6;color:${BRAND.gray700};">
${cfg.bodyHtml}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px auto;"><tr><td align="center" style="background:${BRAND.gradient};border-radius:8px;"><a href="${link}" style="display:inline-block;padding:14px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">${cfg.ctaLabel}</a></td></tr></table>
<p style="font-size:13px;color:${BRAND.gray600};margin:16px 0 8px;text-align:center;">${cfg.expiryNote}</p>
<p style="font-size:13px;color:${BRAND.gray600};margin:16px 0 0;text-align:center;">If the button above doesn't work, paste this URL into your browser:</p>
<p style="font-size:12px;color:${BRAND.primary};word-break:break-all;margin:8px 0 0;text-align:center;"><a href="${link}" style="color:${BRAND.primary};text-decoration:underline;">${link}</a></p>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid ${BRAND.gray200};border-top:none;border-radius:0 0 8px 8px;padding:20px;text-align:center;font-size:13px;color:${BRAND.gray600};">
<div style="margin:8px 0;">Need help? Email <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.supportEmail}</a> or call ${BRAND.supportPhone}.</div>
<div style="margin:8px 0;">&copy; ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</div>
</td></tr>
</table>
</td></tr></table>
</body></html>`;
}

async function generateLink(
  adminClient: any,
  kind: Kind,
  email: string,
  password: string | undefined,
  metadata: Record<string, unknown>,
  redirectTo: string,
): Promise<{ link: string; firstName: string } | { error: string }> {
  let type: "signup" | "recovery" | "magiclink";
  if (kind === "signup_customer" || kind === "signup_contractor") type = "signup";
  else if (kind === "password_reset_customer" || kind === "password_reset_cleaner") type = "recovery";
  else type = "magiclink";

  try {
    let firstName = "";
    // For password reset / magic link the user may not exist yet — that's
    // fine, generateLink returns an error and we still respond 200 OK
    // (to prevent enumeration). For signup we always pass the password
    // + metadata so the user is created at the same time.
    const opts: any = { redirectTo };
    const payload: any = { type, email, options: opts };
    if (type === "signup") {
      if (password) payload.password = password;
      opts.data = metadata;
    }
    let { data, error } = await adminClient.auth.admin.generateLink(payload);
    // On signup, the auth user may already exist (common on retry, or an
    // unconfirmed account whose first email was missed). generateLink
    // type:'signup' errors for existing users, which previously meant NO
    // email was ever sent again. Fall back to a magic link so every attempt
    // delivers a working sign-in/confirm email.
    if (error && type === "signup" && /regist|exist|already/i.test(error.message)) {
      ({ data, error } = await adminClient.auth.admin.generateLink({
        type: "magiclink",
        email,
        options: { redirectTo },
      }));
    }
    if (error) return { error: error.message };
    const link = data?.properties?.action_link as string | undefined;
    if (!link) return { error: "no action_link in generateLink response" };
    firstName =
      (metadata?.first_name as string) ||
      (metadata?.firstName as string) ||
      (data?.user?.user_metadata?.first_name as string) ||
      "";
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

  let body: any;
  try { body = await req.json(); } catch { return json({ ok: true }); }
  const kind = body?.kind as Kind | undefined;
  const email = String(body?.email || "").trim().toLowerCase();
  const password = body?.password ? String(body.password) : undefined;
  const firstName = body?.firstName ? String(body.firstName) : undefined;
  const lastName = body?.lastName ? String(body.lastName) : undefined;
  const metadata: Record<string, unknown> = { ...(body?.metadata || {}) };
  if (firstName) metadata.first_name = firstName;
  if (lastName) metadata.last_name = lastName;

  const validKinds = new Set<Kind>([
    "signup_customer", "signup_contractor",
    "password_reset_customer", "password_reset_cleaner",
    "magic_link_customer", "magic_link_cleaner",
  ]);
  if (!kind || !validKinds.has(kind) || !email || !email.includes("@")) {
    console.warn("[send-auth-email] rejected", { kind, hasEmail: Boolean(email) });
    return json({ ok: true });
  }

  const isContractor = kind.endsWith("_contractor") || kind.endsWith("_cleaner");
  const host = isContractor ? SITE_HOSTS.contractor : SITE_HOSTS.app;
  const redirectTo = kind.startsWith("password_reset")
    ? `${host}/update-password`
    : kind.startsWith("magic_link")
    ? isContractor ? `${host}/cleaner/dashboard` : `${host}/account`
    : isContractor ? `${host}/cleaner/auth/callback` : `${host}/auth/callback`;

  if (isContractor) metadata.is_cleaner = true;

  const linkResult = await generateLink(adminClient, kind, email, password, metadata, redirectTo);
  if ("error" in linkResult) {
    console.warn("[send-auth-email] generateLink failed", kind, email, linkResult.error);
    return json({ ok: true });
  }

  const resendKey = await resolveSecret(adminClient, "RESEND_API_KEY");
  if (!resendKey) {
    console.error("[send-auth-email] RESEND_API_KEY missing — cannot send");
    return json({ ok: true });
  }
  const resend = new Resend(resendKey);

  const cfg = configFor(kind, linkResult.link, linkResult.firstName);
  const html = renderHtml(cfg, linkResult.link);

  try {
    const result = await resend.emails.send({
      from: FROM_ADDRESS,
      to: [email],
      subject: cfg.subject,
      html,
      text: cfg.textVersion,
      replyTo: BRAND.supportEmail,
    });
    if ((result as any)?.error) {
      console.error("[send-auth-email] resend error", kind, email, (result as any).error);
    } else {
      console.log("[send-auth-email] sent", kind, email, (result as any)?.data?.id);
    }
  } catch (e) {
    console.error("[send-auth-email] resend exception", kind, email, String((e as Error).message));
  }

  return json({ ok: true });
});
