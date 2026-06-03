// ─── store-service-agreement ────────────────────────────────────────────────
//
// Receives a customer's signed One-Time Service Agreement (generated in the
// browser), stores the PDF in the private service-agreements bucket, records
// the acceptance in public.service_agreements, and emails a copy to the
// customer so they ALWAYS receive their agreement with their details mapped.
//
// Body: {
//   bookingId?, email, name, serviceType?, source?,
//   agreed: { terms, disclaimer, refund, serviceAgreement },
//   pdfBase64
// }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const log = (s: string, d?: unknown) =>
  console.log(`[store-service-agreement] ${s}${d ? " " + JSON.stringify(d) : ""}`);

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const email = String(body?.email || "").trim().toLowerCase();
    const name = String(body?.name || "").trim();
    const bookingId = body?.bookingId ? String(body.bookingId) : null;
    const serviceType = body?.serviceType ? String(body.serviceType) : null;
    const source = String(body?.source || "checkout");
    const agreed = body?.agreed || {};
    const pdfBase64 = String(body?.pdfBase64 || "");

    if (!email.includes("@")) return json({ error: "email required" }, 400);
    if (!pdfBase64) return json({ error: "pdfBase64 required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // Insert the acceptance record first to get an id for the file path.
    const { data: row, error: insErr } = await supabase
      .from("service_agreements")
      .insert({
        booking_id: bookingId,
        customer_email: email,
        customer_name: name || null,
        agreed_terms: Boolean(agreed?.terms),
        agreed_disclaimer: Boolean(agreed?.disclaimer),
        agreed_refund: Boolean(agreed?.refund),
        agreed_service_agreement: Boolean(agreed?.serviceAgreement),
        signed_by: name || null,
        source,
        ip: req.headers.get("x-forwarded-for") || null,
        user_agent: req.headers.get("user-agent") || null,
      })
      .select("id")
      .single();
    if (insErr) throw insErr;

    const agreementId = row.id as string;
    const bytes = Uint8Array.from(atob(pdfBase64), (c) => c.charCodeAt(0));
    const path = `${(bookingId || email).replace(/[^a-zA-Z0-9._@-]/g, "_")}/${agreementId}.pdf`;

    const { error: upErr } = await supabase.storage
      .from("service-agreements")
      .upload(path, bytes, { contentType: "application/pdf", upsert: true });
    if (upErr) {
      log("storage upload failed", { error: upErr.message });
    } else {
      await supabase.from("service_agreements").update({ pdf_path: path }).eq("id", agreementId);
    }

    // Email a copy to the customer (best-effort, always attempted).
    try {
      const firstName = name.split(/\s+/)[0] || "there";
      const html =
        `<div style="font-family:'Plus Jakarta Sans',Arial,sans-serif;max-width:560px;margin:0 auto;color:#1e1b2e">` +
        `<h2 style="color:#7C3AED;margin:0 0 8px">Your Novara Cleaning Service Agreement</h2>` +
        `<p>Hi ${firstName}, thanks for booking with Novara Cleaning. Your signed One-Time Service ` +
        `Agreement is attached for your records. It reflects the details you entered at checkout.</p>` +
        `<p style="color:#555;font-size:13px">Terms of Service: https://novaracleaning.com/terms · ` +
        `Disclaimer: https://novaracleaning.com/disclaimer · Refund Policy: https://novaracleaning.com/refund-policy</p>` +
        `<p style="color:#7C3AED;font-weight:600">— Novara Cleaning</p></div>`;
      await supabase.functions.invoke("admin-send-email", {
        body: {
          to: email,
          subject: "Your Novara Cleaning Service Agreement",
          html,
          attachments: [{ filename: "Novara-Service-Agreement.pdf", content: pdfBase64 }],
        },
      });
    } catch (mailErr) {
      log("email copy failed (non-blocking)", {
        error: mailErr instanceof Error ? mailErr.message : String(mailErr),
      });
    }

    return json({ ok: true, id: agreementId, path });
  } catch (e) {
    log("ERROR", { error: e instanceof Error ? e.message : String(e) });
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
