// ─── send-cleaning-checklist ─────────────────────────────────────────────
//
// The customer's cleaning checklist, by email and text.
//
//   POST { bookingId }
//     Booking confirmed. Mints (or reuses) the customer's private checklist
//     session, then sends ONE email and ONE text pointing at their own page,
//     /my-checklist/<token>. The page is built live from their booking:
//     their service, date, home, add-ons, and notes. Each channel is claimed
//     in booking_emails_sent before it sends, so a retry, a webhook replay,
//     or two confirmation paths landing together can never send it twice.
//
//   POST { email, firstName?, serviceType?, sendEmail?, sendSms?, force? }
//     Admin tooling (quotes, membership signup). No booking, so no personal
//     page: sends the full public checklist inline with a link to the public
//     checklist page.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendThroughCompliance } from "../_shared/email-compliance-send.ts";
import { resolveSecret } from "../_shared/app-secrets.ts";
import { sendSms } from "../_shared/sms.ts";
import { publicChecklistUrl } from "../_shared/public-checklist-url.ts";
import {
  buildPersonalChecklist,
  CHECKLIST_BY_TYPE,
  personalChecklistUrl,
  renderPersonalEmail,
  resolveChecklistType,
  type ChecklistContent,
} from "../_shared/customer-checklists.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const PERSONAL_EMAIL_KIND = "personal_checklist";
const PERSONAL_SMS_KIND = "personal_checklist_sms";

/** Public customer-facing checklist page for a given service type. */
function checklistViewUrl(serviceType: string, scopeLevel?: string | null): string {
  return publicChecklistUrl(serviceType, scopeLevel);
}

// ─── HTML renderer ───────────────────────────────────────────────────
function renderHtml(opts: {
  firstName: string;
  bookingNumber?: number | null;
  serviceDate?: string | null;
  timeSlot?: string | null;
  serviceAddress?: string | null;
  content: ChecklistContent;
  viewUrl?: string;
}): string {
  const { content } = opts;
  const sectionHtml = content.sections.map(
    (g) => `
    <h2 style="font-family:Inter,Arial,sans-serif;font-size:18px;margin:24px 0 8px;color:#ffffff">${g.title}</h2>
    <ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.65">
      ${g.items.map((t) => `<li style="margin:4px 0">${t}</li>`).join("")}
    </ul>`,
  ).join("");

  const extrasHtml = `
    <ul style="margin:0;padding-left:20px;font-size:15px;line-height:1.65">
      ${content.extras.map((t) => `<li style="margin:4px 0">${t}</li>`).join("")}
    </ul>`;

  const viewCta = opts.viewUrl
    ? `<p style="margin:22px 0 0;"><a class="novara-btn" href="${opts.viewUrl}" style="display:inline-block;padding:14px 28px;background:#e7e7ea;color:#18181b;text-decoration:none;border-radius:12px;font-weight:600;">View checklist online</a></p>`
    : "";

  const bookingMetaRows: string[] = [];
  if (opts.bookingNumber) {
    bookingMetaRows.push(
      `<tr><td style="padding:8px 0;border-bottom:1px solid #3a3a40;">Booking</td><td style="padding:8px 0;border-bottom:1px solid #3a3a40;font-weight:600;text-align:right">NVC-${String(opts.bookingNumber).padStart(4, "0")}</td></tr>`,
    );
  }
  if (opts.serviceDate) {
    bookingMetaRows.push(
      `<tr><td style="padding:8px 0;border-bottom:1px solid #3a3a40;">Service date</td><td style="padding:8px 0;border-bottom:1px solid #3a3a40;font-weight:600;text-align:right">${opts.serviceDate}</td></tr>`,
    );
  }
  if (opts.timeSlot) {
    bookingMetaRows.push(
      `<tr><td style="padding:8px 0;border-bottom:1px solid #3a3a40;">Arrival window</td><td style="padding:8px 0;border-bottom:1px solid #3a3a40;font-weight:600;text-align:right">${opts.timeSlot}</td></tr>`,
    );
  }
  if (opts.serviceAddress) {
    bookingMetaRows.push(
      `<tr><td style="padding:8px 0;border-bottom:1px solid #3a3a40;">Service address</td><td style="padding:8px 0;border-bottom:1px solid #3a3a40;font-weight:600;text-align:right">${opts.serviceAddress}</td></tr>`,
    );
  }

  const bookingMetaTable = bookingMetaRows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 16px">
         ${bookingMetaRows.join("")}
       </table>`
    : "";

  return `<h1 style="margin:0 0 14px;font-family:Inter,Arial,sans-serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">${content.heading}</h1>
<p style="margin:0 0 16px;">Hi ${opts.firstName || "there"} — here's exactly what the Novara team will do on your visit. Save this email so you always know what's included and what's an add-on.</p>
${bookingMetaTable}
<p style="margin:0 0 16px;">${content.intro}</p>
${sectionHtml}
<h2 style="font-family:Inter,Arial,sans-serif;font-size:18px;margin:24px 0 8px;color:#ffffff;">Extras (additional charges apply)</h2>
<p style="margin:0 0 8px;">Want any of these on your next visit? Reply to this email or text us — we'll add them and send an updated total.</p>
${extrasHtml}
${viewCta}
<p style="margin:16px 0 0;"><strong style="color:#ffffff;">Day-of prep tips:</strong> tidy small valuables, secure pets, and flag any sensitive surfaces (natural stone, antique wood, framed art) so we use the right cleaner.</p>`;
}

function plainText(opts: { firstName: string; content: ChecklistContent; viewUrl?: string }): string {
  const { content } = opts;
  const lines = [
    `Hi ${opts.firstName || "there"},`,
    "",
    `Here is the official NovaraCleaning ${content.heading} — exactly what our team will do on your visit.`,
    "",
    ...content.sections.flatMap((g) => [
      `--- ${g.title.toUpperCase()} ---`,
      ...g.items.map((t) => `  • ${t}`),
      "",
    ]),
    "--- EXTRAS (additional charges apply) ---",
    ...content.extras.map((t) => `  • ${t}`),
    "",
    ...(opts.viewUrl ? [`View online: ${opts.viewUrl}`, ""] : []),
    "Reply to this email or text us at +1 (844) 735-2070 to add an extra.",
    "",
    "— The Novara team",
  ];
  return lines.join("\n");
}

// ─── Claim-then-send ledger ─────────────────────────────────────────

// deno-lint-ignore no-explicit-any
type Db = any;

/** True when this call won the right to send. A second caller gets false. */
async function claim(db: Db, bookingId: string, kind: string, recipient: string): Promise<boolean> {
  const { error } = await db.from("booking_emails_sent").insert({
    booking_id: bookingId,
    kind,
    recipient_email: recipient || null,
  });
  return !error;
}

async function release(db: Db, bookingId: string, kind: string): Promise<void> {
  await db.from("booking_emails_sent").delete().eq("booking_id", bookingId).eq("kind", kind);
}

async function ensureSession(db: Db, booking: { id: string; email?: string | null }, checklistType: string): Promise<string> {
  const { data: existing } = await db
    .from("customer_checklist_sessions")
    .select("token, revoked_at")
    .eq("booking_id", booking.id)
    .maybeSingle();
  if (existing?.token && !existing.revoked_at) return String(existing.token);

  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  if (existing?.token) {
    await db
      .from("customer_checklist_sessions")
      .update({ token, revoked_at: null, checklist_type: checklistType })
      .eq("booking_id", booking.id);
    return token;
  }
  const { error } = await db.from("customer_checklist_sessions").insert({
    booking_id: booking.id,
    token,
    email: booking.email || null,
    checklist_type: checklistType,
  });
  if (error) {
    const { data: raced } = await db
      .from("customer_checklist_sessions")
      .select("token")
      .eq("booking_id", booking.id)
      .maybeSingle();
    if (raced?.token) return String(raced.token);
    throw new Error(`Could not create the checklist session: ${error.message}`);
  }
  return token;
}


function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

const BOOKING_COLUMNS =
  "id, status, is_reclean, booking_number, email, phone, first_name, service_type, scope_level, service_date, time_slot, arrival_window, address, city, state, bedrooms, bathrooms, dwelling_type, frequency, add_ons, pets, access_notes";

// ─── Handler ─────────────────────────────────────────────────────────
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
      serviceType: directServiceType,
      scopeLevel: directScopeLevel,
      sendEmail: wantEmail = true,
      sendSms: wantSms,
      force = false,
    } = payload as {
      bookingId?: string;
      email?: string;
      phone?: string;
      firstName?: string;
      serviceType?: string;
      scopeLevel?: string;
      /** Email the checklist (default true). */
      sendEmail?: boolean;
      /** Text the checklist link. Booking mode defaults to true when the booking has a phone. */
      sendSms?: boolean;
      /** Admin resend: bypass the already-sent ledger. */
      force?: boolean;
    };

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );
    const resendKey = await resolveSecret(supabase, "RESEND_API_KEY");

    if (bookingId) {
      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select(BOOKING_COLUMNS)
        .eq("id", bookingId)
        .maybeSingle();
      if (bookingError || !booking) {
        return json({ error: "Booking not found" }, 404);
      }
      if (String(booking.status || "").toLowerCase() === "cancelled" || booking.is_reclean === true) {
        return json({ skipped: true, reason: booking.is_reclean ? "reclean" : "cancelled" });
      }

      const email = String(booking.email || directEmail || "").trim();
      const phone = String(booking.phone || directPhone || "").trim();
      const checklist = buildPersonalChecklist(booking);
      const token = await ensureSession(supabase, booking, checklist.checklistType);
      const url = personalChecklistUrl(token);
      const legacyKind = (CHECKLIST_BY_TYPE[checklist.checklistType] ?? CHECKLIST_BY_TYPE.standard).emailKind;

      let emailed = false;
      let emailSkipped: string | null = null;
      if (wantEmail !== false && email) {
        const { data: legacy } = await supabase
          .from("booking_emails_sent").select("id").eq("booking_id", booking.id).eq("kind", legacyKind).maybeSingle();
        if (force) await release(supabase, booking.id, PERSONAL_EMAIL_KIND);
        if (legacy?.id && !force) {
          emailSkipped = "already-sent";
        } else if (!(await claim(supabase, booking.id, PERSONAL_EMAIL_KIND, email))) {
          emailSkipped = "already-sent";
        } else {
          const result = await sendThroughCompliance(resendKey, {
            to: email,
            subject: `Your cleaning checklist${checklist.visit.serviceDate ? ` for ${checklist.visit.serviceDate}` : ""}`,
            html: renderPersonalEmail(checklist, url),
            templateKey: "cleaning_checklist",
            declaredType: "customer_service",
            bookingId: booking.id,
          });
          if (result?.error || !result?.data?.id) {
            await release(supabase, booking.id, PERSONAL_EMAIL_KIND);
            console.error("[send-cleaning-checklist] email failed", result?.error);
            return json({ error: "email send failed", detail: result?.error?.message }, 502);
          }
          await supabase
            .from("booking_emails_sent")
            .update({ provider_message_id: result.data.id })
            .eq("booking_id", booking.id)
            .eq("kind", PERSONAL_EMAIL_KIND);
          emailed = true;
        }
      }

      let smsSent = false;
      let smsSkipped: string | null = null;
      const doSms = wantSms ?? Boolean(phone);
      if (doSms && phone) {
        if (force) await release(supabase, booking.id, PERSONAL_SMS_KIND);
        if (!(await claim(supabase, booking.id, PERSONAL_SMS_KIND, phone))) {
          smsSkipped = "already-sent";
        } else {
          const when = checklist.visit.serviceDate ? ` for ${checklist.visit.serviceDate.replace(/, \d{4}$/, "")}` : "";
          smsSent = await sendSms(supabase, {
            toPhone: phone,
            message: `Novara Cleaning: Your personal cleaning checklist${when} is ready: ${url} Reply STOP to opt out.`,
            type: "confirmation",
          });
          if (!smsSent) await release(supabase, booking.id, PERSONAL_SMS_KIND);
        }
      }

      try {
        await supabase.from("events").insert({
          event_type: "checklist.sent",
          source: "send-cleaning-checklist",
          booking_id: booking.id,
          summary: `Personal checklist (${checklist.checklistType}) via ${[emailed && "email", smsSent && "sms"].filter(Boolean).join("+") || "none"}`,
          data: { booking_id: booking.id, checklist_type: checklist.checklistType, emailed, sms_sent: smsSent, emailSkipped, smsSkipped },
        });
      } catch { /* best-effort */ }

      return json({ success: true, bookingId: booking.id, emailed, smsSent, emailSkipped, smsSkipped, viewUrl: url, checklistType: checklist.checklistType });
    }

    // ─── Admin direct send (no booking, no personal page) ───────────────
    const email = String(directEmail || "").trim();
    const phone = String(directPhone || "").trim();
    const firstName = String(directFirstName || "").trim();
    const serviceType = String(directServiceType || "standard").toLowerCase();
    const scopeLevel = String(directScopeLevel || "").toLowerCase() || null;
    const doEmail = wantEmail !== false;
    const doSms = wantSms === true;
    if (!doEmail && !doSms) return json({ error: "sendEmail and/or sendSms required" }, 400);
    if (doEmail && !email) return json({ error: "email required when sendEmail is true" }, 400);
    if (doSms && !phone) return json({ error: "phone required when sendSms is true" }, 400);

    const checklistType = resolveChecklistType(serviceType, scopeLevel);
    const content = CHECKLIST_BY_TYPE[checklistType] ?? CHECKLIST_BY_TYPE.standard;
    const viewUrl = checklistViewUrl(serviceType, scopeLevel);

    let messageId: string | null = null;
    let emailed = false;
    if (doEmail) {
      const result = await sendThroughCompliance(resendKey, {
        to: email,
        subject: content.subject,
        html: renderHtml({ firstName, content, viewUrl }),
        text: plainText({ firstName, content, viewUrl }),
        templateKey: "cleaning_checklist",
        declaredType: "customer_service",
      });
      if (result?.error) {
        console.error("[send-cleaning-checklist] resend error", result.error);
        return json({ error: "resend send failed", detail: result.error }, 502);
      }
      messageId = (result?.data?.id as string | undefined) || null;
      emailed = true;
    }

    let smsSent = false;
    if (doSms) {
      const label = content.heading.replace(/\s+Checklist$/i, "") || "cleaning";
      smsSent = await sendSms(supabase, {
        toPhone: phone,
        message:
          `NovaraCleaning: Here's your ${label} checklist (what's included): ${viewUrl} ` +
          `Questions? Reply or call (844) 735-2070`,
        type: "confirmation",
      });
    }

    try {
      await supabase.from("events").insert({
        event_type: "checklist.sent",
        source: "send-cleaning-checklist",
        summary: `Checklist sent (${checklistType}) via ${[emailed && "email", smsSent && "sms"].filter(Boolean).join("+") || "none"}`,
        data: { email: email || null, phone: phone || null, service_type: serviceType, checklist_type: checklistType, view_url: viewUrl, emailed, sms_sent: smsSent, force: Boolean(force) },
      });
    } catch { /* best-effort */ }

    return json({ success: true, messageId, emailed, smsSent, viewUrl, checklistType });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[send-cleaning-checklist]", message);
    return json({ error: message }, 500);
  }
});
