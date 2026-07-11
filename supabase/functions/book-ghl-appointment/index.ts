// book-ghl-appointment
//
// Single source-of-truth for pushing a booking into GHL as a calendar
// appointment. Idempotent: if the booking already has a
// ghl_appointment_id we PATCH it instead of POSTing a new one. Used by:
//
//   - book-as-va (admin internal booking)
//   - finalize-booking (public funnel after payment + details)
//   - reschedule-booking (on date/time change)
//   - cancel-booking (status -> 'cancelled')
//
// Body: { bookingId: 'uuid' }
// Optional: { action: 'cancel' | 'noshow' | 'showed' | 'confirmed' }
//
// On success: persists ghl_appointment_id + ghl_appointment_calendar_id
// + ghl_appointment_synced_at on the bookings row, also writes an
// `events` row so the activity feed lights up immediately. On failure:
// stamps ghl_appointment_sync_error and returns 502 so the caller can
// alert. Never throws — GHL outages must not break the booking save.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[BOOK-GHL-APPT] ${step}${tail}`);
};

function toE164(input: string | undefined | null): string | null {
  if (!input) return null;
  const raw = String(input).trim();
  if (!raw) return null;
  if (raw.startsWith("+")) {
    const d = raw.slice(1).replace(/[^0-9]/g, "");
    return d ? `+${d}` : null;
  }
  const d = raw.replace(/[^0-9]/g, "");
  if (d.length === 11 && d.startsWith("1")) return `+${d}`;
  if (d.length === 10) return `+1${d}`;
  return d ? `+${d}` : null;
}

// deno-lint-ignore no-explicit-any
async function resolveSecret(supabase: any, name: string): Promise<string> {
  let value = "";
  try {
    const { data } = await supabase
      .from("app_secrets")
      .select("value")
      .eq("key", name)
      .maybeSingle();
    if (data?.value && typeof data.value === "string") value = data.value.trim();
  } catch (_) { /* ignore */ }
  if (!value) value = (Deno.env.get(name) || "").trim();
  return value;
}

async function ghlFetch(path: string, init: RequestInit, token: string) {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Version: GHL_VERSION,
    Accept: "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (init.body && !headers["Content-Type"]) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`${GHL_BASE}${path}`, { ...init, headers });
}

// deno-lint-ignore no-explicit-any
async function upsertContactQuick(b: any, token: string, locationId: string): Promise<string | null> {
  const phoneE164 = toE164(b.phone);
  const body = {
    locationId,
    email: b.email || undefined,
    phone: phoneE164 || undefined,
    firstName: b.first_name || undefined,
    lastName: b.last_name || undefined,
    address1: b.address || undefined,
    city: b.city || undefined,
    state: b.state || undefined,
    postalCode: b.zip_code || undefined,
    country: "US",
    source: "Novara Booking",
  };
  try {
    const r = await ghlFetch(
      "/contacts/upsert",
      { method: "POST", body: JSON.stringify(body) },
      token,
    );
    if (!r.ok) {
      logStep("contact upsert failed", { status: r.status });
      return null;
    }
    const j = await r.json();
    return (j?.contact?.id as string | undefined) ||
      (j?.id as string | undefined) || null;
  } catch (err) {
    logStep("contact upsert error", err instanceof Error ? err.message : String(err));
    return null;
  }
}

function timeSlotToIsoBounds(
  serviceDate: string,
  timeSlot: string,
  estimatedHours?: number | null,
) {
  if (!serviceDate || !timeSlot) {
    return { startIso: null as string | null, endIso: null as string | null };
  }
  const parse = (chunk: string) => {
    const m = chunk.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
    if (!m) return null;
    let h = parseInt(m[1], 10);
    const min = parseInt(m[2], 10);
    const ap = m[3].toUpperCase();
    if (ap === "PM" && h !== 12) h += 12;
    if (ap === "AM" && h === 12) h = 0;
    return { h, m: min };
  };
  const [startStr, endStr] = timeSlot.split("-").map((s) => s.trim());
  const start = parse(startStr || "");
  let end = endStr ? parse(endStr) : null;
  if (!start) return { startIso: null, endIso: null };
  if (!end && estimatedHours) {
    const totalMin = start.m + Math.round(estimatedHours * 60);
    end = { h: start.h + Math.floor(totalMin / 60), m: totalMin % 60 };
  }
  if (!end) end = { h: start.h + 1, m: start.m };
  const pad = (n: number) => String(n).padStart(2, "0");
  // GHL stores in the location's timezone regardless of offset sent.
  const offset = (Deno.env.get("DEFAULT_TZ_OFFSET") || "-05:00").trim();
  const startIso = `${serviceDate}T${pad(start.h)}:${pad(start.m)}:00${offset}`;
  const endIso = `${serviceDate}T${pad(end.h)}:${pad(end.m)}:00${offset}`;
  return { startIso, endIso };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  try {
    const body = await req.json();
    const { bookingId, action } = body as {
      bookingId?: string;
      action?: string;
    };
    if (!bookingId) {
      return new Response(JSON.stringify({ error: "bookingId required" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const { data: booking, error: fetchErr } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", bookingId)
      .maybeSingle();
    if (fetchErr || !booking) {
      return new Response(JSON.stringify({ error: "booking not found" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 404,
      });
    }

    const token = (Deno.env.get("GHL_PIT_TOKEN") || "").trim();
    const locationId = (Deno.env.get("GHL_LOCATION_ID") || "").trim();
    if (!token || !locationId) {
      return new Response(JSON.stringify({ error: "GHL not configured" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      });
    }
    const calendarId = await resolveSecret(supabase, "GHL_CLEANING_CALENDAR_ID");
    if (!calendarId) {
      return new Response(
        JSON.stringify({
          error: "GHL_CLEANING_CALENDAR_ID not configured in app_secrets",
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 500,
        },
      );
    }

    // 1. Resolve / upsert the GHL contact (must exist before the appointment).
    const contactId = await upsertContactQuick(booking, token, locationId);
    if (!contactId) {
      await supabase
        .from("bookings")
        .update({ ghl_appointment_sync_error: "Failed to upsert GHL contact" })
        .eq("id", bookingId);
      return new Response(
        JSON.stringify({ error: "GHL contact upsert failed" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 502,
        },
      );
    }

    // 2. Compute appointment bounds.
    const { startIso, endIso } = timeSlotToIsoBounds(
      booking.service_date,
      booking.time_slot,
      booking.estimated_duration_hours,
    );
    if (!startIso || !endIso) {
      await supabase
        .from("bookings")
        .update({
          ghl_appointment_sync_error: "Could not parse service_date/time_slot",
        })
        .eq("id", bookingId);
      return new Response(
        JSON.stringify({ error: "could not parse service_date / time_slot" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 400,
        },
      );
    }

    const bookingRef = booking.booking_number
      ? `NOV-${String(booking.booking_number).padStart(5, "0")}`
      : `BK-${String(bookingId).slice(0, 8)}`;
    const serviceLabel = ({
      standard: "Standard",
      deep: "Deep",
      moveInOut: "Move-In/Out",
      combo: "Combo (Deep + Standard)",
    } as Record<string, string>)[booking.service_type] || booking.service_type ||
      "Cleaning";
    const title = `${bookingRef} — ${serviceLabel} clean (${booking.first_name || ""} ${booking.last_name || ""})`
      .trim();
    const addressLine = [
      booking.address,
      booking.city,
      booking.state,
      booking.zip_code,
    ].filter(Boolean).join(", ");
    const notesParts = [
      `Booking ${bookingRef}`,
      `Service: ${serviceLabel}`,
      `Home size: ${booking.home_size_id || "?"}`,
      booking.bedrooms ? `Bedrooms: ${booking.bedrooms}` : null,
      booking.bathrooms ? `Bathrooms: ${booking.bathrooms}` : null,
      booking.add_ons && booking.add_ons.length
        ? `Add-ons: ${(booking.add_ons as string[]).join(", ")}`
        : null,
      booking.access_notes ? `Access: ${booking.access_notes}` : null,
      booking.team_notes ? `Internal: ${booking.team_notes}` : null,
      booking.total_estimate_cents
        ? `Total: $${(booking.total_estimate_cents / 100).toFixed(2)}`
        : null,
      booking.deposit_cents
        ? `Deposit: $${(booking.deposit_cents / 100).toFixed(2)}`
        : null,
      booking.hosted_invoice_url ? `Invoice: ${booking.hosted_invoice_url}` : null,
    ].filter(Boolean);
    const apptStatus = action === "cancel"
      ? "cancelled"
      : action === "noshow"
      ? "noshow"
      : action === "showed"
      ? "showed"
      : "confirmed";

    const appointmentBody: Record<string, unknown> = {
      title,
      meetingLocationType: "address",
      address: addressLine || undefined,
      appointmentStatus: apptStatus,
      startTime: startIso,
      endTime: endIso,
      notes: notesParts.join("\n"),
      ignoreDateRange: true,
      toNotify: false, // we already SMS via send-ghl-sms
    };

    let appointmentId: string | null = booking.ghl_appointment_id || null;
    let usedCalendarId: string = booking.ghl_appointment_calendar_id ||
      calendarId;

    try {
      if (appointmentId) {
        // Update existing appointment
        const r = await ghlFetch(
          `/calendars/events/appointments/${encodeURIComponent(appointmentId)}`,
          { method: "PUT", body: JSON.stringify(appointmentBody) },
          token,
        );
        if (!r.ok) {
          const t = await r.text();
          logStep("update failed; will recreate", {
            status: r.status,
            body: t.slice(0, 300),
          });
          appointmentId = null;
        }
      }
      if (!appointmentId) {
        const createBody: Record<string, unknown> = {
          ...appointmentBody,
          calendarId,
          locationId,
          contactId,
        };
        let r = await ghlFetch(
          "/calendars/events/appointments",
          { method: "POST", body: JSON.stringify(createBody) },
          token,
        );
        let t = await r.text();

        // Novara's booking system is the source of truth for scheduling —
        // this appointment mirrors an ALREADY-CONFIRMED booking, so GHL's
        // free-slot validation must never permanently block the sync
        // (common when the booking's own prior appointment occupies the
        // slot, leaving the reconcile cron looping on 400s forever).
        // Retry once with ignoreFreeSlotValidation, which requires an
        // explicit assignedUserId: app_secrets.GHL_DEFAULT_APPT_USER_ID,
        // else the calendar's first team member.
        if (!r.ok && /slot.*(no longer|not) available|SLOT_UNAVAILABLE/i.test(t)) {
          let assignedUserId = await resolveSecret(supabase, "GHL_DEFAULT_APPT_USER_ID");
          if (!assignedUserId) {
            try {
              const calRes = await ghlFetch(
                `/calendars/${encodeURIComponent(calendarId)}`,
                { method: "GET" },
                token,
              );
              if (calRes.ok) {
                const calJson = await calRes.json();
                const members =
                  (calJson?.calendar?.teamMembers || calJson?.teamMembers || []) as Array<{ userId?: string }>;
                assignedUserId = members.find((m) => m?.userId)?.userId || "";
              }
            } catch { /* fall through to normal failure */ }
          }
          if (assignedUserId) {
            logStep("slot unavailable — retrying with ignoreFreeSlotValidation", { assignedUserId });
            r = await ghlFetch(
              "/calendars/events/appointments",
              {
                method: "POST",
                body: JSON.stringify({
                  ...createBody,
                  ignoreFreeSlotValidation: true,
                  assignedUserId,
                }),
              },
              token,
            );
            t = await r.text();
          }
        }

        if (!r.ok) {
          logStep("create failed", { status: r.status, body: t.slice(0, 500) });
          await supabase
            .from("bookings")
            .update({
              ghl_appointment_sync_error: `create failed: ${t.slice(0, 200)}`,
            })
            .eq("id", bookingId);
          return new Response(
            JSON.stringify({
              error: "GHL appointment create failed",
              status: r.status,
              body: t.slice(0, 500),
            }),
            {
              headers: { ...corsHeaders, "Content-Type": "application/json" },
              status: 502,
            },
          );
        }
        // deno-lint-ignore no-explicit-any
        let parsed: any = {};
        try {
          parsed = JSON.parse(t);
        } catch { /* ignore */ }
        appointmentId = (parsed?.id as string | undefined) ||
          (parsed?.appointment?.id as string | undefined) || null;
        usedCalendarId = calendarId;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logStep("network error", msg);
      await supabase
        .from("bookings")
        .update({ ghl_appointment_sync_error: msg.slice(0, 200) })
        .eq("id", bookingId);
      return new Response(JSON.stringify({ error: msg }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 502,
      });
    }

    if (!appointmentId) {
      await supabase
        .from("bookings")
        .update({ ghl_appointment_sync_error: "No appointment id returned" })
        .eq("id", bookingId);
      return new Response(
        JSON.stringify({ error: "no appointment id returned" }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
          status: 502,
        },
      );
    }

    await supabase
      .from("bookings")
      .update({
        ghl_appointment_id: appointmentId,
        ghl_appointment_calendar_id: usedCalendarId,
        ghl_appointment_synced_at: new Date().toISOString(),
        ghl_appointment_sync_error: null,
      })
      .eq("id", bookingId);

    // Activity-feed event
    try {
      await supabase.from("events").insert({
        event_type: action === "cancel"
          ? "appointment.cancelled"
          : booking.ghl_appointment_id
          ? "appointment.updated"
          : "appointment.created",
        booking_id: bookingId,
        ghl_contact_id: contactId,
        source: "book-ghl-appointment",
        zone: booking.state || null,
        summary:
          `${apptStatus.toUpperCase()} GHL appt ${bookingRef} on ${booking.service_date} ${booking.time_slot}`,
        data: {
          appointmentId,
          calendarId: usedCalendarId,
          contactId,
          action,
          status: apptStatus,
        },
      });
    } catch (_) { /* never fail booking on event-log error */ }

    return new Response(
      JSON.stringify({
        success: true,
        bookingId,
        appointmentId,
        calendarId: usedCalendarId,
        contactId,
        status: apptStatus,
        startTime: startIso,
        endTime: endIso,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[book-ghl-appointment] error", message);
    return new Response(JSON.stringify({ error: message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
