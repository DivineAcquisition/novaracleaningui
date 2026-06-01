import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import {
  activateTestimonialPromo,
  buildTestimonialCodeReadySms,
} from "../_shared/testimonial-offer.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const BUCKET = "testimonial-videos";

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
    const contentType = req.headers.get("content-type") || "";
    let token = "";
    let answerWhat = "";
    let answerResults = "";
    let answerRecommend = "";
    let videoUrl = "";
    let videoFile: File | null = null;

    if (contentType.includes("multipart/form-data")) {
      const form = await req.formData();
      token = String(form.get("token") || "");
      answerWhat = String(form.get("answerWhat") || "").trim();
      answerResults = String(form.get("answerResults") || "").trim();
      answerRecommend = String(form.get("answerRecommend") || "").trim();
      videoUrl = String(form.get("videoUrl") || "").trim();
      const file = form.get("video");
      if (file instanceof File && file.size > 0) videoFile = file;
    } else {
      const body = await req.json().catch(() => ({}));
      token = String((body as { token?: string })?.token || "");
      answerWhat = String((body as { answerWhat?: string })?.answerWhat || "").trim();
      answerResults = String((body as { answerResults?: string })?.answerResults || "").trim();
      answerRecommend = String((body as { answerRecommend?: string })?.answerRecommend || "").trim();
      videoUrl = String((body as { videoUrl?: string })?.videoUrl || "").trim();
    }

    if (!token) return json({ ok: false, reason: "missing_token" }, 400);
    if (!answerWhat || !answerResults || !answerRecommend) {
      return json({ ok: false, reason: "missing_answers" }, 400);
    }
    if (!videoFile && !videoUrl) {
      return json({ ok: false, reason: "missing_video" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const { data: offer } = await supabase
      .from("testimonial_offers")
      .select("*, bookings(phone, email, first_name)")
      .eq("submit_token", token)
      .maybeSingle();

    if (!offer) return json({ ok: false, reason: "not_found" }, 404);
    if (offer.status === "submitted") {
      return json({
        ok: true,
        alreadySubmitted: true,
        promoCode: offer.promo_code,
      });
    }

    if (videoFile) {
      const ext = (videoFile.name.split(".").pop() || "mp4").toLowerCase();
      const key = `${offer.id}/${Date.now()}.${ext}`;
      const bytes = new Uint8Array(await videoFile.arrayBuffer());
      const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, bytes, {
        contentType: videoFile.type || "video/mp4",
        upsert: true,
      });
      if (upErr) {
        return json({ ok: false, reason: "upload_failed", message: upErr.message }, 500);
      }
      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(key);
      videoUrl = pub.publicUrl;
    }

    const now = new Date().toISOString();
    await supabase
      .from("testimonial_offers")
      .update({
        status: "submitted",
        submitted_at: now,
        video_url: videoUrl,
        answer_what_stood_out: answerWhat,
        answer_results: answerResults,
        answer_recommend: answerRecommend,
      })
      .eq("id", offer.id);

    await activateTestimonialPromo(supabase, offer.promo_code);

    const booking = (offer as { bookings?: { phone?: string; email?: string; first_name?: string } })
      .bookings;
    const email = offer.customer_email;
    const firstName = offer.customer_first_name || booking?.first_name || null;

    const html = `
      <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;">
        <p>Hi ${firstName || "there"},</p>
        <p>Thank you for your video testimonial — we really appreciate it!</p>
        <p style="font-size:18px;"><strong>Your code for 50% off your next cleaning:</strong></p>
        <p style="font-size:24px;font-weight:700;letter-spacing:2px;color:#6d28d9;">${offer.promo_code}</p>
        <p>Enter this code at checkout on <a href="https://try.novaracleaning.com/book/zip">try.novaracleaning.com</a>. Valid for one-time use on your second cleaning.</p>
        <p>— Novara Cleaning</p>
      </div>
    `;

    try {
      await supabase.functions.invoke("admin-send-email", {
        body: {
          to: email,
          subject: `Your 50% off code: ${offer.promo_code}`,
          html,
        },
      });
    } catch (_) { /* non-blocking */ }

    const phone = booking?.phone;
    if (phone) {
      try {
        await supabase.functions.invoke("send-ghl-sms", {
          body: {
            phone,
            email,
            firstName,
            message: buildTestimonialCodeReadySms(firstName, offer.promo_code),
            type: "testimonial_code_ready",
          },
        });
      } catch (_) { /* non-blocking */ }
    }

    try {
      await supabase.from("events").insert({
        event_type: "testimonial.submitted",
        booking_id: offer.booking_id,
        source: "submit-testimonial",
        summary: `Testimonial video submitted — promo ${offer.promo_code}`,
        data: { promoCode: offer.promo_code, videoUrl },
      });
    } catch (_) { /* ignore */ }

    return json({ ok: true, promoCode: offer.promo_code, videoUrl });
  } catch (err) {
    return json(
      { ok: false, reason: "server_error", message: (err as Error).message },
      500,
    );
  }
});
