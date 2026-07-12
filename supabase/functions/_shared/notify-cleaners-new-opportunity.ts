// Notify all active cleaners when a new booking is confirmed (customer or VA).

const log = (s: string, d?: unknown) =>
  console.log(`[notify-new-opp] ${s}${d ? ` ${JSON.stringify(d)}` : ""}`);

export interface NewOpportunityBooking {
  id: string;
  booking_number?: string | number | null;
  service_date?: string | null;
  time_slot?: string | null;
  service_type?: string | null;
  city?: string | null;
  state?: string | null;
  zip_code?: string | null;
  address?: string | null;
}

function serviceLabel(serviceType: string | null | undefined): string {
  const map: Record<string, string> = {
    standard: "Standard Clean",
    deep: "Deep Clean",
    move_in_out: "Move In/Out",
    recurring: "Recurring Clean",
    combo: "Combo (Deep + Standard)",
  };
  const key = String(serviceType || "standard").toLowerCase().replace(/-/g, "_");
  return map[key] || "Cleaning";
}

/**
 * SMS + optional email every active cleaner to open LeadConnector for the new job.
 */
export async function notifyAllCleanersOfNewOpportunity(
  supabase: any,
  booking: NewOpportunityBooking,
): Promise<{ sent: number; skipped: number }> {
  const { data: cleaners, error } = await supabase
    .from("cleaners")
    .select("id, first_name, last_name, phone, email, sms_notifications_enabled")
    .eq("approved", true)
    .eq("available_for_bookings", true)
    .eq("status", "active");

  if (error || !cleaners?.length) {
    log("no cleaners", { error: error?.message });
    return { sent: 0, skipped: 0 };
  }

  const ref = booking.booking_number
    ? `NVC-${String(booking.booking_number).padStart(4, "0")}`
    : `#${booking.id.slice(0, 8)}`;
  const date = booking.service_date || "TBD";
  const location = [booking.city, booking.state, booking.zip_code].filter(Boolean).join(", ") ||
    booking.address ||
    "";
  const service = serviceLabel(booking.service_type);

  const message =
    `Novara — New job in LeadConnector\n\n` +
    `${service} · ${ref}\n` +
    `Date: ${date}${booking.time_slot ? ` · ${booking.time_slot}` : ""}\n` +
    (location ? `Location: ${location}\n` : "") +
    `\nOpen the LeadConnector app to read the full opportunity description and claim the job if you're available.`;

  let sent = 0;
  let skipped = 0;

  for (const c of cleaners) {
    if (!c.phone || c.sms_notifications_enabled === false) {
      skipped++;
      continue;
    }
    try {
      await supabase.functions.invoke("send-ghl-sms", {
        body: {
          phone: c.phone,
          email: c.email || undefined,
          firstName: c.first_name || undefined,
          lastName: c.last_name || undefined,
          message: `${message}\n\nReply STOP to opt out.`,
          type: "new_opportunity_broadcast",
          bookingId: booking.id,
        },
      });
      sent++;
    } catch (e) {
      log("sms failed", { cleanerId: c.id, err: e instanceof Error ? e.message : String(e) });
      skipped++;
    }

    // Best-effort native push to the Novara Pro app (no-ops when the
    // cleaner has no registered device or push creds aren't configured).
    try {
      await supabase.functions.invoke("send-push", {
        body: {
          cleanerId: c.id,
          title: `New ${service} job — ${ref}`,
          body: `${date}${booking.time_slot ? ` · ${booking.time_slot}` : ""}${location ? ` · ${location}` : ""}. Open Novara Pro to claim it.`,
          data: { type: "new_opportunity", bookingId: booking.id },
        },
      });
    } catch (_) { /* push is best-effort */ }
  }

  log("done", { sent, skipped, bookingId: booking.id });
  return { sent, skipped };
}
