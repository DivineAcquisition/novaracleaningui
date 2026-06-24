import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.80.0";

// admin-modify-booking
//
// Admin/VA adjusts a booking's SERVICE (service type, home size, add-ons,
// bed/bath) from the Bookings tab. Unlike cancel/delete, the customer IS
// notified — via SMS AND email — about the change. Pricing is authoritative
// from the admin UI (it uses the same src/lib/pricing the customer sees), so
// this function trusts the supplied totalEstimateCents and records it.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};

const SUPPORT_PHONE_DISPLAY = "(844) 735-2070";
const SERVICE_LABELS: Record<string, string> = {
  standard: "Standard Clean",
  deep: "Deep Clean",
  combo: "Deep + Standard Combo",
  moveInOut: "Move-In / Move-Out Clean",
};

// deno-lint-ignore no-explicit-any
async function sendSms(admin: any, toPhone: string | null | undefined, message: string) {
  const phone = (toPhone || "").toString().trim();
  if (!phone || !message.trim()) return false;
  try {
    const { data, error } = await admin.functions.invoke("send-ghl-sms", {
      body: { phone, message, type: "confirmation" },
    });
    if (!error && !(data && data.error)) return true;
  } catch (_) { /* fall through */ }
  try {
    const { error } = await admin.functions.invoke("send-sms-notification", {
      body: { toPhone: phone, message, type: "confirmation" },
    });
    return !error;
  } catch (_) {
    return false;
  }
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, req: Request): Promise<string> {
  const auth = req.headers.get("Authorization");
  if (!auth) throw new Error("Admin authorization required");
  const token = auth.replace(/^Bearer\s+/i, "");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } },
  );
  const { data: u } = await userClient.auth.getUser(token);
  if (!u?.user?.id) throw new Error("Not signed in");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only");
  return u.user.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const actorId = await ensureAdminOrVa(admin, req);
    const body = await req.json();
    const { bookingId, serviceType, homeSizeId, addOns, bedrooms, bathrooms, dwellingType, totalEstimateCents } = body;
    if (!bookingId) throw new Error("bookingId is required");

    const { data: booking, error: bErr } = await admin
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .single();
    if (bErr || !booking) throw new Error("Booking not found");
    if (booking.status === "cancelled") throw new Error("Cannot modify a cancelled booking");
    if (booking.status === "completed") throw new Error("Cannot modify a completed booking");

    const newServiceType = serviceType || booking.service_type;
    const newHomeSize = homeSizeId || booking.home_size_id;
    const newAddOns = Array.isArray(addOns) ? addOns : (booking.add_ons || []);
    const newTotalCents = Number.isFinite(totalEstimateCents)
      ? Math.round(totalEstimateCents)
      : booking.total_estimate_cents;

    const update: Record<string, unknown> = {
      service_type: newServiceType,
      home_size_id: newHomeSize,
      add_ons: newAddOns,
      total_estimate_cents: newTotalCents,
      updated_at: new Date().toISOString(),
    };
    if (bedrooms !== undefined && bedrooms !== null) update.bedrooms = bedrooms;
    if (bathrooms !== undefined && bathrooms !== null) update.bathrooms = bathrooms;
    if (dwellingType !== undefined && dwellingType !== null) update.dwelling_type = dwellingType;

    const { error: upErr } = await admin.from("bookings").update(update).eq("id", bookingId);
    if (upErr) throw upErr;

    console.log("[admin-modify-booking] updated", { bookingId, actorId, newServiceType, newHomeSize, newTotalCents });

    // ── Notify the customer (SMS + email) ─────────────────────────────
    const svcLabel = SERVICE_LABELS[newServiceType] || newServiceType;
    const dollars = `$${(Math.max(0, newTotalCents) / 100).toFixed(2)}`;
    const dateLabel = booking.service_date
      ? new Date(`${booking.service_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
      : "your scheduled date";

    try {
      await sendSms(
        admin,
        booking.phone,
        `Novara Cleaning: Your cleaning${booking.service_date ? ` on ${dateLabel}` : ""} has been updated to ${svcLabel}. ` +
          `Updated total: ${dollars}. Questions? Call ${SUPPORT_PHONE_DISPLAY}.`,
      );
      console.log("[admin-modify-booking] customer SMS sent");
    } catch (e) {
      console.error("[admin-modify-booking] SMS failed (non-blocking):", e);
    }

    try {
      await admin.functions.invoke("send-booking-email", {
        body: {
          email: booking.email,
          type: "modification",
          bookingData: {
            ...booking,
            service_type: newServiceType,
            home_size_id: newHomeSize,
            add_ons: newAddOns,
            total_estimate_cents: newTotalCents,
          },
        },
      });
      console.log("[admin-modify-booking] customer email sent");
    } catch (e) {
      console.error("[admin-modify-booking] email failed (non-blocking):", e);
    }

    // ── Sync the change to GHL (+ Airtable + LeadConnector) ───────────
    try {
      await admin.functions.invoke("send-zapier-webhook", { body: { bookingId } });
      console.log("[admin-modify-booking] GHL sync triggered");
    } catch (e) {
      console.error("[admin-modify-booking] GHL sync failed (non-critical):", e);
    }

    return new Response(
      JSON.stringify({ success: true, bookingId, totalEstimateCents: newTotalCents }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[admin-modify-booking] ERROR", msg);
    return new Response(
      JSON.stringify({ success: false, error: msg }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 400 },
    );
  }
});
