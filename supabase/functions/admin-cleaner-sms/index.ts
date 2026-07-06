// admin-cleaner-sms
//
// Admin/VA: send an SMS to a contractor (cleaner) for ops workflows -
// photo-submission requests, dashboard nudges, or a free-text custom message.
// Routes through send-ghl-sms (GHL primary, Telnyx fallback). Mints/reuses a
// booking's photo_upload_token for the photo_request template. Audited to events.
//
// Body: { cleanerId: string, template?: "photo_request"|"mobile_dashboard"|"custom",
//         message?: string, bookingId?: string }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CONTRACTOR = "https://contractor.novaracleaning.com";

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, jwt: string): Promise<string> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
  return u.user.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const callerId = await ensureAdminOrVa(admin, jwt);

    const body = await req.json();
    const cleanerId = String(body.cleanerId || "");
    const template = String(body.template || "custom");
    let bookingId = body.bookingId ? String(body.bookingId) : "";
    if (!cleanerId) return json({ error: "cleanerId required" }, 400);

    const { data: cleaner } = await admin.from("cleaners").select("id, first_name, phone, email").eq("id", cleanerId).maybeSingle();
    if (!cleaner) return json({ error: "Cleaner not found" }, 404);
    if (!cleaner.phone) return json({ error: "Cleaner has no phone on file" }, 400);

    let message = String(body.message || "").trim();

    if (template === "photo_request") {
      if (!bookingId) return json({ error: "bookingId required for photo_request" }, 400);
      const { data: booking } = await admin.from("bookings").select("id, photo_upload_token, service_date").eq("id", bookingId).maybeSingle();
      if (!booking) return json({ error: "Booking not found" }, 404);
      let token = booking.photo_upload_token as string | null;
      if (!token) {
        token = crypto.randomUUID().replace(/-/g, "");
        await admin.from("bookings").update({ photo_upload_token: token, photo_upload_sent_at: new Date().toISOString() }).eq("id", bookingId);
      } else {
        await admin.from("bookings").update({ photo_upload_sent_at: new Date().toISOString() }).eq("id", bookingId);
      }
      const url = `${CONTRACTOR}/cleaner/job-photos/${token}`;
      message = `Novara: Please upload your before & after photos for this job so we can wrap it up and release your payout:\n${url}\n\nReply STOP to opt out.`;
    } else if (template === "mobile_dashboard") {
      message = message || `Novara: Please open your cleaner dashboard for job details and updates:\n${CONTRACTOR}/cleaner/mobile-dashboard`;
    } else {
      // custom
      if (!message) return json({ error: "message required" }, 400);
    }

    const { data: smsRes, error: smsErr } = await admin.functions.invoke("send-ghl-sms", {
      body: {
        phone: cleaner.phone,
        email: cleaner.email || undefined,
        firstName: cleaner.first_name || undefined,
        message,
        type: "admin_cleaner_sms",
      },
    });
    const failed = smsErr || (smsRes && (smsRes as { error?: string }).error);
    if (failed) return json({ error: `SMS send failed: ${typeof failed === "string" ? failed : JSON.stringify(failed)}` }, 502);

    await admin.from("events").insert({
      event_type: "cleaner.admin_sms",
      cleaner_id: cleanerId,
      booking_id: bookingId || null,
      source: "admin",
      summary: `Admin SMS (${template}) to ${cleaner.first_name || "cleaner"}`,
      data: { template, by: callerId, preview: message.slice(0, 180) },
    }).then(() => undefined, () => undefined);

    return json({ ok: true, sent: true, template, message });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-cleaner-sms]", msg);
    return json({ error: msg }, 500);
  }
});
