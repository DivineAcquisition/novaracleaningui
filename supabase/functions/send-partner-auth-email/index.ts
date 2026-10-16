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
import { buildEmailCard } from "../_shared/email-compliance.ts";
import { sendThroughCompliance } from "../_shared/email-compliance-send.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

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
        heading: "Sign in to Novara",
        bodyHtml: `<p style="margin:0;font-size:16px;line-height:1.5;color:#b4b4bc;">Use the button below to sign in. This link expires shortly and works once.</p>`,
        ctaLabel: "Sign in",
        expiryNote: "This link expires in 1 hour and can only be used once.",
        textVersion: `${greeting}\n\nSign in to the Novara Host Portal:\n${link}\n\nThis link expires in 1 hour and can only be used once.`,
      };
  }
}

function renderHtml(cfg: EmailConfig, link: string): string {
  const body = cfg.bodyHtml.includes("Use the button below")
    ? cfg.bodyHtml
    : `${cfg.bodyHtml}<p style="margin:16px 0 0;font-size:15px;line-height:1.5;color:#b4b4bc;">${cfg.expiryNote}</p>`;
  return buildEmailCard({
    preheader: cfg.preheader,
    title: cfg.heading,
    bodyHtml: body,
    buttonHref: link,
    buttonLabel: cfg.ctaLabel,
  });
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

  const cfg = configFor(kind, linkResult.link, linkResult.firstName);
  try {
    const result = await sendThroughCompliance(resendKey, {
      to: email,
      subject: cfg.subject,
      html: renderHtml(cfg, linkResult.link),
      text: cfg.textVersion,
      templateKey: "auth_email",
      declaredType: "customer_service",
    });
    if ((result as { error?: unknown })?.error) console.error("[send-partner-auth-email] resend error", kind, (result as { error?: unknown }).error);
    else console.log("[send-partner-auth-email] sent", kind, email);
  } catch (e) {
    console.error("[send-partner-auth-email] exception", kind, String((e as Error).message));
  }
  return json({ ok: true });
});
