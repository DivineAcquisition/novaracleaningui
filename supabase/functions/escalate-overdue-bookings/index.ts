// ─── escalate-overdue-bookings ─────────────────────────────────────────────
//
// Daily cron: finds assigned bookings whose service day has passed but the
// job is still not marked complete. Notifies admins + VAs by email and texts
// assigned cleaners with a link to update job status.
//
// Idempotent per booking via bookings.overdue_completion_alert_sent_at.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { resolveStaffAlertEmails } from "../_shared/dispatch-backfill.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CLEANER_JOBS_URL = "https://contractor.novaracleaning.com/contractor/jobs";
const ADMIN_BOOKINGS_URL = "https://admin.novaracleaning.com/admin/bookings";

const logStep = (step: string, details?: unknown) => {
  const tail = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[ESCALATE-OVERDUE-BOOKINGS] ${step}${tail}`);
};

/** Service calendar day has fully passed (UTC date compare). */
function serviceDayHasEnded(serviceDate: string): boolean {
  if (!serviceDate) return false;
  const today = new Date().toISOString().slice(0, 10);
  return serviceDate < today;
}

function bookingRef(row: { booking_number?: number | null; id: string }): string {
  if (row.booking_number) {
    return `NVC-${String(row.booking_number).padStart(4, "0")}`;
  }
  return row.id.slice(0, 8).toUpperCase();
}

async function sendStaffEmail(
  apiKey: string,
  to: string[],
  subject: string,
  html: string,
): Promise<boolean> {
  if (!to.length) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Novara Cleaning <hello@novaracleaning.com>",
        to,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      logStep("Resend failed", { status: res.status, body: await res.text() });
      return false;
    }
    return true;
  } catch (e) {
    logStep("Resend error", { error: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    const resendKey = (Deno.env.get("RESEND_API_KEY") || "").trim();

    const { data: rows, error } = await supabase
      .from("bookings")
      .select(`
        id, booking_number, status, service_date, time_slot,
        first_name, last_name, address, city, state, zip_code,
        service_type, cleaner_id,
        cleaners:cleaner_id ( id, first_name, last_name, phone, email )
      `)
      .not("cleaner_id", "is", null)
      .is("overdue_completion_alert_sent_at", null)
      .not("status", "eq", "completed")
      .not("status", "eq", "cancelled")
      .limit(80);

    if (error) throw error;

    const overdue = (rows || []).filter((b) =>
      serviceDayHasEnded(String(b.service_date || ""))
    );

    logStep("Overdue candidates", { scanned: rows?.length ?? 0, overdue: overdue.length });

    if (overdue.length === 0) {
      return new Response(
        JSON.stringify({ success: true, overdue: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const staffEmails = await resolveStaffAlertEmails(supabase);
    let staffEmailSent = false;

    if (resendKey && staffEmails.length > 0) {
      const lines = overdue.map((b) => {
        const ref = bookingRef(b);
        const customer = `${b.first_name || ""} ${b.last_name || ""}`.trim();
        const cleaner = b.cleaners as {
          first_name?: string;
          last_name?: string;
        } | null;
        const cleanerName = cleaner
          ? `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim()
          : "—";
        return `<tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${ref}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${b.service_date}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${b.time_slot || "—"}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${customer}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${cleanerName}</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">${b.status}</td>
        </tr>`;
      }).join("");

      const html = `
        <div style="font-family:system-ui,sans-serif;max-width:720px;margin:0 auto">
          <h2 style="color:#0f172a">Incomplete cleanings past service date</h2>
          <p style="color:#475569">These bookings were scheduled on or before yesterday but are still not marked complete. Please confirm status with the cleaner and update the booking in admin.</p>
          <table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0">
            <thead><tr style="background:#f1f5f9;text-align:left">
              <th style="padding:8px">Booking</th>
              <th style="padding:8px">Date</th>
              <th style="padding:8px">Window</th>
              <th style="padding:8px">Customer</th>
              <th style="padding:8px">Cleaner</th>
              <th style="padding:8px">Status</th>
            </tr></thead>
            <tbody>${lines}</tbody>
          </table>
          <p><a href="${ADMIN_BOOKINGS_URL}" style="color:#059669;font-weight:600">Open admin bookings →</a></p>
        </div>`;

      staffEmailSent = await sendStaffEmail(
        resendKey,
        staffEmails,
        `[Novara] ${overdue.length} cleaning(s) past service date — not marked complete`,
        html,
      );
    }

    let cleanerSmsSent = 0;
    let cleanerSmsFailed = 0;
    const stampedIds: string[] = [];

    for (const b of overdue) {
      const cleaner = b.cleaners as {
        id?: string;
        first_name?: string;
        phone?: string;
        email?: string;
      } | null;

      if (cleaner?.phone) {
        const fname = cleaner.first_name?.trim() || "there";
        const ref = bookingRef(b);
        const msg =
          `Novara: Hi ${fname}, your ${ref} cleaning (${b.service_date}) still shows open in our system. ` +
          `Please check in, mark complete, or reply if there was an issue: ${CLEANER_JOBS_URL}\n\nReply STOP to opt out.`;

        try {
          const { error: smsErr } = await supabase.functions.invoke("send-ghl-sms", {
            body: {
              phone: cleaner.phone,
              email: cleaner.email || undefined,
              firstName: cleaner.first_name || undefined,
              message: msg,
              type: "cleaner_status_reminder",
            },
          });
          if (smsErr) {
            cleanerSmsFailed++;
            logStep("Cleaner SMS failed", { bookingId: b.id, error: smsErr });
          } else {
            cleanerSmsSent++;
          }
        } catch (smsErr) {
          cleanerSmsFailed++;
          logStep("Cleaner SMS threw", {
            bookingId: b.id,
            error: smsErr instanceof Error ? smsErr.message : String(smsErr),
          });
        }
      }

      const { error: stampErr } = await supabase
        .from("bookings")
        .update({ overdue_completion_alert_sent_at: new Date().toISOString() })
        .eq("id", b.id)
        .is("overdue_completion_alert_sent_at", null);

      if (!stampErr) stampedIds.push(b.id);
    }

    const result = {
      success: true,
      overdue: overdue.length,
      staffRecipients: staffEmails.length,
      staffEmailSent,
      cleanerSmsSent,
      cleanerSmsFailed,
      stamped: stampedIds.length,
    };
    logStep("Done", result);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message });
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
