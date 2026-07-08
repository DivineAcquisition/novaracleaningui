// ─── submit-cleaner-photos ────────────────────────────────────────────────
//
// Token-protected endpoint the public /cleaner/job-photos/[token] page
// POSTs to once the cleaner has uploaded their before/after photos to
// the cleaner-job-photos Storage bucket. We append the public URLs to
// bookings.before_photos / bookings.after_photos and stamp
// photo_upload_submitted_at.
//
// Once photos land, we mint a single-use customer view token and text/email
// the customer an open before/after gallery link (/photos/[token]) so they can
// see the proof of work without logging in. Sent exactly once per booking.
//
// Body: { token, beforeUrls?: string[], afterUrls?: string[], notes?, mode? }
// Response: { ok: true, beforeCount, afterCount, galleryUrl }
//
// mode: "save" — auto-save of in-progress uploads. The provided arrays are
// treated as the page's full current set and REPLACE the stored ones (so
// removing a photo sticks), photo_upload_submitted_at is NOT stamped, and no
// customer notification fires. This is the save system that lets a cleaner
// leave the page and come back later to add more photos without losing
// anything.
// mode omitted / "submit" — final submission: merge-union with stored photos
// (never destructive), stamp submitted_at, and fire the customer gallery
// exactly once when after photos are in.

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
    const isSave = String((body as any)?.mode || "") === "save";
    if (!isSave && beforeUrls.length === 0 && afterUrls.length === 0) {
      return json({ ok: false, reason: "no_photos" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: booking } = await supabase
      .from("bookings")
      .select(
        "id, before_photos, after_photos, team_notes, first_name, email, phone, service_date, photo_view_token, photo_view_sent_at",
      )
      .eq("photo_upload_token", token)
      .maybeSingle();
    if (!booking) return json({ ok: false, reason: "not_found" }, 404);

    // ─── SAVE MODE: persist progress, notify nobody ──────────────────────
    // The page auto-saves after every upload/removal. Arrays replace the
    // stored set (the page seeded itself from the stored set on load, so
    // its state IS the full picture — this is what makes photo removal
    // stick). No submitted stamp, no customer gallery.
    if (isSave) {
      await supabase
        .from("bookings")
        .update({ before_photos: beforeUrls, after_photos: afterUrls })
        .eq("id", booking.id);
      return json({ ok: true, saved: true, beforeCount: beforeUrls.length, afterCount: afterUrls.length });
    }

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
    }).then(() => undefined, () => undefined);

    // ─── Open before/after gallery for the customer ──────────────────────
    // Mint a single-use view token (idempotent) and text/email the customer
    // a login-free link to see the proof-of-work photos. We send exactly
    // once even if the cleaner submits photos again (multiple batches) or the
    // browser fires the request more than once.
    //
    // The "send once" guarantee relies on an ATOMIC claim of photo_view_sent_at
    // rather than the read-then-write check that used to live here: previously
    // we read photo_view_sent_at in the initial SELECT and only stamped it after
    // sending, so two near-simultaneous submissions both saw null and both
    // texted the customer. Now we stamp the row conditionally (only when it is
    // still null) and use the returned row count to decide whether *this*
    // invocation won the race and is therefore responsible for sending.
    //
    // The gallery only fires once AFTER photos exist — before-photos (uploaded
    // before the job starts) must not prematurely text the customer the
    // "your clean is done" gallery link. We require this submission to include
    // after photos, and that the booking now has at least one of each.
    const includesAfterPhotos = afterUrls.length > 0;
    const galleryReady = includesAfterPhotos && mergedAfter.length > 0;
    let galleryUrl: string | null = null;
    try {
      let viewToken = (booking as { photo_view_token?: string | null }).photo_view_token || null;
      if (!viewToken) {
        const bytes = new Uint8Array(20);
        crypto.getRandomValues(bytes);
        viewToken = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
        await supabase
          .from("bookings")
          .update({ photo_view_token: viewToken })
          .eq("id", booking.id);
      }
      galleryUrl = `https://try.novaracleaning.com/photos/${viewToken}`;

      // Atomically claim the single send. Only the invocation that flips
      // photo_view_sent_at from NULL → now() gets a row back here; all other
      // concurrent or repeat submissions get an empty result and skip sending.
      // We only attempt the claim once after photos are in.
      const { data: claimed } = galleryReady
        ? await supabase
            .from("bookings")
            .update({ photo_view_sent_at: new Date().toISOString() })
            .eq("id", booking.id)
            .is("photo_view_sent_at", null)
            .select("id")
        : { data: null };

      const wonClaim = Array.isArray(claimed) && claimed.length > 0;
      if (wonClaim) {
        const first = (booking as { first_name?: string | null }).first_name || "there";
        const phone = (booking as { phone?: string | null }).phone || null;
        const email = (booking as { email?: string | null }).email || null;

        if (phone) {
          const msg =
            `Novara Cleaning: Hi ${first}! Your clean is done — see the before & after photos here:\n${galleryUrl}\n\nReply STOP to opt out.`;
          await supabase.functions.invoke("send-ghl-sms", {
            body: { phone, email: email || undefined, firstName: first, message: msg, type: "customer_photo_gallery" },
          }).then(() => undefined).catch(() => undefined);
        }

        if (email) {
          await supabase.functions.invoke("send-booking-email", {
            body: {
              type: "photo_gallery",
              email,
              data: {
                firstName: first,
                bookingId: booking.id,
                serviceDate: (booking as { service_date?: string | null }).service_date,
                galleryUrl,
                beforeCount: mergedBefore.length,
                afterCount: mergedAfter.length,
              },
            },
          }).then(() => undefined).catch(() => undefined);
        }
      }
    } catch (notifyErr) {
      console.warn("[submit-cleaner-photos] gallery notify failed (non-blocking)", (notifyErr as Error).message);
    }

    return json({
      ok: true,
      beforeCount: mergedBefore.length,
      afterCount: mergedAfter.length,
      galleryUrl,
    });
  } catch (err) {
    return json(
      { ok: false, reason: "server_error", message: (err as Error).message },
      500,
    );
  }
});
