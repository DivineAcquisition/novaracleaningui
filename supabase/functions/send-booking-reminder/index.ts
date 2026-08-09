import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const detailsStr = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[SEND-BOOKING-REMINDER] ${step}${detailsStr}`);
};

const TZ = "America/New_York";
const PUBLIC_BASE = "https://try.novaracleaning.com";

/** Cadence kinds → booking_emails_sent.kind (one send each). */
const REMINDERS = {
  "10_minute": "pending_checkout_reminder_10m",
  "2_hour": "pending_checkout_reminder_2h",
  "next_day_noon": "pending_checkout_reminder_next_day_noon",
  "day_2": "pending_checkout_reminder_day_2",
} as const;

type ReminderType = keyof typeof REMINDERS;

function mintToken(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isPublicCheckoutPending(booking: Record<string, unknown>): boolean {
  const channel = String(booking.booking_channel || "").toLowerCase().trim();
  if (
    channel === "admin" || channel === "va" || channel === "internal" ||
    channel === "partner"
  ) {
    return false;
  }
  const source = String(booking.booker_source || "").toLowerCase().trim();
  if (source.startsWith("va_") || source === "va_admin" || source === "admin") {
    return false;
  }
  if (booking.hosted_invoice_url || booking.stripe_invoice_id) return false;
  return true;
}

/** Parts of "now" in America/New_York. */
function etNow(d = new Date()): {
  hour: number;
  minute: number;
  ymd: string;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value || "0";
  return {
    hour: parseInt(get("hour"), 10),
    minute: parseInt(get("minute"), 10),
    ymd: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function etYmd(d: Date): string {
  return etNow(d).ymd;
}

/** Business ops window: Mon–Sat 9:00–18:00 America/New_York. */
function isBusinessOps(d = new Date()): boolean {
  const { hour } = etNow(d);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "short",
  }).format(d);
  if (weekday === "Sun") return false;
  return hour >= 9 && hour < 18;
}

/** Around noon ET (11:30–12:29) so a every-30-min cron still hits once. */
function isAroundNoonEt(d = new Date()): boolean {
  const { hour, minute } = etNow(d);
  if (hour === 11 && minute >= 30) return true;
  if (hour === 12 && minute < 30) return true;
  return false;
}

function pickReminderType(
  createdAt: Date,
  now: Date,
): ReminderType | null {
  const ageMs = now.getTime() - createdAt.getTime();
  const ageMin = ageMs / (1000 * 60);
  const ageHours = ageMin / 60;

  // 1) ~10 minutes
  if (ageMin >= 8 && ageMin < 90) return "10_minute";

  // 2) ≥2 hours, only during business ops
  if (ageHours >= 2 && ageHours < 20 && isBusinessOps(now)) return "2_hour";

  // 3) Next calendar day at ~12 PM ET
  const createdYmd = etYmd(createdAt);
  const nowYmd = etYmd(now);
  if (
    nowYmd > createdYmd &&
    ageHours >= 12 &&
    ageHours < 40 &&
    isAroundNoonEt(now)
  ) {
    return "next_day_noon";
  }

  // 4) ~2 days later
  if (ageHours >= 46 && ageHours < 72) return "day_2";

  return null;
}

function copyFor(
  type: ReminderType,
  firstName: string,
  resumeUrl: string,
): { sms: string; emailHeadline: string } {
  const name = firstName?.trim() || "there";
  switch (type) {
    case "10_minute":
      return {
        sms:
          `Novara Cleaning: Hi ${name}! You're almost done — finish your booking and save $30. Continue here: ${resumeUrl}`,
        emailHeadline: "You're almost done — finish & save $30",
      };
    case "2_hour":
      return {
        sms:
          `Novara Cleaning: Still thinking it over, ${name}? Your cleaning spot is still held. Continue where you left off: ${resumeUrl}`,
        emailHeadline: "Your cleaning spot is still held",
      };
    case "next_day_noon":
      return {
        sms:
          `Novara Cleaning: Good afternoon ${name}! Your booking from yesterday is still open. Pick up where you left off: ${resumeUrl}`,
        emailHeadline: "Good afternoon — your booking is still open",
      };
    case "day_2":
      return {
        sms:
          `Novara Cleaning: Final reminder, ${name} — your unfinished booking expires soon. Complete it to keep your date: ${resumeUrl}`,
        emailHeadline: "Final reminder — complete your booking",
      };
  }
}

async function ensureResumeToken(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  booking: { id: string; checkout_resume_token?: string | null },
): Promise<string | null> {
  if (booking.checkout_resume_token) return booking.checkout_resume_token;
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = mintToken();
    const { data, error } = await supabase
      .from("bookings")
      .update({ checkout_resume_token: token })
      .eq("id", booking.id)
      .is("checkout_resume_token", null)
      .select("checkout_resume_token")
      .maybeSingle();
    if (!error && data?.checkout_resume_token) {
      return data.checkout_resume_token as string;
    }
    // Race: another writer set it — re-read.
    const { data: again } = await supabase
      .from("bookings")
      .select("checkout_resume_token")
      .eq("id", booking.id)
      .maybeSingle();
    if (again?.checkout_resume_token) {
      return again.checkout_resume_token as string;
    }
  }
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    logStep("Reminder function started");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const now = new Date();
    // Keep rows long enough for the day-2 reminder (cleanup is 72h).
    const seventyTwoHoursAgo = new Date(now.getTime() - 72 * 60 * 60 * 1000);

    const { data: pendingBookings, error: fetchError } = await supabase
      .from("bookings")
      .select(
        "id, created_at, first_name, last_name, email, phone, service_date, time_slot, service_type, home_size_id, total_estimate_cents, deposit_cents, payment_option, booking_channel, booker_source, hosted_invoice_url, stripe_invoice_id, checkout_resume_token",
      )
      .eq("status", "pending_payment")
      .gt("created_at", seventyTwoHoursAgo.toISOString())
      .order("created_at", { ascending: true })
      .limit(300);

    if (fetchError) throw fetchError;

    logStep("Found pending bookings", {
      count: pendingBookings?.length || 0,
      et: etNow(now),
      businessOps: isBusinessOps(now),
      aroundNoon: isAroundNoonEt(now),
    });

    if (!pendingBookings?.length) {
      return new Response(
        JSON.stringify({ success: true, reminders_sent: 0 }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    let remindersSent = 0;
    let skippedInternal = 0;
    let skippedAlreadySent = 0;
    let skippedOutsideWindow = 0;
    const errors: Array<Record<string, unknown>> = [];

    for (const booking of pendingBookings) {
      if (!isPublicCheckoutPending(booking as Record<string, unknown>)) {
        skippedInternal++;
        continue;
      }

      const createdAt = new Date(booking.created_at);
      const reminderType = pickReminderType(createdAt, now);
      if (!reminderType) {
        skippedOutsideWindow++;
        continue;
      }

      const kind = REMINDERS[reminderType];
      const { error: claimError } = await supabase
        .from("booking_emails_sent")
        .insert({
          booking_id: booking.id,
          kind,
          recipient_email: booking.email,
        });

      if (claimError) {
        skippedAlreadySent++;
        continue;
      }

      try {
        const token = await ensureResumeToken(supabase, booking);
        if (!token) {
          throw new Error("Could not mint checkout_resume_token");
        }
        const resumeUrl =
          `${PUBLIC_BASE}/book/checkout?resume_token=${token}`;
        const { sms, emailHeadline } = copyFor(
          reminderType,
          booking.first_name || "",
          resumeUrl,
        );

        const reminderData = {
          firstName: booking.first_name,
          lastName: booking.last_name,
          bookingId: booking.id,
          serviceDate: booking.service_date,
          timeSlot: booking.time_slot,
          serviceType: booking.service_type,
          homeSize: booking.home_size_id,
          totalAmount: booking.total_estimate_cents,
          depositAmount: booking.deposit_cents,
          paymentOption: booking.payment_option,
          reminderType,
          checkoutUrl: resumeUrl,
          emailHeadline,
        };

        const response = await fetch(
          `${Deno.env.get("SUPABASE_URL")}/functions/v1/send-booking-reminder-email`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
            },
            body: JSON.stringify({
              email: booking.email,
              data: reminderData,
            }),
          },
        );

        if (!response.ok) {
          throw new Error(`Email send failed: ${await response.text()}`);
        }

        if (booking.phone) {
          const smsOk = await sendSms(supabase, {
            toPhone: booking.phone,
            message: sms,
            type: "reminder",
          });
          if (!smsOk) {
            logStep("SMS send failed", { bookingId: booking.id });
          }
        }

        remindersSent++;
        logStep("Reminder sent", {
          bookingId: booking.id,
          type: reminderType,
          resumeUrl,
        });
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        await supabase
          .from("booking_emails_sent")
          .delete()
          .eq("booking_id", booking.id)
          .eq("kind", kind);
        errors.push({ bookingId: booking.id, error: message });
        logStep("Reminder failed — claim released", {
          bookingId: booking.id,
          error: message,
        });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        reminders_sent: remindersSent,
        total_pending: pendingBookings.length,
        skipped_internal: skippedInternal,
        skipped_already_sent: skippedAlreadySent,
        skipped_outside_window: skippedOutsideWindow,
        errors: errors.length ? errors : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
