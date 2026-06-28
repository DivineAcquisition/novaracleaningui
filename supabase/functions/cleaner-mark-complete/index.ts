// ─── cleaner-mark-complete ─────────────────────────────────────────────────
//
// Lightweight "the cleaner finished the job" endpoint. This deliberately does
// NOT run the heavy completion flow that complete-booking does (no balance
// charge, no Stripe payout, no customer thank-you email/SMS, no testimonial
// offer, no Zapier/GHL "won" sync). Instead it:
//
//   1. Moves the booking into `pending_review` and stamps
//      cleaner_marked_complete_at / _by so it shows up in the admin Bookings
//      tab flagged for an admin to finalize.
//   2. Mints (idempotently) the public photo-upload token and texts the
//      cleaner the upload link EXACTLY ONCE (atomic claim on
//      photo_upload_sent_at) so the "submit your photos" SMS can never fire
//      multiple times.
//
// An admin then runs the real completion from the admin workspace, which calls
// complete-booking and triggers the charge + payout + customer comms.
//
// Auth: the assigned cleaner (cleanerId in the body, matched against
// bookings.cleaner_id — the public /contractor/jobs portal has no JWT) OR an
// admin/va. Mirrors complete-booking's auth model.
//
// Body: { bookingId, cleanerId? }
// Response: { ok, status, photoUploadToken, photoUploadUrl }

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
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const { bookingId, cleanerId } = await req.json();
    if (!bookingId) return json({ error: "bookingId required" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select(
        "id, status, cleaner_id, photo_upload_token, after_photo_link_sent_at",
      )
      .eq("id", bookingId)
      .single();
    if (fetchError || !booking) return json({ error: "Booking not found" }, 404);
    if (!booking.cleaner_id) return json({ error: "No cleaner assigned to this booking" }, 400);

    // ─── Authorization: admin/va OR the assigned cleaner ───────────────────
    let isAuthorized = false;
    let actingCleanerId: string | null = null;

    const authHeader = req.headers.get("Authorization");
    if (authHeader) {
      const token = authHeader.replace(/^Bearer\s+/i, "");
      const { data: userData } = await supabase.auth.getUser(token);
      const userId = userData?.user?.id ?? null;
      if (userId) {
        const { data: roleCheck } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", userId)
          .in("role", ["admin", "va"]);
        if (roleCheck && roleCheck.length > 0) {
          isAuthorized = true;
        } else {
          const { data: cleaner } = await supabase
            .from("cleaners")
            .select("id, user_id")
            .eq("id", booking.cleaner_id)
            .single();
          if (cleaner?.user_id === userId) {
            isAuthorized = true;
            actingCleanerId = cleaner.id;
          }
        }
      }
    }

    // Public contractor portal path: no JWT, verify cleanerId matches.
    if (!isAuthorized && cleanerId && cleanerId === booking.cleaner_id) {
      isAuthorized = true;
      actingCleanerId = cleanerId;
    }

    if (!isAuthorized) return json({ error: "Unauthorized" }, 403);

    // Already finalized — nothing to do, but return the upload link if present.
    if (booking.status === "completed") {
      return json({
        ok: true,
        status: "completed",
        alreadyCompleted: true,
        photoUploadToken: booking.photo_upload_token || null,
        photoUploadUrl: booking.photo_upload_token
          ? `https://contractor.novaracleaning.com/cleaner/job-photos/${booking.photo_upload_token}?phase=after`
          : null,
      });
    }

    // ─── Move to pending_review (admin finalizes from the admin workspace) ──
    await supabase
      .from("bookings")
      .update({
        status: "pending_review",
        cleaner_marked_complete_at: new Date().toISOString(),
        cleaner_marked_complete_by: actingCleanerId,
      })
      .eq("id", bookingId);

    await supabase.from("events").insert({
      event_type: "cleaner.marked_complete",
      booking_id: bookingId,
      source: "cleaner-mark-complete",
      summary: "Cleaner marked the job complete — awaiting admin review/finalization",
      data: { cleanerId: actingCleanerId },
    }).then(() => undefined, () => undefined);

    // ─── Photo-upload token + one-time SMS to the cleaner ──────────────────
    let photoUploadToken = booking.photo_upload_token as string | null;
    let photoUploadUrl: string | null = null;
    try {
      if (!photoUploadToken) {
        const bytes = new Uint8Array(20);
        crypto.getRandomValues(bytes);
        photoUploadToken = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
        await supabase
          .from("bookings")
          .update({ photo_upload_token: photoUploadToken })
          .eq("id", bookingId);
      }
      // The AFTER-photos link (before photos are requested before the job via
      // the day-of reminder).
      photoUploadUrl = `https://contractor.novaracleaning.com/cleaner/job-photos/${photoUploadToken}?phase=after`;

      const { data: cleaner } = await supabase
        .from("cleaners")
        .select("first_name, email, phone")
        .eq("id", booking.cleaner_id)
        .maybeSingle();

      if (cleaner?.phone) {
        // Atomic claim so the AFTER-photo SMS fires exactly once per booking.
        const { data: claimed } = await supabase
          .from("bookings")
          .update({ after_photo_link_sent_at: new Date().toISOString() })
          .eq("id", bookingId)
          .is("after_photo_link_sent_at", null)
          .select("id");
        if (Array.isArray(claimed) && claimed.length > 0) {
          const msg =
            `Novara: Job marked complete — thanks! Please upload your AFTER photos here so the office can finalize and release your payout:\n${photoUploadUrl}\n\nReply STOP to opt out.`;
          await supabase.functions.invoke("send-ghl-sms", {
            body: {
              phone: cleaner.phone,
              email: cleaner.email || undefined,
              firstName: cleaner.first_name || undefined,
              message: msg,
              type: "cleaner_photo_request",
            },
          }).then(() => undefined).catch(() => undefined);
        }
      }
    } catch (smsErr) {
      console.warn("[cleaner-mark-complete] photo link/SMS failed (non-blocking)", (smsErr as Error).message);
    }

    return json({
      ok: true,
      status: "pending_review",
      photoUploadToken,
      photoUploadUrl,
    });
  } catch (err) {
    return json({ error: (err as Error).message }, 500);
  }
});
