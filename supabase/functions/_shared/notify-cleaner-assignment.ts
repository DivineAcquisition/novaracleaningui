// Notify assigned cleaners: Resend assignment email + optional SMS.

import { formatServiceDate, formatTimeSlot } from "./sms.ts";

const CHECKLIST_BY_SERVICE: Record<string, string> = {
  standard: "https://try.novaracleaning.com/checklist/standard-clean",
  deep: "https://try.novaracleaning.com/checklist/deep-clean",
  move_in_out: "https://try.novaracleaning.com/checklist/move-in-out",
  recurring: "https://try.novaracleaning.com/checklist/recurring",
};

function checklistUrl(serviceType: string | null): string {
  const key = String(serviceType || "standard").toLowerCase().replace(/-/g, "_");
  return CHECKLIST_BY_SERVICE[key] || CHECKLIST_BY_SERVICE.standard;
}

export async function notifyCleanerOfAssignment(
  supabase: any,
  booking: Record<string, any>,
  cleaner: {
    id: string;
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    pay_percentage?: number | null;
  },
  opts?: { role?: string; estimatedPayCents?: number },
): Promise<{ email?: boolean; sms?: boolean }> {
  const out: { email?: boolean; sms?: boolean } = {};
  const customerName = `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || "Customer";
  const revenue = Number(booking.final_charge_cents || booking.total_estimate_cents || 0);
  const pct = Number(cleaner.pay_percentage) || 35;
  const estimatedEarnings = opts?.estimatedPayCents ??
    Math.floor((revenue * pct) / 100 / Math.max(1, Number(booking.num_cleaners_assigned) || 1));

  if (cleaner.email) {
    try {
      const { error } = await supabase.functions.invoke("send-cleaner-email", {
        body: {
          type: "assignment",
          email: cleaner.email,
          data: {
            cleanerFirstName: cleaner.first_name || "Cleaner",
            bookingId: String(booking.booking_number || booking.id).slice(0, 12),
            customerName,
            serviceDate: booking.service_date || "",
            timeSlot: booking.time_slot || "",
            serviceType: booking.service_type || "standard",
            address: booking.address || "",
            city: booking.city || "",
            state: booking.state || "",
            zipCode: booking.zip_code || "",
            estimatedEarnings: estimatedEarnings / 100,
            dashboardUrl: `https://contractor.novaracleaning.com/cleaner/mobile-dashboard`,
            checklistUrl: checklistUrl(booking.service_type),
            role: opts?.role || "Lead",
          },
        },
      });
      out.email = !error;
    } catch {
      out.email = false;
    }
  }

  if (cleaner.phone) {
    try {
      // Use the friendly date + arrival window (e.g. "Fri, Jun 20" /
      // "8:00 AM – 12:00 PM") instead of the raw stored values, and show
      // the cleaner what they'll earn.
      const dateLabel = formatServiceDate(booking.service_date) || "TBD";
      const windowLabel = formatTimeSlot(booking.time_slot || booking.arrival_window);
      const whenLabel = windowLabel ? `${dateLabel}, ${windowLabel}` : dateLabel;
      const payLabel = estimatedEarnings > 0 ? ` Pay: $${(estimatedEarnings / 100).toFixed(2)}.` : "";
      const msg =
        `Novara job assigned${opts?.role === "Support" ? " (support)" : ""}: ` +
        `${customerName} · ${whenLabel}.${payLabel} ` +
        `${booking.address || ""}, ${booking.city || ""}. ` +
        `Checklist: ${checklistUrl(booking.service_type)} ` +
        `Portal: https://contractor.novaracleaning.com/cleaner/mobile-dashboard`;
      const { error } = await supabase.functions.invoke("send-ghl-sms", {
        body: {
          phone: cleaner.phone,
          firstName: cleaner.first_name,
          message: msg.slice(0, 480),
        },
      });
      out.sms = !error;
    } catch {
      out.sms = false;
    }
  }

  return out;
}
