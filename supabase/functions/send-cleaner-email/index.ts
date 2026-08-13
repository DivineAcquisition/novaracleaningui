import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { renderAsync } from "https://esm.sh/@react-email/components@0.0.22";
import * as React from "https://esm.sh/react@18.3.1";
import { CleanerInvitation } from "../_shared/email-templates/CleanerInvitation.tsx";
import { CleanerAssignment } from "../_shared/email-templates/CleanerAssignment.tsx";
import { BookingCompletion } from "../_shared/email-templates/BookingCompletion.tsx";
import { PayoutConfirmation } from "../_shared/email-templates/PayoutConfirmation.tsx";
import { CleanerCredentials } from "../_shared/email-templates/CleanerCredentials.tsx";
import { CleanerTierPromotion } from "../_shared/email-templates/CleanerTierPromotion.tsx";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: any) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : '';
  console.log(`[SEND-CLEANER-EMAIL] ${step}${detailsStr}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { type, email, data, cc, to } = await req.json();
    logStep("Sending cleaner email", { type, email, cc, extraTo: to });

    const resend = new Resend(Deno.env.get("RESEND_API_KEY"));

    let subject = "";
    let html = "";

    switch (type) {
      case "invitation":
        subject = "Welcome to Novara Cleaning Team!";
        html = await renderAsync(
          React.createElement(CleanerInvitation, {
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            onboardingUrl: data.onboardingUrl,
          })
        );
        break;

      case "assignment":
        subject = "New Booking Assignment";
        html = await renderAsync(
          React.createElement(CleanerAssignment, {
            cleanerFirstName: data.cleanerFirstName,
            bookingId: data.bookingId,
            customerName: data.customerName,
            serviceDate: data.serviceDate,
            timeSlot: data.timeSlot,
            serviceType: data.serviceType,
            address: data.address,
            city: data.city,
            state: data.state,
            zipCode: data.zipCode,
            estimatedEarnings: data.estimatedEarnings,
            dashboardUrl: data.dashboardUrl,
          })
        );
        break;

      case "completion":
        subject = "Booking Completed - Payout Initiated";
        html = await renderAsync(
          React.createElement(BookingCompletion, {
            cleanerFirstName: data.cleanerFirstName,
            bookingId: data.bookingId,
            serviceDate: data.serviceDate,
            customerName: data.customerName,
            earnings: data.earnings,
            payoutStatus: data.payoutStatus,
          })
        );
        break;

      case "payout":
        subject = `Payout sent — $${((Number(data.amount) || 0) / 100).toFixed(2)} via Stripe Connect`;
        html = await renderAsync(
          React.createElement(PayoutConfirmation, {
            cleanerFirstName: data.cleanerFirstName,
            bookingId: data.bookingId || "",
            amount: data.amount,
            transferId: data.transferId,
            transferDate: data.transferDate,
            bookingLabel: data.bookingLabel,
            cleanerFullName: data.cleanerFullName,
            sourceLabel: data.sourceLabel,
          })
        );
        break;

      case "payout_pending": {
        const amountStr = `$${((Number(data.amount) || 0) / 100).toFixed(2)}`;
        const pctStr = data.pctPaid != null ? `${data.pctPaid}%` : null;
        subject = `Payout pending — ${amountStr}`;
        html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
            <h2 style="margin:0 0 8px;font-size:20px">Your payout is pending 💸</h2>
            <p style="margin:0 0 16px;color:#475569">Hi ${data.cleanerFirstName || "there"}, nice work on ${data.bookingLabel || "your recent job"}${data.serviceDate ? ` (${data.serviceDate})` : ""}.</p>
            <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:18px;text-align:center;margin:0 0 16px">
              <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#047857">Payout pending</div>
              <div style="font-size:32px;font-weight:800;color:#065f46;margin-top:4px">${amountStr}</div>
              ${pctStr ? `<div style="font-size:12px;color:#047857;margin-top:4px">${pctStr} of job revenue</div>` : ""}
            </div>
            <p style="margin:0 0 8px;color:#475569;font-size:14px">We've queued this payout and it's on its way to your account. You'll get a confirmation once it's sent.</p>
            <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Novara Cleaning</p>
          </div>`;
        break;
      }

      case "credentials":
        subject = "Your Novara Cleaning Account - Login Credentials";
        html = await renderAsync(
          React.createElement(CleanerCredentials, {
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            password: data.password,
            loginUrl: data.loginUrl,
          })
        );
        break;

      case "tier_promotion": {
        const newTier = String(data.newTier || "proven");
        const newPct = Number(data.newPercentage) || 40;
        subject = `You've been promoted to ${newTier.charAt(0).toUpperCase()}${newTier.slice(1)} — ${newPct}% revenue share`;
        html = await renderAsync(
          React.createElement(CleanerTierPromotion, {
            firstName: data.firstName || data.cleanerFirstName || "",
            previousTier: data.previousTier || "foundation",
            newTier,
            previousPercentage: Number(data.previousPercentage) || 35,
            newPercentage: newPct,
            dashboardUrl: data.dashboardUrl,
          })
        );
        break;
      }

      case "agreement_request": {
        const first = data.firstName || "there";
        const agreementUrl = data.agreementUrl || "https://contractor.novaracleaning.com/cleaner/onboarding";
        const loginUrl = data.loginUrl || "https://contractor.novaracleaning.com/cleaner/auth";
        subject = "Please sign your Novara Cleaning contractor agreement";
        html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
            <h2 style="margin:0 0 8px;font-size:20px">Your contractor agreement is ready</h2>
            <p style="margin:0 0 16px;color:#475569">Hi ${first},</p>
            <p style="margin:0 0 16px;color:#475569">
              Please sign your Independent Contractor Agreement so we can finish activating your Novara Cleaning account.
              It only takes a couple of minutes.
            </p>
            <p style="margin:24px 0;text-align:center">
              <a href="${agreementUrl}"
                 style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">
                Sign your agreement
              </a>
            </p>
            <p style="margin:0 0 8px;color:#64748b;font-size:14px">
              If you're asked to log in first, use
              <a href="${loginUrl}" style="color:#7c3aed">${loginUrl.replace(/^https?:\/\//, "")}</a>
              with the email on your invite.
            </p>
            <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Novara Cleaning</p>
          </div>`;
        break;
      }

      case "setup_request": {
        const first = data.firstName || "there";
        const setupUrl = data.setupUrl || "https://contractor.novaracleaning.com/cleaner/auth";
        const needs: string[] = [];
        if (data.needsPhone !== false) needs.push("verify your phone");
        if (data.needsStripe !== false) needs.push("connect payouts (Stripe)");
        const needsLine = needs.length ? needs.join(" and ") : "finish a couple of quick steps";
        subject = "Finish your Novara Cleaning account setup";
        html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
            <h2 style="margin:0 0 8px;font-size:20px">Finish your account setup</h2>
            <p style="margin:0 0 16px;color:#475569">Hi ${first},</p>
            <p style="margin:0 0 16px;color:#475569">
              You're almost ready for jobs — please ${needsLine} so we can keep sending you work and pay you on time.
            </p>
            <p style="margin:24px 0;text-align:center">
              <a href="${setupUrl}"
                 style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">
                Complete account setup
              </a>
            </p>
            <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Novara Cleaning</p>
          </div>`;
        break;
      }

      case "supply_checklist_request": {
        const first = data.firstName || "there";
        const supplyUrl = data.supplyUrl || "https://contractor.novaracleaning.com/cleaner/role";
        subject = "Mark which cleaning supplies you have";
        html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
            <h2 style="margin:0 0 8px;font-size:20px">Your supply checklist</h2>
            <p style="margin:0 0 16px;color:#475569">Hi ${first},</p>
            <p style="margin:0 0 16px;color:#475569">
              Please open the checklist and mark which essential supplies you already have.
              You don't need every item on day one — we use this so we know you're job-ready.
            </p>
            <p style="margin:24px 0;text-align:center">
              <a href="${supplyUrl}"
                 style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">
                Open supply checklist
              </a>
            </p>
            <p style="margin:0 0 8px;color:#64748b;font-size:14px">No login required — the link opens straight onto the checklist.</p>
            <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Novara Cleaning</p>
          </div>`;
        break;
      }

      case "tip_received": {
        const first = data.cleanerFirstName || data.firstName || "there";
        const amountStr = `$${((Number(data.amount) || 0) / 100).toFixed(2)}`;
        const totalStr = `$${((Number(data.totalTipCents) || Number(data.amount) || 0) / 100).toFixed(2)}`;
        const crewSize = Number(data.crewSize) || 1;
        const bookingLabel = data.bookingLabel || "your recent job";
        const customerName = data.customerName || "your customer";
        subject = `You received a ${amountStr} tip 💜`;
        html = `
          <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#0f172a">
            <h2 style="margin:0 0 8px;font-size:20px">You received a tip 💜</h2>
            <p style="margin:0 0 16px;color:#475569">Hi ${first},</p>
            <p style="margin:0 0 16px;color:#475569">
              ${customerName} left a tip on ${bookingLabel}.
              ${crewSize > 1 ? `Your share of the ${totalStr} crew tip is below.` : "100% of it goes to you."}
            </p>
            <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:12px;padding:18px;text-align:center;margin:0 0 16px">
              <div style="font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:#6d28d9">Your tip</div>
              <div style="font-size:32px;font-weight:800;color:#5b21b6;margin-top:4px">${amountStr}</div>
              <div style="font-size:12px;color:#7c3aed;margin-top:4px">100% pass-through — Novara takes nothing</div>
            </div>
            <p style="margin:0 0 8px;color:#475569;font-size:14px">
              It will be included with your next payout.
            </p>
            <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Novara Cleaning</p>
          </div>`;
        break;
      }

      default:
        throw new Error(`Unknown email type: ${type}`);
    }

    const toList = Array.from(
      new Set(
        [email, ...(Array.isArray(to) ? to : to ? [to] : [])]
          .map((x: unknown) => String(x || "").trim().toLowerCase())
          .filter((x: string) => x.includes("@")),
      ),
    );
    const ccList = Array.from(
      new Set(
        (Array.isArray(cc) ? cc : cc ? [cc] : [])
          .map((x: unknown) => String(x || "").trim().toLowerCase())
          .filter((x: string) => x.includes("@") && !toList.includes(x)),
      ),
    );
    if (toList.length === 0) {
      throw new Error("No recipient email");
    }

    const emailResponse = await resend.emails.send({
      from: "Novara Cleaning <hello@novaracleaning.com>",
      to: toList,
      ...(ccList.length ? { cc: ccList } : {}),
      subject,
      html,
    });

    logStep("Email sent successfully", { data: emailResponse.data });

    return new Response(
      JSON.stringify({ success: true }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { error: errorMessage });
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
