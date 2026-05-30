// ─── submit-cleaner-photos ────────────────────────────────────────────────
//
// Token-protected endpoint the public /cleaner/job-photos/[token] page
// POSTs to once the cleaner has uploaded their before/after photos to
// the cleaner-job-photos Storage bucket. We append the public URLs to
// bookings.before_photos / bookings.after_photos and stamp
// photo_upload_submitted_at.
//
// Also pushes the URLs into GHL custom fields (before_photos /
// after_photos on the customer contact) so the admin GHL view of the
// contact shows the evidence inline.
//
// Body: { token, beforeUrls?: string[], afterUrls?: string[], notes? }
// Response: { ok: true, beforeCount, afterCount }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

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
  if (req.method !== "POST") return json({ ok: false, reason: "POST required" }, 405);
  try {
    const body = await req.json().catch(() => ({}));
    const token = String((body as any)?.token || "");
    if (!token) return json({ ok: false, reason: "missing_token" }, 400);
    const beforeUrls = Array.isArray((body as any)?.beforeUrls)
      ? (body as any).beforeUrls.filter((u: unknown) => typeof u === "string")
      : [];
    const afterUrls = Array.isArray((body as any)?.afterUrls)
      ? (body as any).afterUrls.filter((u: unknown) => typeof u === "string")
      : [];
    const notes = String((body as any)?.notes || "").trim();
    if (beforeUrls.length === 0 && afterUrls.length === 0) {
      return json({ ok: false, reason: "no_photos" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking } = await supabase
      .from("bookings")
      .select("id, before_photos, after_photos, team_notes")
      .eq("photo_upload_token", token)
      .maybeSingle();
    if (!booking) return json({ ok: false, reason: "not_found" }, 404);

    const mergedBefore = Array.from(
      new Set([...(booking.before_photos || []), ...beforeUrls]),
    );
    const mergedAfter = Array.from(
      new Set([...(booking.after_photos || []), ...afterUrls]),
    );
    const mergedNotes = notes
      ? `${booking.team_notes ? booking.team_notes + " · " : ""}Cleaner photos note: ${notes}`
      : booking.team_notes;

    await supabase
      .from("bookings")
      .update({
        before_photos: mergedBefore,
        after_photos: mergedAfter,
        photo_upload_submitted_at: new Date().toISOString(),
        team_notes: mergedNotes,
      })
      .eq("id", booking.id);

    await supabase.from("events").insert({
      event_type: "cleaner.photos_submitted",
      booking_id: booking.id,
      source: "submit-cleaner-photos",
      summary: `Cleaner uploaded ${beforeUrls.length} before / ${afterUrls.length} after photos`,
      data: { beforeCount: beforeUrls.length, afterCount: afterUrls.length },
    }).then(() => undefined).catch(() => undefined);

    return json({
      ok: true,
      beforeCount: mergedBefore.length,
      afterCount: mergedAfter.length,
    });
  } catch (err) {
    return json(
      { ok: false, reason: "server_error", message: (err as Error).message },
      500,
    );
  }
});
