// ─── apploye-live-tracking ───────────────────────────────────────────────
//
// Returns the latest GPS ping for every Apploye member in the workspace,
// joined with the matching `cleaners` row so the admin map can label
// the pin with the cleaner's name + assigned booking.
//
// Body: { } (no input — workspace-wide pull)
// Response: {
//   ok: true,
//   updatedAt,
//   members: Array<{
//     memberId, cleanerId, cleanerName, status, lat, lng, pingedAt,
//     activeBookingId?, activeBookingNumber?
//   }>
// }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { getApployeConfig, fetchLiveGps } from "../_shared/apploye-client.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const cfg = await getApployeConfig(supabase);
    if (!cfg) {
      return json({
        ok: false,
        error: "Apploye not configured",
        details:
          "Set APPLOYE_API_KEY and APPLOYE_WORKSPACE_ID in app_secrets.",
      }, 503);
    }

    const pings = await fetchLiveGps(cfg);
    const memberIds = pings.map((p) => p.memberId).filter(Boolean);

    const cleanersByMember: Record<string, { id: string; first_name: string | null; last_name: string | null }> = {};
    if (memberIds.length > 0) {
      const { data: cs } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, apploye_member_id")
        .in("apploye_member_id", memberIds);
      for (const c of cs || []) {
        cleansersByMember(cleanersByMember, c);
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const cleanerIds = Object.values(cleanersByMember).map((c) => c.id);
    const activeByCleaner: Record<string, { bookingId: string; bookingNumber: number | null }> = {};
    if (cleanerIds.length > 0) {
      const { data: bks } = await supabase
        .from("bookings")
        .select("id, booking_number, cleaner_id, service_date, status")
        .in("cleaner_id", cleanerIds)
        .eq("service_date", today)
        .in("status", ["assigned", "in_progress", "confirmed"]);
      for (const b of bks || []) {
        if (b.cleaner_id) {
          activeByCleaner[b.cleaner_id] = {
            bookingId: b.id,
            bookingNumber: b.booking_number,
          };
        }
      }
    }

    const members = pings.map((p) => {
      const cleaner = cleanersByMember[p.memberId];
      const active = cleaner ? activeByCleaner[cleaner.id] : undefined;
      return {
        memberId: p.memberId,
        memberName: p.memberName,
        cleanerId: cleaner?.id || null,
        cleanerName: cleaner
          ? `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || null
          : null,
        status: p.status,
        lat: p.lat,
        lng: p.lng,
        pingedAt: p.pingedAt,
        activeBookingId: active?.bookingId || null,
        activeBookingNumber: active?.bookingNumber || null,
      };
    });

    return json({ ok: true, updatedAt: new Date().toISOString(), members });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

// Helper: keyed assignment kept out of the main flow so the file stays
// readable.
function cleansersByMember(
  map: Record<string, { id: string; first_name: string | null; last_name: string | null }>,
  c: { id: string; first_name: string | null; last_name: string | null; apploye_member_id: string | null },
) {
  if (c.apploye_member_id) {
    map[c.apploye_member_id] = {
      id: c.id,
      first_name: c.first_name,
      last_name: c.last_name,
    };
  }
}
