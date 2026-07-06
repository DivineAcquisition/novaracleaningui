// admin-submit-photos
//
// Admin/VA: submit before/after photos for a booking straight from the admin
// portal, without waiting on the contractor's SMS link. The admin uploads the
// image files to the public `cleaner-job-photos` Storage bucket from the
// browser (authenticated RLS policy allows this), then POSTs the resulting
// public URLs here.
//
// We ensure the booking has a photo_upload_token (minting one if needed) and
// then delegate to submit-cleaner-photos so the exact same append + customer
// before/after gallery flow runs — the admin upload is indistinguishable from a
// cleaner upload downstream.
//
// Body: { bookingId: string, beforeUrls?: string[], afterUrls?: string[], notes?: string }
// Response: { ok: true, beforeCount, afterCount, galleryUrl }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ ok: false, error: "Not signed in." }, 401);
    const callerId = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const bookingId = String((body as { bookingId?: string })?.bookingId || "");
    if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);

    const beforeUrls = Array.isArray((body as { beforeUrls?: unknown })?.beforeUrls)
      ? (body as { beforeUrls: unknown[] }).beforeUrls.filter((u) => typeof u === "string")
      : [];
    const afterUrls = Array.isArray((body as { afterUrls?: unknown })?.afterUrls)
      ? (body as { afterUrls: unknown[] }).afterUrls.filter((u) => typeof u === "string")
      : [];
    const notes = String((body as { notes?: string })?.notes || "").trim();
    if (beforeUrls.length === 0 && afterUrls.length === 0) {
      return json({ ok: false, error: "no_photos" }, 400);
    }

    // Ensure a photo_upload_token exists so we can reuse submit-cleaner-photos.
    const { data: booking } = await admin
      .from("bookings")
      .select("id, photo_upload_token")
      .eq("id", bookingId)
      .maybeSingle();
    if (!booking) return json({ ok: false, error: "Booking not found" }, 404);

    let token = booking.photo_upload_token as string | null;
    if (!token) {
      const bytes = new Uint8Array(20);
      crypto.getRandomValues(bytes);
      token = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
      await admin.from("bookings").update({ photo_upload_token: token }).eq("id", bookingId);
    }

    const { data: subRes, error: subErr } = await admin.functions.invoke("submit-cleaner-photos", {
      body: { token, beforeUrls, afterUrls, notes: notes || undefined },
    });
    if (subErr) throw new Error(subErr.message || "submit failed");
    const sr = subRes as { ok?: boolean; reason?: string };
    if (!sr?.ok) throw new Error(sr?.reason || "submit failed");

    await admin.from("events").insert({
      event_type: "admin.photos_submitted",
      booking_id: bookingId,
      source: "admin-submit-photos",
      summary: `Admin uploaded ${beforeUrls.length} before / ${afterUrls.length} after photos`,
      data: { beforeCount: beforeUrls.length, afterCount: afterUrls.length, by: callerId },
    }).then(() => undefined, () => undefined);

    return json({ ok: true, ...(subRes as Record<string, unknown>) });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-submit-photos]", msg);
    return json({ ok: false, error: msg }, 500);
  }
});
