// ─── send-membership-benefits ────────────────────────────────────────────
//
// Sends the Glow Membership benefits one-pager to a prospect — the sister
// of send-cleaning-checklist. Fired from the admin Quotes screen when a
// quote is saved for a membership (weekly / biweekly / monthly), so the
// customer sees everything the plan includes: customer portal access,
// the Before & After photo report, control over cleaner selection, member
// pricing, priority scheduling, credits, and the re-clean guarantee.
//
// Two ways to invoke:
//
//   POST { bookingId }                — looks up the booking for email /
//                                       phone / first-name personalization.
//
//   POST { email?, phone?, firstName?, sendEmail?, sendSms?, force? }
//                                     — direct send (Quotes / CSR tooling).
//
// Email: full branded HTML via Resend. SMS: public page link via the
// shared GHL-first sender. Idempotent per booking via booking_emails_sent
// (kind='membership_benefits'); `force: true` bypasses for admin resends.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { sendSms } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const VIEW_URL = "https://try.novaracleaning.com/membership-benefits";
const MEMBERSHIP_URL = "https://try.novaracleaning.com/membership";
const EMAIL_KIND = "membership_benefits";

// Mirrors src/lib/membership-benefits.ts — the customer-facing copy.
const BENEFIT_SECTIONS: Array<{ title: string; items: string[] }> = [
  {
    title: "Customer Portal Access — your Control Center",
    items: [
      "See every upcoming and past visit in one dashboard",
      "Reschedule, modify, or cancel visits yourself — no phone tag",
      "Book with your membership credits in a couple of taps",
      "Manage billing securely and rate each visit",
    ],
  },
  {
    title: "Before & After Photo Report",
    items: [
      "Cleaners document your home before they start and after they finish",
      "A private photo gallery link arrives after every visit",
      "Every clean is verifiable — you always know exactly what was done",
    ],
  },
  {
    title: "Control Your Cleaner Selection",
    items: [
      "Choose your preferred cleaner and keep them visit after visit",
      "Same trusted team — they learn your home and your standards",
      "Every cleaner is vetted, background-checked, and insured",
    ],
  },
  {
    title: "Member Pricing",
    items: [
      "Our best per-clean rates — always below one-time pricing",
      "Discounted add-ons and extras on every visit",
      "One flat rate based on your home size — no surprise totals",
    ],
  },
  {
    title: "Priority Scheduling",
    items: [
      "Priority access to the best arrival windows",
      "Preferred standing time slot on Bi-Weekly and Weekly plans",
      "Most member requests scheduled within 48 hours",
    ],
  },
  {
    title: "Guarantee, Credits & Flexibility",
    items: [
      "48-hour re-clean guarantee on every visit",
      "Monthly cleaning credits included (1, 2, or 4 per month by plan)",
      "Free rescheduling — pause or cancel anytime from the portal",
    ],
  },
];

function renderHtml(opts: { firstName: string }): string {
  const sectionHtml = BENEFIT_SECTIONS.map(
    (g) => `
    <h3 style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;font-size:16px;margin:24px 0 8px;color:#111827">${g.title}</h3>
    <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.65">
      ${g.items.map((t) => `<li style="margin:4px 0">${t}</li>`).join("")}
    </ul>`,
  ).join("");

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Your Glow Membership Benefits</title></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;color:#374151">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(92,15,254,0.10)">
        <tr><td style="background:linear-gradient(135deg,#7C3AED 0%,#5C0FFE 100%);padding:32px 32px 28px;color:#ffffff">
          <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85">NovaraCleaning</p>
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;letter-spacing:-0.01em">Glow Membership Benefits</h1>
          <p style="margin:0;font-size:14px;line-height:1.5;opacity:0.95">Hi ${opts.firstName || "there"} — here's everything included with a Glow Membership. More than a recurring clean: full visibility, photo proof, and you stay in control.</p>
        </td></tr>
        <tr><td style="padding:28px 32px">
          <p style="margin:0 0 18px;font-size:14px;color:#374151;line-height:1.6">
            Every Glow plan — <strong>Monthly (1 clean/mo)</strong>, <strong>Bi-Weekly (2 cleans/mo)</strong>, or <strong>Weekly (4 cleans/mo)</strong> —
            includes the full benefit stack below. Same benefits on every plan; just choose how often we visit.
          </p>

          ${sectionHtml}

          <div style="text-align:center;margin:28px 0 8px">
            <a href="${VIEW_URL}" style="display:inline-block;background:linear-gradient(135deg,#7C3AED 0%,#5C0FFE 100%);color:#fff;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px">See all membership benefits</a>
          </div>
          <p style="margin:0 0 16px;font-size:12px;color:#9CA3AF;text-align:center">Or open: ${VIEW_URL}</p>

          <div style="text-align:center;margin:8px 0 8px">
            <a href="${MEMBERSHIP_URL}" style="display:inline-block;border:1px solid #7C3AED;color:#5B21B6;padding:12px 26px;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px">View plans &amp; pricing</a>
          </div>

          <hr style="border:none;border-top:1px solid #E5E7EB;margin:32px 0" />

          <p style="margin:0 0 8px;font-size:13px;color:#6B7280;line-height:1.6">Questions about your quote or which plan fits? Just reply to this email or text us at <strong style="color:#111827">(301) 357-9119</strong> — we'll help you pick.</p>
          <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.5">© NovaraCleaning · All Rights Reserved.</p>
        </td></tr>
        <tr><td style="background:#F9FAFB;padding:20px 32px;text-align:center;font-size:12px;color:#6B7280">
          Novara Cleaning &middot; hello@novaracleaning.com &middot; +1 (844) 735-2070<br/>
          Reply to this email any time — we love hearing from our customers.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

function plainText(opts: { firstName: string }): string {
  const lines = [
    `Hi ${opts.firstName || "there"},`,
    "",
    "Here's everything included with a NovaraCleaning Glow Membership:",
    "",
    ...BENEFIT_SECTIONS.flatMap((g) => [
      `--- ${g.title.toUpperCase()} ---`,
      ...g.items.map((t) => `  • ${t}`),
      "",
    ]),
    `See all benefits: ${VIEW_URL}`,
    `Plans & pricing: ${MEMBERSHIP_URL}`,
    "",
    "Questions? Reply to this email or text us at (301) 357-9119.",
    "",
    "— The Novara team",
  ];
  return lines.join("\n");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const payload = await req.json().catch(() => ({}));
    const {
      bookingId,
      email: directEmail,
      phone: directPhone,
      firstName: directFirstName,
      sendEmail: wantEmail = true,
      sendSms: wantSms = false,
      force = false,
    } = payload as {
      bookingId?: string;
      email?: string;
      phone?: string;
      firstName?: string;
      /** Email the full benefits HTML (default true). */
      sendEmail?: boolean;
      /** Text the public benefits page link (default false). */
      sendSms?: boolean;
      /** Bypass booking_emails_sent idempotency when resending from admin. */
      force?: boolean;
    };

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    let email = directEmail || "";
    let phone = directPhone || "";
    let firstName = directFirstName || "";
    let resolvedBookingId: string | null = bookingId || null;

    if (bookingId) {
      const { data: booking } = await supabase
        .from("bookings")
        .select("id, email, phone, first_name")
        .eq("id", bookingId)
        .maybeSingle();
      if (booking) {
        email = email || booking.email || "";
        phone = phone || booking.phone || "";
        firstName = firstName || booking.first_name || "";
        resolvedBookingId = booking.id;
      }
    }

    const doEmail = wantEmail !== false;
    const doSms = wantSms === true;
    if (!doEmail && !doSms) {
      return new Response(JSON.stringify({ error: "sendEmail and/or sendSms required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    if (doEmail && !email) {
      return new Response(JSON.stringify({ error: "email required when sendEmail is true" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    if (doSms && !phone) {
      return new Response(JSON.stringify({ error: "phone required when sendSms is true" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    // Idempotency (booking sends only — quote sends always pass force).
    if (resolvedBookingId && !force && doEmail) {
      const { data: prior } = await supabase
        .from("booking_emails_sent")
        .select("id, sent_at")
        .eq("booking_id", resolvedBookingId)
        .eq("kind", EMAIL_KIND)
        .maybeSingle();
      if (prior?.id) {
        return new Response(
          JSON.stringify({ skipped: true, reason: "already-sent", priorSentAt: prior.sent_at, viewUrl: VIEW_URL }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200,
          },
        );
      }
    }

    let messageId: string | null = null;
    let emailed = false;
    if (doEmail) {
      const resend = new Resend(Deno.env.get("RESEND_API_KEY") || "");
      const result = await resend.emails.send({
        from: "Novara Cleaning <hello@novaracleaning.com>",
        to: [email],
        subject: "Your Glow Membership Benefits — everything included ✨",
        html: renderHtml({ firstName }),
        text: plainText({ firstName }),
      });

      if (result?.error) {
        console.error("[send-membership-benefits] resend error", result.error);
        return new Response(
          JSON.stringify({ error: "resend send failed", detail: result.error }),
          {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 502,
          },
        );
      }
      messageId = (result?.data?.id as string | undefined) || null;
      emailed = true;

      if (resolvedBookingId) {
        try {
          await supabase.from("booking_emails_sent").insert({
            booking_id: resolvedBookingId,
            kind: EMAIL_KIND,
            recipient_email: email,
            provider_message_id: messageId,
          });
        } catch (logErr) {
          console.warn("[send-membership-benefits] booking_emails_sent insert failed", logErr);
        }
      }
    }

    let smsSent = false;
    if (doSms) {
      smsSent = await sendSms(supabase, {
        toPhone: phone,
        message:
          `NovaraCleaning: Here's everything included with a Glow Membership ` +
          `(portal access, photo reports, your choice of cleaner + more): ${VIEW_URL} ` +
          `Questions? Reply or call (844) 735-2070`,
        type: "confirmation",
      });
    }

    try {
      await supabase.from("events").insert({
        event_type: "membership_benefits.sent",
        source: "send-membership-benefits",
        summary: `Membership benefits sent via ${[emailed && "email", smsSent && "sms"].filter(Boolean).join("+") || "none"}`,
        data: {
          booking_id: resolvedBookingId,
          email: email || null,
          phone: phone || null,
          view_url: VIEW_URL,
          emailed,
          sms_sent: smsSent,
          force: Boolean(force),
        },
      });
    } catch {
      /* best-effort */
    }

    return new Response(
      JSON.stringify({ success: true, bookingId: resolvedBookingId, messageId, emailed, smsSent, viewUrl: VIEW_URL }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[send-membership-benefits]", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
