// send-recurring-manage-link
//
// Texts a recurring customer their tokenized self-service link
// (app.novaracleaning.com/manage-recurring/<token>) where they can change
// date/time, skip a visit, switch frequency, or pause the plan.
//
// Callers:
//   • Admin hub ("Text manage link" button / after creating a schedule) —
//     requires an admin/VA JWT
//   • customer-recurring-generate (after each auto-generated booking) —
//     internal service-role call
//
// Body: { scheduleId: string, context?: 'created' | 'generated' | 'manual', bookingDate?: string }

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { ensureManageToken, manageUrlForToken } from "../_shared/recurring-manage.ts";
import { sendSms, formatServiceDate, formatTimeSlot } from "../_shared/sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), { headers: { ...corsHeaders, "Content-Type": "application/json" }, status });
}

// deno-lint-ignore no-explicit-any
async function ensureAuthorized(admin: any, req: Request): Promise<void> {
  const auth = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (serviceKey && auth === serviceKey) return; // internal invoke
  if (!auth) throw new Error("Not signed in.");
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${auth}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const allowed = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!allowed) throw new Error("Admins or VAs only.");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    await ensureAuthorized(admin, req);

    const body = await req.json().catch(() => ({}));
    const scheduleId = String(body?.scheduleId || "");
    const context = String(body?.context || "manual");
    const bookingDate = body?.bookingDate ? String(body.bookingDate) : null;
    if (!scheduleId) return json({ error: "scheduleId required" }, 400);

    const { data: sched } = await admin
      .from("customer_recurring_schedules")
      .select("id, email, first_name, phone, cadence, preferred_time_slot, next_service_date, active")
      .eq("id", scheduleId)
      .maybeSingle();
    if (!sched) return json({ error: "Schedule not found" }, 404);
    if (!sched.phone) return json({ error: "No phone number on this schedule — add one first." }, 400);

    const token = await ensureManageToken(admin, scheduleId);
    if (!token) return json({ error: "Could not mint manage token" }, 500);
    const url = manageUrlForToken(token);

    const greeting = sched.first_name?.trim() ? `Hi ${sched.first_name.trim()},` : "Hi,";
    const cadenceLabel = sched.cadence === "weekly" ? "weekly" : sched.cadence === "monthly" ? "monthly" : "bi-weekly";
    const dateLabel = formatServiceDate(bookingDate || sched.next_service_date || "") || "soon";
    const windowLabel = formatTimeSlot(sched.preferred_time_slot) || sched.preferred_time_slot || "";

    let message: string;
    if (context === "generated") {
      message =
        `${greeting} your next Novara clean is booked for ${dateLabel}${windowLabel ? ` (${windowLabel})` : ""}. ` +
        `Need to move it, skip it, or change your ${cadenceLabel} plan? Manage it here:\n${url}\n\nReply STOP to opt out.`;
    } else if (context === "created") {
      message =
        `${greeting} your Novara ${cadenceLabel} cleaning plan is all set${sched.next_service_date ? ` — first visit ${dateLabel}${windowLabel ? ` (${windowLabel})` : ""}` : ""}. ` +
        `Save this link to change dates/times, skip a visit, or pause anytime:\n${url}\n\nReply STOP to opt out.`;
    } else {
      message =
        `${greeting} here's your Novara recurring-clean manage link — change date/time, skip a visit, switch frequency, or pause anytime:\n${url}\n\nReply STOP to opt out.`;
    }

    const ok = await sendSms(admin, { toPhone: sched.phone, message, type: "confirmation" });
    if (!ok) return json({ error: "SMS send failed" }, 502);

    return json({ ok: true, url, context });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[send-recurring-manage-link]", msg);
    return json({ error: msg }, msg.includes("signed in") || msg.includes("only") ? 401 : 500);
  }
});
