// ─── send-cleaning-checklist ─────────────────────────────────────────────
//
// Drops the official NovaraCleaning Maintenance Cleaning Checklist into
// the customer's inbox. This is the canonical scope-of-work for every
// recurring (weekly / biweekly / monthly) Standard cleaning, so the
// customer knows exactly what's covered and what's an add-on.
//
// Two ways to invoke:
//
//   POST { bookingId }                — looks up the booking, sends to
//                                       booking.email with first-name
//                                       personalization. Skips silently
//                                       if service_type is not 'standard'
//                                       (deep / move-in/out have their
//                                       own scope docs).
//
//   POST { email, firstName?, serviceType?: "standard" }
//                                     — direct send (admin tooling).
//
// Idempotent: writes a booking_emails_sent row keyed on
// (booking_id, kind='maintenance_checklist') so the same booking can't
// double-fire even if the auto-trigger retries.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { Resend } from "https://esm.sh/resend@4.0.0";
import { sendSms } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

/** Public customer-facing checklist page for a given service type. */
function checklistViewUrl(serviceType: string): string {
  const base = "https://try.novaracleaning.com/checklist";
  const kind = resolveChecklistType(serviceType);
  switch (kind) {
    case "deep":
    case "combo":
      return `${base}/deep-clean`;
    case "moveinout":
      return `${base}/move-in-out`;
    default:
      return `${base}/standard-clean`;
  }
}

// ─── SERVICE-TYPE-AWARE CHECKLIST DATA ───────────────────────────────
//
// Each service type has its own subject, heading, intro, sections, and
// extras list. Extend CHECKLIST_BY_TYPE to add new types — the handler
// routes automatically. Idempotency kind is per-type so a deep_checklist
// and maintenance_checklist can both exist for the same booking without
// conflicting.

interface ChecklistContent {
  subject: string;
  heading: string;
  intro: string;
  sections: Array<{ title: string; items: string[] }>;
  extras: string[];
  emailKind: string;
}

const CHECKLIST_BY_TYPE: Record<string, ChecklistContent> = {
  standard: {
    subject: "Your Maintenance Cleaning Checklist — what's included ✨",
    heading: "Maintenance Cleaning Checklist",
    intro:
      "All recurring cleanings (weekly, biweekly and monthly) are what we call <strong>maintenance cleans</strong> because the goal is to <em>maintain the cleanliness</em> of the home. These are thorough, efficient cleanings, covering every area of the house every single time.",
    emailKind: "maintenance_checklist",
    sections: [
      {
        title: "Kitchen",
        items: [
          "Dust and spot clean cabinet fronts",
          "Clean counter tops",
          "Clean sink and polish faucet",
          "Wipe microwave interior and exterior",
          "Dust small appliances & items on counter tops",
          "Clean microwave (inside and out)",
          "Clean/polish oven and refrigerator exterior",
          "Clean/polish stove top and vent hood",
          "Vacuum and mop kitchen floor",
          "Remove trash, replace bag, wipe exterior",
        ],
      },
      {
        title: "Bathrooms",
        items: [
          "Clean mirrors (streak-free)",
          "Dust light fixtures",
          "Spot clean cabinet fronts",
          "Scrub the shower and tub",
          "Clean counters, sinks and polish fixtures",
          "Disinfect toilet and toilet area",
          "Vacuum bathroom rugs",
          "Remove trash, replace bag, wipe exterior",
          "Clean and disinfect bathroom floors",
        ],
      },
      {
        title: "All Rooms",
        items: [
          "Remove cob webs and dust ceiling fans",
          "Dust reachable light fixtures and ceiling fans",
          "Dust wall art and AC/heating vents",
          "Disinfect light switches and door knobs",
          "Dust and spot clean doors and door frames",
          "Dust window sills and window ledges",
          "Dust baseboards and blinds",
          "Dust TVs, electronics, knick-knacks, book tops, picture frames, lamps, etc.",
          "Dust all furniture — polish as needed",
          "Dust banister and handrails",
          "Vacuum all floors/stairs and mop hard surface floors",
          "Vacuum all furniture (if possible)",
          "Change linen and/or make all beds",
          "Clean front/back door glass",
        ],
      },
    ],
    extras: [
      "Hand wash baseboards",
      "Clean oven (interior)",
      "Clean refrigerator/freezer",
      "Wash interior window (must be reachable with a 2-step stool)",
      "Hand wash wood blinds or shutters",
    ],
  },

  deep: {
    subject: "Your Deep Clean Checklist — full scope included ✨",
    heading: "Deep Clean Checklist",
    intro:
      "Your Deep Clean is the thorough reset your home deserves. We go further than a standard maintenance clean — hand-wiping every surface, detail-cleaning appliances, and reaching every corner so your home is set to the highest baseline.",
    emailKind: "deep_checklist",
    sections: [
      {
        title: "Kitchen",
        items: [
          "Hand-wipe all cabinet exteriors",
          "Clean countertops",
          "Wipe backsplash",
          "Clean sink and polish faucets",
          "Hand-wipe small appliances and items on countertops",
          "Clean microwave (inside and out)",
          "Clean and polish oven and refrigerator exterior",
          "Clean and polish stove top and vent hood",
          "Detail-clean under electric range burners",
          "Vacuum and mop kitchen floor",
          "Remove trash, replace bag, wipe exterior",
        ],
      },
      {
        title: "Bathrooms",
        items: [
          "Clean mirrors (streak-free)",
          "Wipe all reachable light fixtures",
          "Wipe cabinet fronts",
          "Scrub shower and tub",
          "Clean counters, sinks, and polish fixtures",
          "Disinfect toilet and surrounding area",
          "Vacuum bathroom rugs",
          "Remove trash, replace bags, wipe exterior",
          "Clean and disinfect bathroom floor",
        ],
      },
      {
        title: "All Rooms",
        items: [
          "Remove cobwebs",
          "Wipe all reachable light fixtures and ceiling fan blades",
          "Dust wall art and A/C vents",
          "Disinfect light switches and door knobs",
          "Hand-wipe door frames and doors",
          "Hand-wipe window sills and window ledges",
          "Dust baseboards and blinds",
          "Dust TVs, electronics, book tops, knick-knacks, lamps",
          "Hand-polish all wood furniture",
          "Dust banisters and handrails",
          "Vacuum floors and mop hard surface floors",
          "Vacuum under all furniture (where possible)",
          "Vacuum carpet edges with attachment",
          "Vacuum upholstered furniture and crevices",
          "Change linens and/or make beds",
          "Clean front and back door glass",
        ],
      },
    ],
    extras: [
      "Hand wash baseboards (included in Deluxe)",
      "Clean oven interior",
      "Clean refrigerator and freezer interior",
      "Wash interior windows (reachable with a 2-step stool)",
      "Hand wash wood blinds or shutters (included in Deluxe)",
    ],
  },

  moveinout: {
    subject: "Your Move In/Out Cleaning Checklist — complete scope ✨",
    heading: "Move In/Out Clean Checklist",
    intro:
      "Your Move In/Out Clean covers every inch of the empty home — including the interior of all cabinets, drawers, and built-ins that a standard or deep clean can't reach. Here's exactly what our team will complete.",
    emailKind: "moveinout_checklist",
    sections: [
      {
        title: "Kitchen",
        items: [
          "Hand-wipe all cabinet exteriors",
          "Clean and wipe down pantry",
          "Vacuum out and wipe inside all cabinets and drawers",
          "Clean countertops",
          "Wipe backsplash",
          "Clean sink and polish faucets",
          "Clean microwave (inside and out)",
          "Clean and polish oven and refrigerator exterior",
          "Clean and polish stove top and vent hood",
          "Detail-clean under electric range burners",
          "Vacuum and mop kitchen floor",
        ],
      },
      {
        title: "Bathrooms",
        items: [
          "Clean mirrors (streak-free)",
          "Wipe all reachable light fixtures",
          "Wipe cabinet fronts",
          "Wipe out inside cabinets and drawers",
          "Scrub shower and tub",
          "Clean counters, sinks, and polish fixtures",
          "Disinfect toilet and surrounding area",
          "Clean and disinfect bathroom floor",
        ],
      },
      {
        title: "All Rooms",
        items: [
          "Remove cobwebs",
          "Wipe all reachable light fixtures and ceiling fan blades",
          "Dust A/C vents",
          "Wipe inside and out of any built-in cabinets or bookcases",
          "Disinfect light switches and door knobs",
          "Hand-wipe door frames and doors",
          "Hand-wipe window sills and ledges",
          "Dust baseboards and blinds",
          "Dust banisters and handrails",
          "Vacuum floors and mop hard surface floors",
          "Vacuum carpet edges with attachment",
          "Clean front and back door glass",
        ],
      },
    ],
    extras: [
      "Clean oven interior",
      "Clean refrigerator and freezer interior",
      "Wash interior windows (reachable with a 2-step stool)",
      "Hand wash wood blinds or shutters",
      "Carpet shampooing / steam cleaning (separate service)",
    ],
  },

  combo: {
    subject: "Your Combo Clean Checklist — both visits covered ✨",
    heading: "Combo Clean Checklist",
    intro:
      "Your Combo Clean includes a Deep Clean on the first visit followed by a Standard Maintenance Clean on the follow-up visit. The scope below covers your initial deep clean — your second visit follows the standard maintenance checklist.",
    emailKind: "combo_checklist",
    sections: [
      {
        title: "Kitchen (Deep Clean — First Visit)",
        items: [
          "Hand-wipe all cabinet exteriors",
          "Clean countertops",
          "Wipe backsplash",
          "Clean sink and polish faucets",
          "Hand-wipe small appliances and items on countertops",
          "Clean microwave (inside and out)",
          "Clean and polish oven and refrigerator exterior",
          "Clean and polish stove top and vent hood",
          "Detail-clean under electric range burners",
          "Vacuum and mop kitchen floor",
          "Remove trash, replace bag, wipe exterior",
        ],
      },
      {
        title: "Bathrooms (Deep Clean — First Visit)",
        items: [
          "Clean mirrors (streak-free)",
          "Wipe all reachable light fixtures",
          "Wipe cabinet fronts",
          "Scrub shower and tub",
          "Clean counters, sinks, and polish fixtures",
          "Disinfect toilet and surrounding area",
          "Vacuum bathroom rugs",
          "Remove trash, replace bags, wipe exterior",
          "Clean and disinfect bathroom floor",
        ],
      },
      {
        title: "All Rooms (Deep Clean — First Visit)",
        items: [
          "Remove cobwebs",
          "Wipe all reachable light fixtures and ceiling fan blades",
          "Dust wall art and A/C vents",
          "Disinfect light switches and door knobs",
          "Hand-wipe door frames and doors",
          "Hand-wipe window sills and window ledges",
          "Dust baseboards and blinds",
          "Dust TVs, electronics, book tops, knick-knacks, lamps",
          "Hand-polish all wood furniture",
          "Dust banisters and handrails",
          "Vacuum floors and mop hard surface floors",
          "Vacuum under all furniture (where possible)",
          "Vacuum carpet edges with attachment",
          "Vacuum upholstered furniture and crevices",
          "Change linens and/or make beds",
          "Clean front and back door glass",
        ],
      },
    ],
    extras: [
      "Clean oven interior",
      "Clean refrigerator and freezer interior",
      "Wash interior windows (reachable with a 2-step stool)",
      "Hand wash wood blinds or shutters",
    ],
  },
};

function resolveChecklistType(serviceType: string): string {
  const lower = (serviceType || "").toLowerCase().replace(/[\s_-]/g, "");
  if (lower.includes("move") || lower.includes("inout")) return "moveinout";
  if (lower === "deep") return "deep";
  if (lower === "combo") return "combo";
  return "standard";
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
    <h3 style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;font-size:16px;margin:24px 0 8px;color:#111827">${g.title}</h3>
    <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.65">
      ${g.items.map((t) => `<li style="margin:4px 0">${t}</li>`).join("")}
    </ul>`,
  ).join("");

  const extrasHtml = `
    <ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.65">
      ${content.extras.map((t) => `<li style="margin:4px 0">${t}</li>`).join("")}
    </ul>`;

  const viewCta = opts.viewUrl
    ? `<div style="text-align:center;margin:28px 0 8px">
        <a href="${opts.viewUrl}" style="display:inline-block;background:linear-gradient(135deg,#16A34A 0%,#0E7C3A 100%);color:#fff;padding:14px 28px;text-decoration:none;border-radius:6px;font-weight:600;font-size:15px">View checklist online</a>
      </div>
      <p style="margin:0 0 16px;font-size:12px;color:#9CA3AF;text-align:center">Or open: ${opts.viewUrl}</p>`
    : "";

  const bookingMetaRows: string[] = [];
  if (opts.bookingNumber) {
    bookingMetaRows.push(
      `<tr><td style="padding:2px 0;color:#6B7280;font-size:13px">Booking #</td><td style="padding:2px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">NVC-${String(opts.bookingNumber).padStart(4, "0")}</td></tr>`,
    );
  }
  if (opts.serviceDate) {
    bookingMetaRows.push(
      `<tr><td style="padding:2px 0;color:#6B7280;font-size:13px">Service date</td><td style="padding:2px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${opts.serviceDate}</td></tr>`,
    );
  }
  if (opts.timeSlot) {
    bookingMetaRows.push(
      `<tr><td style="padding:2px 0;color:#6B7280;font-size:13px">Arrival window</td><td style="padding:2px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${opts.timeSlot}</td></tr>`,
    );
  }
  if (opts.serviceAddress) {
    bookingMetaRows.push(
      `<tr><td style="padding:2px 0;color:#6B7280;font-size:13px">Service address</td><td style="padding:2px 0;color:#111827;font-size:13px;font-weight:600;text-align:right">${opts.serviceAddress}</td></tr>`,
    );
  }

  const bookingMetaTable = bookingMetaRows.length
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;border-radius:10px;padding:14px 16px;margin:0 0 20px">
         ${bookingMetaRows.join("")}
       </table>`
    : "";

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Your Maintenance Cleaning Checklist</title></head>
<body style="margin:0;padding:0;background:#F9FAFB;font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;color:#374151">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F9FAFB;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(22,163,74,0.10)">
        <tr><td style="background:linear-gradient(135deg,#16A34A 0%,#0E7C3A 100%);padding:32px 32px 28px;color:#ffffff">
          <p style="margin:0 0 4px;font-size:11px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.85">NovaraCleaning</p>
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;letter-spacing:-0.01em">${content.heading}</h1>
          <p style="margin:0;font-size:14px;line-height:1.5;opacity:0.95">Hi ${opts.firstName || "there"} — here's exactly what the Novara team will do on your visit. Save this email so you always know what's included and what's an add-on.</p>
        </td></tr>
        <tr><td style="padding:28px 32px">
          ${bookingMetaTable}
          <p style="margin:0 0 18px;font-size:14px;color:#374151;line-height:1.6">
            ${content.intro}
          </p>

          ${sectionHtml}

          <hr style="border:none;border-top:1px solid #E5E7EB;margin:32px 0" />

          <h3 style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;font-size:16px;margin:0 0 8px;color:#111827">Extras (additional charges apply)</h3>
          <p style="margin:0 0 8px;font-size:13px;color:#6B7280">Want any of these on your next visit? Just reply to this email or text us — we'll add them and send an updated total.</p>
          ${extrasHtml}

          ${viewCta}

          <hr style="border:none;border-top:1px solid #E5E7EB;margin:32px 0" />

          <p style="margin:0 0 8px;font-size:13px;color:#6B7280;line-height:1.6"><strong style="color:#111827">Day-of prep tips:</strong> tidy small valuables, secure pets, and flag any sensitive surfaces (natural stone, antique wood, framed art) so we use the right cleaner.</p>
          <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.5">© NovaraCleaning · All Rights Reserved. This document is the exclusive property of NovaraCleaning and intended solely for use by authorized employees, contractors, and the recipient customer.</p>
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
      sendEmail: wantEmail = true,
      sendSms: wantSms = false,
      force = false,
    } = payload as {
      bookingId?: string;
      email?: string;
      phone?: string;
      firstName?: string;
      serviceType?: string;
      /** Email the full checklist HTML (default true). */
      sendEmail?: boolean;
      /** Text the public customer checklist page link (default false). */
      sendSms?: boolean;
      /** Bypass booking_emails_sent idempotency when resending from admin. */
      force?: boolean;
    };

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ??
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    );

    // Resolve recipient + booking-level personalization.
    let email = directEmail || "";
    let phone = directPhone || "";
    let firstName = directFirstName || "";
    let serviceType = (directServiceType || "standard").toLowerCase();
    let bookingNumber: number | null = null;
    let serviceDate: string | null = null;
    let timeSlot: string | null = null;
    let serviceAddress: string | null = null;
    let resolvedBookingId: string | null = bookingId || null;

    if (bookingId) {
      const { data: booking, error: bookingError } = await supabase
        .from("bookings")
        .select(
          "id, booking_number, email, phone, first_name, service_type, service_date, time_slot, address, city, state, zip_code",
        )
        .eq("id", bookingId)
        .maybeSingle();
      if (bookingError) {
        console.warn("[send-cleaning-checklist] booking lookup failed", bookingError.message);
      }
      if (booking) {
        email = email || booking.email || "";
        phone = phone || booking.phone || "";
        firstName = firstName || booking.first_name || "";
        serviceType = (booking.service_type || serviceType || "standard").toLowerCase();
        bookingNumber = booking.booking_number ?? null;
        serviceDate = booking.service_date
          ? new Date(booking.service_date + "T00:00:00").toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            })
          : null;
        timeSlot = booking.time_slot || null;
        serviceAddress = [booking.address, booking.city, booking.state, booking.zip_code]
          .filter(Boolean)
          .join(", ") || null;
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

    // Resolve service-type-aware checklist content
    const checklistType = resolveChecklistType(serviceType);
    const content = CHECKLIST_BY_TYPE[checklistType] ?? CHECKLIST_BY_TYPE.standard;
    const viewUrl = checklistViewUrl(serviceType);

    // Idempotency: skip if we already sent this checklist kind for this booking.
    // Admin "force" resends bypass this (Quotes / CSR tooling).
    if (resolvedBookingId && !force && doEmail) {
      const { data: prior } = await supabase
        .from("booking_emails_sent")
        .select("id, sent_at")
        .eq("booking_id", resolvedBookingId)
        .eq("kind", content.emailKind)
        .maybeSingle();
      if (prior?.id) {
        console.log("[send-cleaning-checklist] already sent — skipping", {
          bookingId: resolvedBookingId,
          kind: content.emailKind,
          priorSentAt: prior.sent_at,
        });
        return new Response(
          JSON.stringify({ skipped: true, reason: "already-sent", priorSentAt: prior.sent_at, viewUrl }),
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
      const html = renderHtml({
        firstName,
        bookingNumber,
        serviceDate,
        timeSlot,
        serviceAddress,
        content,
        viewUrl,
      });
      const text = plainText({ firstName, content, viewUrl });

      const result = await resend.emails.send({
        from: "Novara Cleaning <hello@novaracleaning.com>",
        to: [email],
        subject: content.subject,
        html,
        text,
      });

      if (result?.error) {
        console.error("[send-cleaning-checklist] resend error", result.error);
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

      // Idempotency stamp — best-effort, doesn't block the response.
      if (resolvedBookingId) {
        try {
          await supabase.from("booking_emails_sent").insert({
            booking_id: resolvedBookingId,
            kind: content.emailKind,
            recipient_email: email,
            provider_message_id: messageId,
          });
        } catch (logErr) {
          console.warn("[send-cleaning-checklist] booking_emails_sent insert failed", logErr);
        }
      }
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
        data: {
          booking_id: resolvedBookingId,
          email: email || null,
          phone: phone || null,
          service_type: serviceType,
          checklist_type: checklistType,
          view_url: viewUrl,
          emailed,
          sms_sent: smsSent,
          force: Boolean(force),
        },
      });
    } catch {
      /* best-effort */
    }

    return new Response(
      JSON.stringify({
        success: true,
        bookingId: resolvedBookingId,
        messageId,
        emailed,
        smsSent,
        viewUrl,
        checklistType,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[send-cleaning-checklist]", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
