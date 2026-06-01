/**
 * Post-clean testimonial video offer — 50% off the customer's 2nd clean
 * after they submit a short video + answer three prompts.
 */

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

export const TESTIMONIAL_QUESTIONS = [
  "What made you choose Novara Cleaning (or what stood out about your experience)?",
  "How would you describe your home after the clean — what results mattered most to you?",
  "Would you recommend us to a friend or neighbor? Why or why not?",
] as const;

const SITE_BASE = "https://try.novaracleaning.com";

function randomToken(bytes = 20): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function randomPromoSuffix(len = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const arr = new Uint8Array(len);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => chars[b % chars.length]).join("");
}

export function buildTestimonialPromoCode(): string {
  return `VID-${randomPromoSuffix(8)}`;
}

export type TestimonialOfferRow = {
  id: string;
  booking_id: string;
  customer_email: string;
  customer_first_name: string | null;
  promo_code: string;
  submit_token: string;
  status: string;
  offer_sent_at: string | null;
};

export async function ensureTestimonialOffer(
  supabase: SupabaseClient,
  booking: {
    id: string;
    email: string;
    first_name?: string | null;
  },
): Promise<TestimonialOfferRow> {
  const { data: existing } = await supabase
    .from("testimonial_offers")
    .select("*")
    .eq("booking_id", booking.id)
    .maybeSingle();

  if (existing) return existing as TestimonialOfferRow;

  const promoCode = buildTestimonialPromoCode();
  const submitToken = randomToken(20);
  const email = booking.email.trim().toLowerCase();

  const { data: inserted, error } = await supabase
    .from("testimonial_offers")
    .insert({
      booking_id: booking.id,
      customer_email: email,
      customer_first_name: booking.first_name || null,
      promo_code: promoCode,
      submit_token: submitToken,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) throw error;

  const { error: promoErr } = await supabase.from("promo_codes").insert({
    code: promoCode,
    type: "percent",
    value: 50,
    active: false,
    applies_to: "testimonial_second_clean",
    max_uses_per_customer: 1,
    max_total_uses: 1,
  });
  if (promoErr && !String(promoErr.message).includes("duplicate")) {
    console.warn("[testimonial-offer] promo insert", promoErr.message);
  }

  return inserted as TestimonialOfferRow;
}

export function testimonialSubmitUrl(submitToken: string): string {
  return `${SITE_BASE}/testimonial/${submitToken}`;
}

export function buildTestimonialOfferSms(firstName: string | null, submitUrl: string): string {
  const name = firstName?.trim() || "there";
  return (
    `Hi ${name}! Thanks again for choosing Novara Cleaning. ` +
    `Share a quick video testimonial (answer 3 short questions) and unlock 50% OFF your next cleaning: ${submitUrl} ` +
    `Your personal promo code is emailed after we receive your video. Reply STOP to opt out.`
  );
}

export function buildTestimonialOfferEmailHtml(opts: {
  firstName: string | null;
  submitUrl: string;
  bookingNumber?: number | null;
}): string {
  const name = opts.firstName?.trim() || "there";
  const questions = TESTIMONIAL_QUESTIONS.map(
    (q, i) => `<li style="margin-bottom:8px;"><strong>Question ${i + 1}:</strong> ${q}</li>`,
  ).join("");

  return `
    <div style="font-family:Inter,Arial,sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a;">
      <p>Hi ${name},</p>
      <p>Your cleaning${opts.bookingNumber ? ` (#${opts.bookingNumber})` : ""} is complete — thank you for trusting Novara!</p>
      <p><strong>Get 50% off your next (2nd) cleaning</strong> when you send us a short video testimonial. It only takes a few minutes on your phone.</p>
      <p style="margin:24px 0;">
        <a href="${opts.submitUrl}" style="background:#6d28d9;color:#fff;padding:14px 24px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block;">
          Record &amp; submit your video
        </a>
      </p>
      <p><strong>Please answer these three questions in your video:</strong></p>
      <ol style="padding-left:20px;line-height:1.5;">${questions}</ol>
      <p>After we receive your submission, we'll email you a <strong>unique promo code</strong> for <strong>50% off your second cleaning</strong> at checkout.</p>
      <p style="color:#666;font-size:13px;">Questions? Reply to this email or text us anytime.</p>
      <p>— The Novara Cleaning Team</p>
    </div>
  `;
}

export function buildTestimonialCodeReadySms(
  firstName: string | null,
  promoCode: string,
): string {
  const name = firstName?.trim() || "there";
  return (
    `Hi ${name}! Thank you for your video testimonial. ` +
    `Your code for 50% off your next cleaning: ${promoCode} — enter it at checkout on try.novaracleaning.com. ` +
    `One-time use on your 2nd clean. Reply STOP to opt out.`
  );
}

export async function sendTestimonialOffer(
  supabase: SupabaseClient,
  booking: {
    id: string;
    email: string;
    first_name?: string | null;
    phone?: string | null;
    booking_number?: number | null;
  },
): Promise<{ offer: TestimonialOfferRow; submitUrl: string }> {
  const offer = await ensureTestimonialOffer(supabase, booking);
  const submitUrl = testimonialSubmitUrl(offer.submit_token);

  if (!offer.offer_sent_at) {
    const html = buildTestimonialOfferEmailHtml({
      firstName: offer.customer_first_name || booking.first_name || null,
      submitUrl,
      bookingNumber: booking.booking_number ?? null,
    });

    try {
      await supabase.functions.invoke("admin-send-email", {
        body: {
          to: booking.email,
          subject: "Share a quick video — get 50% off your next cleaning",
          html,
        },
      });
    } catch (e) {
      console.warn("[testimonial-offer] email failed", e);
    }

    if (booking.phone) {
      try {
        await supabase.functions.invoke("send-ghl-sms", {
          body: {
            phone: booking.phone,
            email: booking.email,
            firstName: offer.customer_first_name || booking.first_name,
            message: buildTestimonialOfferSms(
              offer.customer_first_name || booking.first_name || null,
              submitUrl,
            ),
            type: "testimonial_offer",
          },
        });
      } catch (e) {
        console.warn("[testimonial-offer] sms failed", e);
      }
    }

    await supabase
      .from("testimonial_offers")
      .update({ offer_sent_at: new Date().toISOString() })
      .eq("id", offer.id);
  }

  return { offer, submitUrl };
}

/** Activate promo after a valid testimonial submission. */
export async function activateTestimonialPromo(
  supabase: SupabaseClient,
  promoCode: string,
): Promise<void> {
  await supabase
    .from("promo_codes")
    .update({ active: true })
    .eq("code", promoCode);
}
