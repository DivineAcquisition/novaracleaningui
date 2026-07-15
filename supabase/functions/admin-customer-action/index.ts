// admin-customer-action
//
// Admin/VA customer directory controls:
//   update_customer — patch name, phone, address fields
//   delete_customer — admin-only, confirm full name; unlinks FKs then deletes row
//   stripe_billing_portal — return Stripe Billing Portal URL for this customer
//   send_billing_portal — create portal session + email (and SMS) the link to the customer

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { sendSms } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const PORTAL_RETURN_ORIGIN = "https://app.novaracleaning.com";
const FROM_ADDRESS = "Novara Cleaning <hello@novaracleaning.com>";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

async function ensureAdminOrVa(admin: ReturnType<typeof createClient>, jwt: string) {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  const callerId = u?.user?.id;
  if (!callerId) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", callerId);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
  return { callerId, isAdmin: (roles || []).some((r: { role: string }) => r.role === "admin") };
}

async function ensurePortalConfiguration(stripe: Stripe) {
  try {
    const list = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
    if (list.data.length > 0) return list.data[0].id;
    const config = await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: "NovaraCleaning — manage your card & bookings",
        privacy_policy_url: "https://novaracleaning.com/privacy",
        terms_of_service_url: "https://novaracleaning.com/terms",
      },
      features: {
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true },
        customer_update: {
          enabled: true,
          allowed_updates: ["email", "phone", "address", "name", "tax_id"],
        },
        subscription_cancel: { enabled: true, mode: "at_period_end" },
        subscription_pause: { enabled: false },
      },
      default_return_url: `${PORTAL_RETURN_ORIGIN}/account`,
    });
    return config.id;
  } catch {
    return null;
  }
}

async function resolveStripeCustomerId(
  // deno-lint-ignore no-explicit-any
  admin: any,
  stripe: Stripe,
  // deno-lint-ignore no-explicit-any
  customer: any,
  customerId: string,
  fullName: string,
): Promise<string> {
  let stripeCustomerId = (customer.stripe_customer_id as string | null)?.trim() || "";

  if (!stripeCustomerId?.startsWith("cus_")) {
    const listed = await stripe.customers.list({ email: customer.email, limit: 1 });
    if (listed.data.length > 0) {
      stripeCustomerId = listed.data[0].id;
      await admin
        .from("customers")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", customerId);
    } else {
      const created = await stripe.customers.create({
        email: customer.email,
        name: fullName,
        phone: customer.phone || undefined,
        metadata: { novara_customer_id: customerId, source: "admin-customer-action" },
      });
      stripeCustomerId = created.id;
      await admin
        .from("customers")
        .update({ stripe_customer_id: stripeCustomerId })
        .eq("id", customerId);
    }
  }

  return stripeCustomerId;
}

async function createBillingPortalSession(
  // deno-lint-ignore no-explicit-any
  admin: any,
  // deno-lint-ignore no-explicit-any
  customer: any,
  customerId: string,
  fullName: string,
): Promise<{ url: string; stripeCustomerId: string }> {
  const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
  if (!stripeKey) throw new Error("STRIPE_SECRET_KEY not configured");

  const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
  const stripeCustomerId = await resolveStripeCustomerId(
    admin,
    stripe,
    customer,
    customerId,
    fullName,
  );

  const configurationId = await ensurePortalConfiguration(stripe);
  const sessionParams: Stripe.BillingPortal.SessionCreateParams = {
    customer: stripeCustomerId,
    return_url: `${PORTAL_RETURN_ORIGIN}/account`,
  };
  if (configurationId) sessionParams.configuration = configurationId;

  const portalSession = await stripe.billingPortal.sessions.create(sessionParams);
  return { url: portalSession.url, stripeCustomerId };
}

function renderBillingPortalEmail(firstName: string, portalUrl: string) {
  const BRAND = {
    name: "NovaraCleaning",
    primary: "#16A34A",
    gradient: "linear-gradient(135deg, #16A34A 0%, #0E7C3A 100%)",
    gray700: "#374151",
    gray600: "#6B7280",
    gray200: "#E5E7EB",
    logoUrl: "https://app.novaracleaning.com/novara-email-logo.png",
    supportEmail: "support@novaracleaning.com",
    supportPhone: "+1 (844) 735-2070",
  };
  const safeName = escapeHtml(firstName || "there");
  return `<!doctype html><html><head><meta charset="utf-8"/><title>Update your payment method</title></head>` +
    `<body style="margin:0;padding:0;background:#F9FAFB;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:${BRAND.gray700};">` +
    `<div style="max-width:600px;margin:0 auto;padding:20px;">` +
    `<div style="background:#fff;padding:20px 20px 12px;text-align:center;border:1px solid ${BRAND.gray200};border-bottom:none;border-radius:8px 8px 0 0;">` +
    `<img src="${BRAND.logoUrl}" width="200" height="27" alt="${BRAND.name} logo" style="display:block;margin:0 auto 8px;"/>` +
    `<div style="font-size:14px;font-weight:700;letter-spacing:0.04em;color:${BRAND.primary};text-transform:uppercase;">${BRAND.name}</div>` +
    `</div>` +
    `<div style="background:${BRAND.gradient};color:#fff;padding:26px 30px;text-align:center;border-left:1px solid ${BRAND.gray200};border-right:1px solid ${BRAND.gray200};">` +
    `<div style="font-size:24px;font-weight:bold;">Update your payment method</div>` +
    `</div>` +
    `<div style="background:#fff;padding:30px;border:1px solid ${BRAND.gray200};border-top:none;">` +
    `<p style="font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${safeName},</p>` +
    `<p style="font-size:16px;line-height:1.6;margin:0 0 24px;">` +
    `Use the secure link below to update the card on file for your Novara Cleaning account. ` +
    `You can also view invoices and manage billing details from the same page.` +
    `</p>` +
    `<div style="text-align:center;margin:24px 0;">` +
    `<a href="${portalUrl}" style="display:inline-block;background:${BRAND.gradient};color:#fff;padding:16px 40px;text-decoration:none;border-radius:6px;font-weight:600;font-size:16px;">Update Payment Method</a>` +
    `</div>` +
    `<p style="font-size:14px;line-height:1.6;color:${BRAND.gray600};margin:24px 0 0;">` +
    `This link is personal to your account and expires after a short time. If it stops working, reply to this email and we'll send a fresh one.` +
    `</p>` +
    `</div>` +
    `<div style="background:#fff;text-align:center;padding:20px;border:1px solid ${BRAND.gray200};border-top:none;border-radius:0 0 8px 8px;font-size:14px;color:${BRAND.gray600};">` +
    `<div style="margin:8px 0;">© ${new Date().getFullYear()} ${BRAND.name}. All rights reserved.</div>` +
    `<div style="margin:12px 0;">Questions? <a href="mailto:${BRAND.supportEmail}" style="color:${BRAND.primary};text-decoration:none;">${BRAND.supportEmail}</a> or call ${BRAND.supportPhone}</div>` +
    `</div>` +
    `</div></body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const { callerId, isAdmin } = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();
    const customerId = String(body?.customerId || "").trim();
    if (!customerId) return json({ error: "customerId required" }, 400);

    const { data: customer, error: cErr } = await admin
      .from("customers")
      .select("*")
      .eq("id", customerId)
      .maybeSingle();
    if (cErr || !customer) return json({ error: "customer not found" }, 404);

    const fullName =
      `${customer.first_name || ""} ${customer.last_name || ""}`.trim() || customer.email;
    const firstName = String(customer.first_name || "").trim() || "there";

    switch (action) {
      case "update_customer": {
        const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
        if (body.firstName !== undefined) patch.first_name = String(body.firstName || "").trim();
        if (body.lastName !== undefined) patch.last_name = String(body.lastName || "").trim() || null;
        if (body.phone !== undefined) {
          const digits = String(body.phone || "").replace(/\D/g, "");
          patch.phone = digits || null;
        }
        if (body.email !== undefined) {
          const email = String(body.email || "").toLowerCase().trim();
          if (!email.includes("@")) return json({ error: "invalid email" }, 400);
          patch.email = email;
        }
        if (body.address !== undefined) patch.address = body.address || null;
        if (body.city !== undefined) patch.city = body.city || null;
        if (body.state !== undefined) patch.state = body.state || null;
        if (body.zip !== undefined) patch.zip = body.zip || null;

        const { data: updated, error: upErr } = await admin
          .from("customers")
          .update(patch)
          .eq("id", customerId)
          .select("id, first_name, last_name, email, phone, zip, city, state, address")
          .single();
        if (upErr) throw upErr;

        await admin.from("events").insert({
          event_type: "customer.updated",
          source: "admin-customer-action",
          summary: `Customer updated: ${fullName}`,
          data: { customer_id: customerId, by: callerId, fields: Object.keys(patch) },
        });

        return json({ success: true, customer: updated });
      }

      case "delete_customer": {
        if (!isAdmin) return json({ error: "Only admins can delete customers" }, 403);
        const confirm = String(body.confirmName || "").trim().toLowerCase();
        const expected = fullName.toLowerCase();
        if (!confirm || confirm !== expected) {
          return json({
            error: "Type the customer's full name in confirmName to confirm deletion",
            expectedName: fullName,
          }, 400);
        }

        const today = new Date().toISOString().slice(0, 10);
        const { count: futureCount } = await admin
          .from("bookings")
          .select("id", { count: "exact", head: true })
          .eq("email", customer.email)
          .gte("service_date", today)
          .not("status", "in", '("cancelled","completed")');

        if ((futureCount || 0) > 0 && !body.force) {
          return json({
            error: `Customer has ${futureCount} upcoming active booking(s). Pass force:true to delete anyway.`,
            futureBookings: futureCount,
          }, 400);
        }

        await admin.from("jobs").update({ customer_id: null }).eq("customer_id", customerId);

        const stripeKey = await resolveSecret(admin, "STRIPE_SECRET_KEY");
        if (stripeKey && customer.stripe_customer_id?.startsWith("cus_")) {
          try {
            const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });
            await stripe.customers.update(customer.stripe_customer_id, {
              metadata: { deleted_from_novara_admin: "true", deleted_at: new Date().toISOString() },
            });
          } catch (stripeErr) {
            console.warn("[admin-customer-action] stripe metadata update failed", stripeErr);
          }
        }

        const { error: delErr } = await admin.from("customers").delete().eq("id", customerId);
        if (delErr) throw delErr;

        await admin.from("events").insert({
          event_type: "customer.deleted",
          source: "admin-customer-action",
          summary: `Customer deleted from directory: ${fullName}`,
          data: { customer_id: customerId, email: customer.email, by: callerId },
        });

        return json({ success: true, deleted: true });
      }

      case "stripe_billing_portal": {
        const { url, stripeCustomerId } = await createBillingPortalSession(
          admin,
          customer,
          customerId,
          fullName,
        );
        return json({ success: true, url, stripeCustomerId });
      }

      case "send_billing_portal": {
        const { url, stripeCustomerId } = await createBillingPortalSession(
          admin,
          customer,
          customerId,
          fullName,
        );

        const email = String(customer.email || "").trim().toLowerCase();
        if (!email || !email.includes("@")) {
          return json({ error: "Customer has no valid email on file" }, 400);
        }

        const resendKey = await resolveSecret(admin, "RESEND_API_KEY");
        if (!resendKey) return json({ error: "RESEND_API_KEY not configured" }, 500);

        const resend = new Resend(resendKey);
        const html = renderBillingPortalEmail(firstName, url);
        const text =
          `Hi ${firstName},\n\n` +
          `Use this secure link to update the card on file for your Novara Cleaning account:\n${url}\n\n` +
          `You can also view invoices and manage billing details from the same page.\n\n` +
          `This link expires after a short time. Questions? support@novaracleaning.com`;

        const result = await resend.emails.send({
          from: FROM_ADDRESS,
          to: [email],
          subject: "Update your Novara Cleaning payment method",
          html,
          text,
          replyTo: "support@novaracleaning.com",
        });
        if ((result as { error?: unknown })?.error) {
          console.error("[admin-customer-action] resend error", (result as { error?: unknown }).error);
          return json({ error: "Failed to send billing portal email" }, 500);
        }

        let smsSent = false;
        if (customer.phone) {
          smsSent = await sendSms(admin, {
            toPhone: String(customer.phone),
            message:
              `NovaraCleaning: Update your payment method here: ${url} ` +
              `(secure link — expires soon). Questions? Reply or call (844) 735-2070`,
            type: "confirmation",
          });
        }

        await admin.from("events").insert({
          event_type: "customer.billing_portal_sent",
          source: "admin-customer-action",
          summary: `Billing portal link sent to ${fullName}`,
          data: {
            customer_id: customerId,
            email,
            sms_sent: smsSent,
            stripe_customer_id: stripeCustomerId,
            by: callerId,
          },
        });

        return json({
          success: true,
          emailed: true,
          smsSent,
          url,
          stripeCustomerId,
          emailedTo: email,
        });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-customer-action]", msg);
    return json({ error: msg }, 500);
  }
});
