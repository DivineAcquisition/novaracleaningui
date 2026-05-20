// ─── send-cleaning-checklist ─────────────────────────────────────────────
//
// Drops a standardized "what's included in your clean" email into the
// customer's inbox so they know exactly what the Novara team will and
// won't do on the visit. Two flavors:
//
//   POST { email, firstName?, serviceType: "standard" | "deep" | "moveInOut" }
//
// The function builds the HTML inline (no template repo dependency) and
// hands the payload to Resend with our standard sender identity. It's
// safe to call from any other edge function or directly from the admin
// tooling.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { Resend } from "https://esm.sh/resend@4.0.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const STANDARD_CHECKLIST: Array<{ room: string; tasks: string[] }> = [
  {
    room: "Whole Home",
    tasks: [
      "Dust + wipe all reachable horizontal surfaces (counters, dressers, shelves, picture frames, baseboards within reach)",
      "Vacuum carpets, area rugs, and upholstered furniture cushions",
      "Sweep + damp-mop hard floors (tile, hardwood, laminate, LVP)",
      "Empty trash bins and replace liners (we bring fresh bags)",
      "Spot-clean fingerprints from light switches, door frames, and door handles",
      "Wipe mirrors and interior glass with streak-free cleaner",
    ],
  },
  {
    room: "Kitchen",
    tasks: [
      "Wipe down all countertops, backsplash, and table surfaces",
      "Clean exterior of all appliances (fridge, oven, microwave, dishwasher)",
      "Wipe inside microwave",
      "Clean stovetop + drip pans (no heavy degrease — add-on for that)",
      "Wipe + sanitize sink and faucet",
      "Wipe outside of cabinet doors (no inside-cabinet detailing on Standard)",
      "Sweep + mop floor",
    ],
  },
  {
    room: "Bathrooms",
    tasks: [
      "Scrub + sanitize toilets (bowl, seat, lid, base)",
      "Scrub showers, tubs, and surrounding tile",
      "Wipe + polish sinks and vanity counters",
      "Polish faucets and chrome fixtures",
      "Clean mirrors",
      "Wipe outside of cabinets and drawers",
      "Sweep + mop floor",
      "Empty bathroom trash",
    ],
  },
  {
    room: "Bedrooms + Living Areas",
    tasks: [
      "Make beds (with linens already on; we don't change sheets unless requested)",
      "Dust nightstands, dressers, headboards, and TV stands",
      "Wipe inside windowsills",
      "Vacuum carpets + under reachable furniture",
      "Tidy visible clutter onto a flat surface (we don't reorganize personal items)",
    ],
  },
];

const NOT_INCLUDED = [
  "Inside oven, inside fridge, inside cabinets, inside windows (these are add-ons — let us know in advance!)",
  "Heavy-grease degreasing, mold remediation, or biohazard cleanup",
  "Laundry, dishes, ironing, pet waste",
  "Moving heavy furniture (we clean around large pieces — please move first if you want under them)",
  "Exterior windows, balconies, or anything outdoors",
  "Wall washing, ceiling fans above 10 ft, or any task requiring a ladder taller than a 2-step",
];

const PREP_TIPS = [
  "Pick up any small valuables, breakables, or jewelry you'd rather we not handle.",
  "If you have pets, please secure them in a safe area while the team is working.",
  "Let us know about any sensitive surfaces (natural stone, antique wood, framed art) so we use the right cleaner.",
  "Make sure the cleaners can park nearby — most homes have a 60-minute window from arrival to start.",
];

function renderHtml(opts: { firstName: string }): string {
  const checklistHtml = STANDARD_CHECKLIST
    .map(
      (group) => `
    <h3 style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;font-size:16px;margin:24px 0 8px;color:#2D1B69">${group.room}</h3>
    <ul style="margin:0;padding-left:20px;color:#3F3D56;font-size:14px;line-height:1.6">
      ${group.tasks.map((t) => `<li>${t}</li>`).join("")}
    </ul>`,
    )
    .join("");

  const notIncluded = `
    <ul style="margin:0;padding-left:20px;color:#3F3D56;font-size:14px;line-height:1.6">
      ${NOT_INCLUDED.map((t) => `<li>${t}</li>`).join("")}
    </ul>`;

  const prepTips = `
    <ul style="margin:0;padding-left:20px;color:#3F3D56;font-size:14px;line-height:1.6">
      ${PREP_TIPS.map((t) => `<li>${t}</li>`).join("")}
    </ul>`;

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Your Standard Clean Checklist</title></head>
<body style="margin:0;padding:0;background:#F8F6FF;font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;color:#3F3D56">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F8F6FF;padding:32px 16px">
    <tr><td align="center">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(45,27,105,0.08)">
        <tr><td style="background:linear-gradient(135deg,#7B5DE8 0%,#A77DFF 100%);padding:32px 32px 24px;color:#ffffff">
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;letter-spacing:-0.01em">Your Standard Clean — what to expect</h1>
          <p style="margin:0;font-size:14px;opacity:0.95">Hi ${
    opts.firstName || "there"
  } — here's exactly what the Novara team will do on your visit. Save this email so you know what's included (and what's an add-on).</p>
        </td></tr>
        <tr><td style="padding:24px 32px">
          <h2 style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;font-size:18px;margin:0 0 4px;color:#2D1B69">What's included</h2>
          <p style="margin:0 0 8px;font-size:13px;color:#7C7993">Every standard cleaning covers the following, top to bottom.</p>
          ${checklistHtml}

          <hr style="border:none;border-top:1px solid #EDE9FE;margin:32px 0" />

          <h2 style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;font-size:18px;margin:0 0 4px;color:#2D1B69">Not included on Standard</h2>
          <p style="margin:0 0 8px;font-size:13px;color:#7C7993">These need an upgrade to Deep Clean or a specific add-on — reply to this email or text us at +1 (844) 735-2070 and we'll add it.</p>
          ${notIncluded}

          <hr style="border:none;border-top:1px solid #EDE9FE;margin:32px 0" />

          <h2 style="font-family:'Plus Jakarta Sans',Helvetica,Arial,sans-serif;font-size:18px;margin:0 0 4px;color:#2D1B69">Day-of prep tips</h2>
          ${prepTips}
        </td></tr>
        <tr><td style="background:#F8F6FF;padding:20px 32px;text-align:center;font-size:12px;color:#7C7993">
          Novara Cleaning &middot; hello@novaracleaning.com &middot; +1 (844) 735-2070<br/>
          Reply to this email any time — we love hearing from members.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const { email, firstName, serviceType = "standard" } = await req.json();
    if (!email) {
      return new Response(JSON.stringify({ error: "email required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }
    if (serviceType !== "standard") {
      // V1 ships the standard-clean checklist. Deep + move-in/out
      // checklists can be added later without touching the rest of
      // the wiring.
      return new Response(
        JSON.stringify({ skipped: true, reason: "only-standard-supported" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    const resend = new Resend(Deno.env.get("RESEND_API_KEY") || "");
    const html = renderHtml({ firstName: firstName || "" });
    const result = await resend.emails.send({
      from: "Novara Cleaning <hello@novaracleaning.com>",
      to: [email],
      subject: "Your Novara Standard Clean — what's included ✨",
      html,
    });

    return new Response(
      JSON.stringify({ success: true, messageId: result }),
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
