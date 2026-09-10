// admin-recurring-pause
//
// Admin/VA: pause a customer_recurring_schedules row and tell the customer
// why, by SMS and email. Resume stays a silent local toggle on the hub.
//
// Body: { scheduleId, reasonCode, reason? }
//   reasonCode — cleaner_unavailable | finding_coverage | quality |
//                customer_request | other
//   reason     — customer-facing wording (required for other; otherwise
//                fills from the preset). This exact sentence is what we
//                show in the SMS and the email.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { sendSms } from "../_shared/sms.ts";
import {
  buildRecurringPauseReason,
  buildRecurringPauseSms,
  isRecurringPauseReasonId,
  RECURRING_PAUSE_EMAIL_SUBJECT,
  type RecurringPauseReasonId,
} from "../_shared/recurring-pause.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
    status,
  });
}

// deno-lint-ignore no-explicit-any
async function ensureAdminOrVa(admin: any, jwt: string): Promise<string> {
  const userClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${jwt}` } } },
  );
  const { data: u } = await userClient.auth.getUser();
  if (!u?.user?.id) throw new Error("Not signed in.");
  const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", u.user.id);
  const ok = (roles || []).some((r: { role: string }) => ["admin", "va"].includes(r.role));
  if (!ok) throw new Error("Admins or VAs only.");
  return u.user.id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  // deno-lint-ignore no-explicit-any
  const admin: any = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Not signed in." }, 401);
    const callerId = await ensureAdminOrVa(admin, jwt);

    const body = await req.json().catch(() => ({}));
    const scheduleId = String(body?.scheduleId || "").trim();
    const reasonCodeRaw = String(body?.reasonCode || "").trim();
    if (!scheduleId) return json({ error: "scheduleId required" }, 400);
    if (!isRecurringPauseReasonId(reasonCodeRaw)) {
      return json({ error: "Pick a pause reason." }, 400);
    }
    const reasonCode: RecurringPauseReasonId = reasonCodeRaw;

    const { data: sched, error: loadErr } = await admin
      .from("customer_recurring_schedules")
      .select("*")
      .eq("id", scheduleId)
      .maybeSingle();
    if (loadErr) throw loadErr;
    if (!sched) return json({ error: "Schedule not found." }, 404);
    if (!sched.active) {
      return json({ error: "This schedule is already paused." }, 409);
    }

    const reason = String(body?.reason || "").trim()
      || buildRecurringPauseReason(reasonCode, sched.first_name);
    if (!reason) {
      return json({ error: "Write the message the customer will see." }, 400);
    }
    if (reason.length > 480) {
      return json({ error: "Keep the customer message under 480 characters." }, 400);
    }

    const nowIso = new Date().toISOString();
    const today = nowIso.slice(0, 10);
    const notes = `${sched.notes ? String(sched.notes) + " · " : ""}Paused ${today}: ${reason}`.slice(0, 2000);

    const { error: upErr } = await admin
      .from("customer_recurring_schedules")
      .update({
        active: false,
        pause_reason: reason,
        pause_reason_code: reasonCode,
        paused_at: nowIso,
        notes,
        updated_at: nowIso,
      })
      .eq("id", scheduleId);
    if (upErr) throw upErr;

    const name = `${sched.first_name || ""} ${sched.last_name || ""}`.trim() || sched.email;
    const sms = buildRecurringPauseSms(reason);
    let smsSent = false;
    let emailed = false;
    let smsError: string | null = null;
    let emailError: string | null = null;

    const toEmail = String(sched.email || "").trim();
    if (toEmail && !toEmail.toLowerCase().endsWith("@pending.novara")) {
      try {
        const { data, error } = await admin.functions.invoke("send-membership-email", {
          body: {
            type: "recurring_paused",
            email: toEmail,
            data: {
              name: String(sched.first_name || "").trim() || "there",
              reason,
              cadence: sched.cadence || "",
              subject: RECURRING_PAUSE_EMAIL_SUBJECT,
            },
          },
        });
        emailed = !error && !(data as { error?: string } | null)?.error;
        if (!emailed) {
          emailError = String((data as { error?: string } | null)?.error || error?.message || "email failed");
        }
      } catch (e) {
        emailError = e instanceof Error ? e.message : String(e);
      }
    } else {
      emailError = "No valid customer email on file.";
    }

    if (sms) {
      smsSent = await sendSms(admin, {
        toPhone: sched.phone,
        message: sms,
        type: "confirmation",
      });
      if (!smsSent && !String(sched.phone || "").trim()) smsError = "No phone on file.";
      else if (!smsSent) smsError = "SMS send failed.";
    }

    await admin.from("events").insert({
      event_type: "recurring.paused",
      source: "admin-recurring-pause",
      summary: `Recurring schedule paused for ${name} — ${reasonCode}`,
      data: {
        schedule_id: scheduleId,
        email: sched.email,
        reason_code: reasonCode,
        reason,
        by: callerId,
        sms_sent: smsSent,
        emailed,
      },
    }).then(() => undefined, () => undefined);

    return json({
      ok: true,
      smsSent,
      emailed,
      smsError,
      emailError,
      reason,
      reasonCode,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Not signed in") ? 401 : msg.includes("only") ? 403 : 500;
    console.error("[admin-recurring-pause]", msg);
    return json({ error: msg }, status);
  }
});
