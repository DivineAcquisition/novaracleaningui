// Notify assigned cleaners: Resend assignment email + optional SMS.
//
// Cleaners now get their DEDICATED per-job checklist link (tokenized,
// contractor.novaracleaning.com/cleaner/job-checklist/<token>) instead of
// the public marketing checklist. Progress on that page relays live to
// the admin Dispatch console. The public URL remains the fallback for
// legacy bookings that have no job/assignment row.

import { formatServiceDate, formatTimeSlot } from "./sms.ts";
import { ensureAssignmentChecklistAccess } from "./job-checklist.ts";
import { computeCrewPay, shareFor } from "./crew-pay.ts";

const CHECKLIST_BY_SERVICE: Record<string, string> = {
  standard: "https://try.novaracleaning.com/checklist/standard-clean",
  deep: "https://try.novaracleaning.com/checklist/deep-clean",
  move_in_out: "https://try.novaracleaning.com/checklist/move-in-out",
  recurring: "https://try.novaracleaning.com/checklist/recurring",
};

function publicChecklistUrl(serviceType: string | null): string {
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
  opts?: {
    role?: string;
    estimatedPayCents?: number;
    /** Full performing/assigned crew — needed so the rate bracket is correct. */
    crewCleanerIds?: string[];
  },
): Promise<{ email?: boolean; sms?: boolean }> {
  const out: { email?: boolean; sms?: boolean } = {};
  const customerName = `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || "Customer";
  const revenue = Number(booking.final_charge_cents || booking.total_estimate_cents || 0);

  let estimatedEarnings = opts?.estimatedPayCents;
  if (estimatedEarnings == null && revenue > 0) {
    try {
      const crew = (opts?.crewCleanerIds?.length ? opts.crewCleanerIds : [cleaner.id])
        .filter(Boolean);
      const shares = await computeCrewPay(supabase, revenue, crew);
      estimatedEarnings = shareFor(shares, cleaner.id)?.shareCents ?? 0;
    } catch {
      // Last-resort solo estimate from the cleaner's solo-tier percentage —
      // never divide a flat % by crew size (that was the old underpay).
      const pct = Number(cleaner.pay_percentage) || 35;
      estimatedEarnings = Math.floor((revenue * pct) / 100);
    }
  }
  if (estimatedEarnings == null) estimatedEarnings = 0;

  // Dedicated contractor checklist link (falls back to the public
  // checklist when the booking has no job/assignment for this cleaner).
  let checklistLink = publicChecklistUrl(booking.service_type);
  if (booking.job_id) {
    try {
      const access = await ensureAssignmentChecklistAccess(supabase, {
        jobId: String(booking.job_id),
        cleanerId: cleaner.id,
        bookingId: booking.id ? String(booking.id) : null,
        serviceType: booking.service_type || null,
      });
      if (access?.url) checklistLink = access.url;
    } catch (_) { /* keep public fallback */ }
  }

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
            checklistUrl: checklistLink,
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
      // Pay stays in the portal / offer email — never in the assignment SMS.
      const msg =
        `Novara job assigned${opts?.role === "Support" ? " (support)" : ""}: ` +
        `${customerName} · ${whenLabel}. ` +
        `${booking.address || ""}, ${booking.city || ""}. ` +
        `Your job checklist: ${checklistLink} ` +
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
