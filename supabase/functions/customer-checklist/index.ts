// ─── customer-checklist ─────────────────────────────────────────────────
//
// Public, token-gated read for the customer's own checklist page
// (/my-checklist/<token>). The token is minted when the booking is
// confirmed (send-cleaning-checklist) and is the only credential: it
// resolves to exactly one booking, and the page is built live from that
// booking. No email, phone, or payment detail is returned.
//
//   POST { token } -> { ok: true, checklist, status } | { ok: false, reason }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { buildPersonalChecklist, checklistViewState } from "../_shared/customer-checklists.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
    status,
  });
}

const BOOKING_COLUMNS =
  "id, status, booking_number, first_name, service_type, scope_level, service_date, time_slot, arrival_window, address, city, state, bedrooms, bathrooms, dwelling_type, frequency, add_ons, pets, access_notes";

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const token = String((body as { token?: string }).token || new URL(req.url).searchParams.get("token") || "").trim();
    if (!/^[A-Za-z0-9_-]{16,128}$/.test(token)) return json({ ok: false, reason: "not_found" }, 404);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: session } = await supabase
      .from("customer_checklist_sessions")
      .select("id, booking_id, revoked_at, view_count, first_viewed_at")
      .eq("token", token)
      .maybeSingle();
    if (!session || session.revoked_at) return json({ ok: false, reason: "not_found" }, 404);

    const { data: booking } = await supabase
      .from("bookings")
      .select(BOOKING_COLUMNS)
      .eq("id", session.booking_id)
      .maybeSingle();
    if (!booking) return json({ ok: false, reason: "not_found" }, 404);

    const state = checklistViewState(booking);
    if (state !== "ok") return json({ ok: false, reason: state }, 410);

    const now = new Date().toISOString();
    await supabase
      .from("customer_checklist_sessions")
      .update({
        view_count: Number(session.view_count || 0) + 1,
        first_viewed_at: session.first_viewed_at || now,
        last_viewed_at: now,
      })
      .eq("id", session.id);

    return json({ ok: true, checklist: buildPersonalChecklist(booking), status: booking.status });
  } catch (error) {
    return json({ ok: false, reason: "server_error", message: error instanceof Error ? error.message : String(error) }, 500);
  }
});
