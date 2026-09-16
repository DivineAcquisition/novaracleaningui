// After a contractor submits before photos, text + email them their live
// job checklist and a quality reminder to work it front-to-end.

import { ensureAssignmentChecklistAccess, checklistUrlForToken } from "./job-checklist.ts";
import { publicChecklistUrl } from "./public-checklist-url.ts";
import { formatServiceDate } from "./sms.ts";

export const CONTRACTOR_CHECKLIST_NUDGE_TYPE = "checklist_quality_nudge";

const ACTIVE_ASSIGNMENT_STATUSES = [
  "Confirmed",
  "Accepted",
  "accepted",
  "Assigned",
  "assigned",
  "In Progress",
  "in_progress",
];

export function shouldSendContractorChecklistNudge(opts: {
  isSave: boolean;
  submittedBeforeCount: number;
  alreadySent: boolean;
  phase?: string | null;
}): boolean {
  if (opts.isSave) return false;
  if (opts.alreadySent) return false;
  if (opts.submittedBeforeCount <= 0) return false;
  const phase = String(opts.phase || "").toLowerCase();
  // After-photo submit still carries previously saved before URLs. Don't
  // treat that as "before pictures were submitted".
  if (phase === "after") return false;
  return true;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildContractorChecklistNudgeSms(opts: {
  cleanerFirstName?: string | null;
  customerName: string;
  checklistUrl: string;
}): string {
  const first = (opts.cleanerFirstName || "").trim() || "there";
  const customer = (opts.customerName || "this customer").trim() || "this customer";
  const msg =
    `Novara: Hi ${first}, your before photos for ${customer} are in. ` +
    `Work your job checklist front to end with great quality — every line, in order. ` +
    `${opts.checklistUrl}`;
  return msg.slice(0, 480);
}

export function buildContractorChecklistNudgeEmail(opts: {
  cleanerFirstName?: string | null;
  customerName: string;
  checklistUrl: string;
  serviceDate?: string | null;
}): { subject: string; html: string } {
  const first = escapeHtml((opts.cleanerFirstName || "").trim() || "there");
  const customer = escapeHtml((opts.customerName || "this customer").trim() || "this customer");
  const url = escapeHtml(opts.checklistUrl);
  const when = opts.serviceDate ? escapeHtml(opts.serviceDate) : "";
  return {
    subject: "Before photos are in — work the checklist front to end",
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
        <h2 style="margin:0 0 8px;font-size:20px">Before photos are in — now the checklist</h2>
        <p style="margin:0 0 16px;color:#475569">Hi ${first},</p>
        <p style="margin:0 0 16px;color:#475569">
          Your before photos for <strong>${customer}</strong>${when ? ` (${when})` : ""} are in.
          Work your job checklist <strong>front to end with great quality</strong> — every line,
          in order, the way a customer would inspect the home.
        </p>
        <p style="margin:0 0 16px;color:#475569">
          Skipping items or rushing the list is how jobs come back. Finish the full checklist
          before you take after photos.
        </p>
        <p style="margin:24px 0;text-align:center">
          <a href="${url}"
             style="display:inline-block;background:#5C0FFE;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">
            Open your job checklist
          </a>
        </p>
        <p style="margin:0 0 8px;color:#64748b;font-size:14px">
          Quality on this list is how we keep the customer and keep you booked.
        </p>
        <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">Novara Cleaning</p>
      </div>`,
  };
}

type CleanerContact = {
  id: string;
  email?: string | null;
  phone?: string | null;
  first_name?: string | null;
  last_name?: string | null;
};

async function loadAssignedCleaners(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  booking: { job_id?: string | null; cleaner_id?: string | null },
): Promise<CleanerContact[]> {
  const ids = new Set<string>();
  if (booking.cleaner_id) ids.add(String(booking.cleaner_id));
  if (booking.job_id) {
    const { data: assigns } = await supabase
      .from("job_assignments")
      .select("cleaner_id")
      .eq("job_id", booking.job_id)
      .in("status", ACTIVE_ASSIGNMENT_STATUSES);
    for (const row of assigns || []) {
      if (row?.cleaner_id) ids.add(String(row.cleaner_id));
    }
  }
  const list = Array.from(ids);
  if (list.length === 0) return [];
  const { data: cleaners } = await supabase
    .from("cleaners")
    .select("id, email, phone, first_name, last_name")
    .in("id", list);
  return (cleaners || []) as CleanerContact[];
}

async function checklistLinkForCleaner(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  booking: Record<string, unknown>,
  cleanerId: string,
): Promise<string> {
  const jobId = booking.job_id ? String(booking.job_id) : "";
  if (jobId) {
    try {
      const access = await ensureAssignmentChecklistAccess(supabase, {
        jobId,
        cleanerId,
        bookingId: booking.id ? String(booking.id) : null,
        serviceType: (booking.service_type as string | null) || null,
      });
      if (access?.url) return access.url;
      if (access?.token) return checklistUrlForToken(access.token);
    } catch {
      /* fall through to public checklist */
    }
  }
  return publicChecklistUrl(
    (booking.service_type as string | null) || "standard",
    (booking.scope_level as string | null) || null,
  );
}

/**
 * Atomically claim the one-time nudge, then SMS + email every assigned
 * contractor their checklist with the quality reminder.
 */
export async function notifyContractorsChecklistAfterBeforePhotos(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  booking: Record<string, any>,
): Promise<{ sent: boolean; emailed: number; sms: number; skipped?: string }> {
  const cleaners = await loadAssignedCleaners(supabase, booking);
  if (cleaners.length === 0) {
    return { sent: false, emailed: 0, sms: 0, skipped: "no_contractor" };
  }

  const { data: claimed } = await supabase
    .from("bookings")
    .update({ contractor_checklist_nudge_sent_at: new Date().toISOString() })
    .eq("id", booking.id)
    .is("contractor_checklist_nudge_sent_at", null)
    .select("id");
  const wonClaim = Array.isArray(claimed) && claimed.length > 0;
  if (!wonClaim) return { sent: false, emailed: 0, sms: 0, skipped: "already_sent" };

  const customerName =
    `${booking.first_name || ""} ${booking.last_name || ""}`.trim() || "this customer";
  const dateLabel = formatServiceDate(booking.service_date) || null;

  let emailed = 0;
  let sms = 0;
  for (const cleaner of cleaners) {
    const checklistUrl = await checklistLinkForCleaner(supabase, booking, cleaner.id);
    const copy = {
      cleanerFirstName: cleaner.first_name,
      customerName,
      checklistUrl,
      serviceDate: dateLabel,
    };
    if (cleaner.phone) {
      try {
        const { error } = await supabase.functions.invoke("send-ghl-sms", {
          body: {
            phone: cleaner.phone,
            firstName: cleaner.first_name,
            message: buildContractorChecklistNudgeSms(copy),
            type: CONTRACTOR_CHECKLIST_NUDGE_TYPE,
          },
        });
        if (!error) sms += 1;
      } catch {
        /* non-blocking */
      }
    }
    if (cleaner.email) {
      const emailCopy = buildContractorChecklistNudgeEmail(copy);
      try {
        const { error } = await supabase.functions.invoke("send-cleaner-email", {
          body: {
            type: CONTRACTOR_CHECKLIST_NUDGE_TYPE,
            email: cleaner.email,
            data: {
              cleanerFirstName: cleaner.first_name || "there",
              customerName,
              checklistUrl,
              serviceDate: dateLabel,
              html: emailCopy.html,
              subject: emailCopy.subject,
            },
          },
        });
        if (!error) emailed += 1;
      } catch {
        /* non-blocking */
      }
    }
  }

  await supabase.from("events").insert({
    event_type: "cleaner.checklist_quality_nudge",
    booking_id: booking.id,
    source: "submit-cleaner-photos",
    summary: `Contractor checklist quality nudge after before photos (${emailed} email / ${sms} SMS)`,
    data: { emailed, sms, cleanerIds: cleaners.map((c) => c.id) },
  }).then(() => undefined, () => undefined);

  return { sent: emailed > 0 || sms > 0, emailed, sms };
}
