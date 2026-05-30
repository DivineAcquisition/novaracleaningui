// ─── apploye-live-tracking ───────────────────────────────────────────────
//
// Apploye's PUBLIC API does NOT expose live GPS pings (that lives in
// the dashboard only). What we CAN derive is "who is currently
// tracking time" by looking at today's timesheets and flagging rows
// that have a `started_at` within the last 12 hours and no `ended_at`.
//
// We then join those active timesheets back to our `cleaners` table
// via the apploye_member_id link so the admin Map can colour-code
// pins for "currently clocked in" vs "off the clock".
//
// Response:
// {
//   ok: true,
//   updatedAt,
//   activeCount,
//   members: Array<{
//     memberId, memberEmail, cleanerId, cleanerName,
//     status: 'clocked_in' | 'clocked_out',
//     startedAt, endedAt, durationSec,
//     lat: null, lng: null,                  // GPS not exposed publicly
//     activeBookingId?, activeBookingNumber?
//   }>
// }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  getApployeConfig,
  listMembers,
  listTimesheets,
} from "../_shared/apploye-client.ts";

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
        details: "Set APPLOYE_API_KEY in app_secrets.",
      }, 503);
    }

    const now = new Date();
    const startIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const endIso = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
    const [members, timesheets] = await Promise.all([
      listMembers(cfg),
      listTimesheets(cfg, startIso, endIso),
    ]);

    const memberById: Record<string, typeof members[0]> = {};
    for (const m of members) memberById[m.id] = m;

    // Resolve cleaners linked to these Apploye members.
    const linkedMemberIds = members.map((m) => m.id);
    const cleanersByMember: Record<string, { id: string; first_name: string | null; last_name: string | null }> = {};
    if (linkedMemberIds.length > 0) {
      const { data: cs } = await supabase
        .from("cleaners")
        .select("id, first_name, last_name, apploye_member_id")
        .in("apploye_member_id", linkedMemberIds);
      for (const c of cs || []) {
        if (c.apploye_member_id) {
          cleansersByMember(cleanersByMember, c);
        }
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

    // Map every linked Apploye member to a tracking row (active or not).
    const result = members.map((m) => {
      const cleaner = cleanersByMember[m.id];
      const active = cleaner ? activeByCleaner[cleaner.id] : undefined;
      const latestSheet = timesheets
        .filter((t) => t.userId === m.id)
        .sort((a, b) => new Date(b.startedAt || 0).getTime() - new Date(a.startedAt || 0).getTime())[0];
      const isActive = latestSheet?.isActive || false;
      return {
        memberId: m.id,
        memberEmail: m.email,
        memberName: m.email,
        cleanerId: cleaner?.id || null,
        cleanerName: cleaner
          ? `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim() || m.email
          : null,
        status: isActive ? "clocked_in" : "clocked_out",
        startedAt: latestSheet?.startedAt || null,
        endedAt: latestSheet?.endedAt || null,
        durationSec: latestSheet?.durationSec || null,
        // Public API doesn't expose live coords — leave nullable so the
        // admin Map plots cleaners at their home_lat/lng when active.
        lat: null,
        lng: null,
        pingedAt: latestSheet?.startedAt || null,
        activeBookingId: active?.bookingId || null,
        activeBookingNumber: active?.bookingNumber || null,
      };
    });

    return json({
      ok: true,
      updatedAt: new Date().toISOString(),
      activeCount: result.filter((r) => r.status === "clocked_in").length,
      members: result,
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});

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
