// Who is tracking time in Apploye right now, joined to Novara cleaners.
//
// The MCP does not expose live GPS. This returns clocked-in people so the
// admin map can list them. Coordinates stay null unless a future source
// actually has a position — a home address is not plotted as a live ping.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { projectLiveSessions } from "../_shared/apploye-attendance.ts";
import { callApployeTool, getMcpConfig } from "../_shared/apploye-mcp.ts";

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
    const cfg = await getMcpConfig(supabase);
    if (!cfg) {
      return json({
        ok: false,
        error: "Apploye not configured",
        details: "Set APPLOYE_MCP_API_KEY in app_secrets.",
      }, 503);
    }

    const sessions: ReturnType<typeof projectLiveSessions> = [];
    for (let page = 1; page <= 10; page++) {
      const payload = await callApployeTool(cfg, "list_live_tracking_members", { page, limit: 100 }) as {
        results?: unknown[];
        has_more?: boolean;
      };
      sessions.push(...projectLiveSessions(payload));
      if (!payload.has_more) break;
    }

    const memberIds = sessions.map((session) => session.memberId);
    const cleanersByMember: Record<string, { id: string; first_name: string | null; last_name: string | null }> = {};
    if (memberIds.length) {
      const { data: cleaners } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, apploye_member_id")
        .in("apploye_member_id", memberIds);
      for (const cleaner of cleaners || []) {
        if (cleaner.apploye_member_id) cleanersByMember[cleaner.apploye_member_id] = cleaner;
      }
    }

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const cleanerIds = Object.values(cleanersByMember).map((cleaner) => cleaner.id);
    const activeByCleaner: Record<string, { bookingId: string; bookingNumber: number | null }> = {};
    if (cleanerIds.length) {
      const { data: bookings } = await supabase
        .from("bookings")
        .select("id, booking_number, cleaner_id, service_date, status")
        .in("cleaner_id", cleanerIds)
        .eq("service_date", today)
        .in("status", ["assigned", "in_progress", "confirmed"]);
      for (const booking of bookings || []) {
        if (booking.cleaner_id && !activeByCleaner[booking.cleaner_id]) {
          activeByCleaner[booking.cleaner_id] = {
            bookingId: booking.id,
            bookingNumber: booking.booking_number,
          };
        }
      }
    }

    const members = sessions.map((session) => {
      const cleaner = cleanersByMember[session.memberId];
      const active = cleaner ? activeByCleaner[cleaner.id] : undefined;
      const cleanerName = cleaner
        ? `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || session.name
        : null;
      return {
        memberId: session.memberId,
        memberEmail: session.email,
        memberName: session.name,
        cleanerId: cleaner?.id || null,
        cleanerName,
        status: "clocked_in",
        startedAt: session.startedAt,
        endedAt: null,
        durationSec: null,
        lat: null,
        lng: null,
        pingedAt: session.startedAt,
        activeBookingId: active?.bookingId || null,
        activeBookingNumber: active?.bookingNumber || null,
      };
    });

    return json({
      ok: true,
      source: "mcp",
      updatedAt: new Date().toISOString(),
      activeCount: members.length,
      members,
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
