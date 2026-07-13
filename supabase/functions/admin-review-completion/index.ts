// admin-review-completion
//
// The REJECTION path for cleaner-submitted completions — previously the
// only options were "finalize" or "leave it in pending_review forever",
// with the cleaner never knowing anything was wrong.
//
// Body: { bookingId, action: "send_back", reason }
//   • bookings.status: pending_review → in_progress (the cleaner can fix
//     the issue and re-submit through the normal complete flow)
//   • the reason lands in dispatch_notes (visible in the contractor
//     portal's job details) and in the events audit trail
//   • every assigned crew member is texted the reason
//
// Admin/VA JWT required.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

// deno-lint-ignore no-explicit-any
type SB = any;

async function ensureAdminOrVa(admin: SB, req: Request): Promise<{ id: string; name: string }> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Not signed in.");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const ok = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!ok) throw new Error("Admins or VAs only.");
  return { id: u.user.id, name: String(u.user.user_metadata?.full_name || u.user.email || "Admin") };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const actor = await ensureAdminOrVa(admin, req);
    const body = await req.json().catch(() => ({}));
    const bookingId = String(body?.bookingId || "");
    const action = String(body?.action || "send_back");
    const reason = String(body?.reason || "").trim().slice(0, 500);

    if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);
    if (action !== "send_back") return json({ ok: false, error: `Unknown action '${action}'` }, 400);
    if (!reason) return json({ ok: false, error: "A reason is required — the cleaner needs to know what to fix." }, 400);

    const { data: booking } = await admin
      .from("bookings")
      .select("id, booking_number, status, cleaner_id, job_id, service_date, dispatch_notes")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return json({ ok: false, error: "Booking not found" }, 404);
    if (booking.status !== "pending_review") {
      return json({ ok: false, error: `Booking is '${booking.status}' — only pending_review submissions can be sent back.` }, 400);
    }

    const ref = booking.booking_number
      ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
      : bookingId.slice(0, 8);
    const stamp = new Date().toISOString().slice(0, 10);
    const note = `⚠️ SENT BACK ${stamp} by ${actor.name}: ${reason}`;

    const { error: upErr } = await admin
      .from("bookings")
      .update({
        status: "in_progress",
        dispatch_notes: booking.dispatch_notes ? `${note}\n${booking.dispatch_notes}` : note,
      })
      .eq("id", bookingId);
    if (upErr) throw upErr;

    // Keep the jobs/assignment rows consistent with "back in the field".
    if (booking.job_id) {
      await admin.from("jobs").update({ status: "In Progress" }).eq("id", booking.job_id)
        .then(() => undefined, () => undefined);
      await admin.from("job_assignments").update({ status: "In Progress" })
        .eq("job_id", booking.job_id).eq("status", "Completed")
        .then(() => undefined, () => undefined);
    }

    await admin.from("events").insert({
      event_type: "booking.completion_sent_back",
      booking_id: bookingId,
      source: "admin-review-completion",
      summary: `${actor.name} sent ${ref} back to the cleaner: "${reason}"`,
      data: { reason, by: actor.id },
    }).then(() => undefined, () => undefined);

    // Text every crew member what needs fixing.
    const crewIds = new Set<string>();
    if (booking.job_id) {
      const { data: assigns } = await admin
        .from("job_assignments")
        .select("cleaner_id, status")
        .eq("job_id", booking.job_id)
        .in("status", ["Confirmed", "Accepted", "In Progress", "Completed"]);
      for (const a of assigns || []) if (a.cleaner_id) crewIds.add(a.cleaner_id);
    }
    if (booking.cleaner_id) crewIds.add(booking.cleaner_id);
    let sent = 0;
    if (crewIds.size > 0) {
      const { data: crew } = await admin
        .from("cleaners").select("id, phone, first_name").in("id", [...crewIds]);
      for (const c of crew || []) {
        if (!c.phone) continue;
        const { error } = await admin.functions.invoke("send-ghl-sms", {
          body: {
            phone: c.phone,
            firstName: c.first_name || undefined,
            message:
              `Novara: The office reviewed ${ref} and it needs another pass before payout: "${reason}". ` +
              `The job is back in your Active list — fix it up and mark complete again. Reply STOP to opt out.`,
            type: "cleaner_completion_sent_back",
          },
        });
        if (!error) sent++;
      }
    }

    return json({ ok: true, status: "in_progress", smsSent: sent, crew: crewIds.size });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Not signed in") ? 401 : msg.includes("only") ? 403 : 500;
    return json({ ok: false, error: msg }, status);
  }
});
