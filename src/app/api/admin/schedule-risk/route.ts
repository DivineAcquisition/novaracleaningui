// ─── /api/admin/schedule-risk ────────────────────────────────────────────────
//
// The Needs Attention surface behind the schedule guard. Detection, the cascade
// walk, and the buffer rules all live in Postgres; this route is where a HUMAN
// acts on them:
//
//   GET  → the at-risk board, live delay events, on-call backups, the
//          projected-vs-actual variance report, recent overrides and coverage
//          moves, and the thresholds.
//   POST → acknowledge a risk · send or dismiss the customer heads-up ·
//          rank coverage candidates · one-tap reassign · designate a backup ·
//          correct a duration assumption · save thresholds · run the sweep.
//
// Nothing here decides a consequence. A no-show opens a QC reliability case
// automatically; whether that becomes coaching, a strike, or a suspension is a
// person's call from the QC console, and pay for completed work is never
// touched.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  SCHEDULE_GUARD_SETTINGS_KEY,
  mergeScheduleGuardSettings,
  type ScheduleGuardSettings,
} from "@/lib/schedule-risk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function bearerToken(req: Request): string {
  return (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

function todayInZone(tz: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

async function readSettings(supabase: SupabaseClient): Promise<ScheduleGuardSettings> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", SCHEDULE_GUARD_SETTINGS_KEY)
    .maybeSingle();
  return mergeScheduleGuardSettings((data as { value?: unknown } | null)?.value);
}

// ─── GET: the board ──────────────────────────────────────────────────────────

export async function GET(req: Request): Promise<NextResponse> {
  try {
    await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  const supabase = getAdminSupabase();
  const url = new URL(req.url);
  const settings = await readSettings(supabase);
  const onCallDate = url.searchParams.get("date") || todayInZone(settings.timezone);
  const includeResolved = url.searchParams.get("includeResolved") === "1";

  const sinceIso = new Date(Date.now() - 3 * 86400_000).toISOString();

  const [board, events, backups, variance, offenders, overrides, reassignments, assumptions] =
    await Promise.all([
      (supabase.from as any)("schedule_risk_board_v1")
        .select("*")
        .or(
          includeResolved
            ? `created_at.gte.${sinceIso}`
            : `status.eq.open,status.eq.acknowledged`,
        )
        .order("scheduled_start_at", { ascending: true })
        .limit(300),
      (supabase.from as any)("schedule_delay_events")
        .select("*")
        .gte("detected_at", sinceIso)
        .order("detected_at", { ascending: false })
        .limit(200),
      (supabase.from as any)("daily_backup_cleaners")
        .select("*, cleaners(id, first_name, last_name, phone, novara_score, home_zip)")
        .eq("on_call_date", onCallDate)
        .order("priority", { ascending: true }),
      (supabase.from as any)("schedule_duration_variance_v1")
        .select("*")
        .order("samples", { ascending: false })
        .limit(80),
      (supabase.from as any)("schedule_late_start_offenders_v1")
        .select("*")
        .order("late_start_rate_pct", { ascending: false })
        .limit(40),
      (supabase.from as any)("schedule_buffer_overrides")
        .select("*, bookings!schedule_buffer_overrides_booking_id_fkey(booking_number, first_name, last_name, service_date, time_slot)")
        .order("created_at", { ascending: false })
        .limit(40),
      (supabase.from as any)("booking_reassignments")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(40),
      (supabase.from as any)("service_duration_assumptions")
        .select("*")
        .order("service_type", { ascending: true })
        .order("home_size_id", { ascending: true }),
    ]);

  const rows = (board.data || []) as any[];
  const openRows = rows.filter((r) => r.status === "open" || r.status === "acknowledged");

  return NextResponse.json({
    ok: true,
    onCallDate,
    settings,
    board: rows,
    delayEvents: events.data || [],
    backups: backups.data || [],
    variance: variance.data || [],
    lateStartOffenders: offenders.data || [],
    overrides: overrides.data || [],
    reassignments: reassignments.data || [],
    assumptions: assumptions.data || [],
    counts: {
      atRisk: openRows.length,
      unacknowledged: openRows.filter((r) => r.status === "open").length,
      awaitingCustomerMessage: openRows.filter((r) => r.message_status === "pending").length,
      escalated: openRows.filter((r) => r.escalated_at || r.message_escalated_at).length,
      noShows: openRows.filter((r) => r.delay_event_type === "no_show").length,
    },
  });
}

// ─── POST: the actions ───────────────────────────────────────────────────────

export async function POST(req: Request): Promise<NextResponse> {
  let principal: { userId: string; email: string };
  try {
    principal = await requireAdmin(req);
  } catch (e) {
    const err = e as AdminAuthError;
    return NextResponse.json({ error: err.message }, { status: err.status || 401 });
  }

  const supabase = getAdminSupabase();
  const body = (await req.json().catch(() => ({}))) as Record<string, any>;
  const action = String(body.action || "");
  const nowIso = new Date().toISOString();

  try {
    switch (action) {
      // ── Someone has eyes on it ────────────────────────────────────────────
      case "acknowledge": {
        const riskFlagId = String(body.riskFlagId || "");
        if (!riskFlagId) return NextResponse.json({ error: "riskFlagId required" }, { status: 400 });
        const { error } = await (supabase.from as any)("booking_risk_flags")
          .update({
            status: "acknowledged",
            acknowledged_at: nowIso,
            acknowledged_by: principal.userId,
            acknowledged_by_name: principal.email,
          })
          .eq("id", riskFlagId)
          .eq("status", "open");
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      // ── The $160 fix: the customer hears from us ──────────────────────────
      case "send_message": {
        const messageId = String(body.messageId || "");
        if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });

        const { data: msg } = await (supabase.from as any)("booking_risk_messages")
          .select("*, booking_risk_flags(id, booking_id, delay_event_id, projected_arrival_at, reason)")
          .eq("id", messageId)
          .maybeSingle();
        if (!msg) return NextResponse.json({ error: "Message not found." }, { status: 404 });
        if (msg.status === "sent") {
          return NextResponse.json({ error: "This heads-up has already gone out." }, { status: 409 });
        }

        const { data: booking } = await supabase
          .from("bookings")
          .select("id, booking_number, first_name, last_name, phone, email, service_date, time_slot, address, city, state")
          .eq("id", msg.booking_id)
          .maybeSingle();
        if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

        // The VA may have rewritten it — what actually goes out is what gets
        // archived, not the draft we prepared.
        const text = String(body.body || msg.draft_body || "").trim();
        if (!text) return NextResponse.json({ error: "The message is empty." }, { status: 400 });
        const channel = (String(body.channel || msg.channel || "sms")) as "sms" | "email" | "both";

        const sentVia: string[] = [];
        let lastError: string | null = null;

        if ((channel === "sms" || channel === "both") && booking.phone) {
          try {
            const { error } = await supabase.functions.invoke("send-ghl-sms", {
              body: {
                phone: booking.phone,
                email: booking.email || undefined,
                firstName: booking.first_name || undefined,
                message: text,
                type: "delay_heads_up",
              },
            });
            if (error) lastError = error.message;
            else sentVia.push("sms");
          } catch (e) {
            lastError = (e as Error).message;
          }
        }
        if ((channel === "email" || channel === "both") && booking.email) {
          try {
            const { error } = await supabase.functions.invoke("admin-send-email", {
              body: {
                to: booking.email,
                subject: "Update on today's cleaning — new arrival window",
                html: `<p>${text.replace(/\n/g, "<br/>")}</p>`,
              },
            });
            if (error) lastError = error.message;
            else sentVia.push("email");
          } catch (e) {
            lastError = (e as Error).message;
          }
        }

        if (sentVia.length === 0) {
          await (supabase.from as any)("booking_risk_messages")
            .update({ status: "failed", send_error: lastError || "No reachable channel.", updated_at: nowIso })
            .eq("id", messageId);
          return NextResponse.json(
            { error: lastError || "No phone or email on this booking to reach the customer." },
            { status: 502 },
          );
        }

        await (supabase.from as any)("booking_risk_messages")
          .update({
            status: "sent",
            sent_body: text,
            sent_at: nowIso,
            sent_by: principal.userId,
            sent_by_name: principal.email,
            channel: sentVia.length > 1 ? "both" : sentVia[0],
            send_error: null,
            updated_at: nowIso,
          })
          .eq("id", messageId);

        // Sending is acting: the risk is no longer unattended.
        await (supabase.from as any)("booking_risk_flags")
          .update({
            status: "acknowledged",
            acknowledged_at: nowIso,
            acknowledged_by: principal.userId,
            acknowledged_by_name: principal.email,
          })
          .eq("id", msg.risk_flag_id)
          .eq("status", "open");

        // Logged to the booking, so the conversation is traceable end to end
        // and the customer's reply lands in the same inbox as everything else.
        await supabase
          .from("events")
          .insert({
            event_type: "booking.at_risk_customer_notified",
            booking_id: msg.booking_id,
            source: "schedule-risk",
            summary:
              `📣 Delay heads-up sent to ${booking.first_name || "the customer"} via ${sentVia.join(" + ")} ` +
              `by ${principal.email}${msg.new_eta_at ? ` — new ETA ${new Date(msg.new_eta_at).toISOString()}` : ""}.\n${text}`,
            data: {
              risk_message_id: messageId,
              risk_flag_id: msg.risk_flag_id,
              channels: sentVia,
              new_eta_at: msg.new_eta_at,
              body: text,
            },
          })
          .then(() => undefined, () => undefined);

        return NextResponse.json({ ok: true, channels: sentVia });
      }

      case "dismiss_message": {
        const messageId = String(body.messageId || "");
        const reason = String(body.reason || "").trim();
        if (!messageId) return NextResponse.json({ error: "messageId required" }, { status: 400 });
        if (!reason) {
          return NextResponse.json(
            { error: "Say why the customer doesn't need this — a dismissal without a reason is silence." },
            { status: 400 },
          );
        }
        const { error } = await (supabase.from as any)("booking_risk_messages")
          .update({
            status: "dismissed",
            dismissed_at: nowIso,
            dismissed_by: principal.userId,
            dismissed_by_name: principal.email,
            dismiss_reason: reason,
            updated_at: nowIso,
          })
          .eq("id", messageId)
          .eq("status", "pending");
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      case "resolve_flag": {
        const riskFlagId = String(body.riskFlagId || "");
        if (!riskFlagId) return NextResponse.json({ error: "riskFlagId required" }, { status: 400 });
        const { error } = await (supabase.from as any)("booking_risk_flags")
          .update({
            status: "resolved",
            resolved_at: nowIso,
            resolution: String(body.resolution || "").trim() || `Closed by ${principal.email}.`,
          })
          .eq("id", riskFlagId);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      // ── Coverage ──────────────────────────────────────────────────────────
      case "coverage": {
        const bookingId = String(body.bookingId || "");
        if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
        const { data, error } = await supabase.rpc("suggest_coverage_cleaners", {
          p_booking_id: bookingId,
          p_limit: Math.min(20, Math.max(1, Number(body.limit) || 8)),
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, candidates: data || [] });
      }

      /**
       * One-tap reassignment through the existing dispatch flow, so the new
       * cleaner's portal receives the FULL job — access, scope, checklist,
       * tokenized links — exactly as any assigned job, and the original
       * cleaner's assignment is withdrawn so it leaves their portal.
       */
      case "reassign": {
        const bookingId = String(body.bookingId || "");
        const toCleanerId = String(body.toCleanerId || "");
        const reason = String(body.reason || "").trim();
        if (!bookingId || !toCleanerId) {
          return NextResponse.json({ error: "bookingId and toCleanerId required" }, { status: 400 });
        }
        if (!reason) {
          return NextResponse.json({ error: "Every reassignment needs a reason on the record." }, { status: 400 });
        }

        const { data: booking } = await supabase
          .from("bookings")
          .select("id, job_id, cleaner_id, service_date")
          .eq("id", bookingId)
          .maybeSingle();
        if (!booking) return NextResponse.json({ error: "Booking not found." }, { status: 404 });

        const [{ data: fromCleaner }, { data: toCleaner }] = await Promise.all([
          booking.cleaner_id
            ? supabase.from("cleaners").select("id, first_name, last_name").eq("id", booking.cleaner_id).maybeSingle()
            : Promise.resolve({ data: null } as any),
          supabase.from("cleaners").select("id, first_name, last_name").eq("id", toCleanerId).maybeSingle(),
        ]);
        if (!toCleaner) return NextResponse.json({ error: "That cleaner isn't in the directory." }, { status: 404 });

        // Reuse the canonical assign path rather than writing assignments here:
        // it withdraws the prior crew, issues the checklist tokens, notifies the
        // incoming cleaner, and syncs GHL. Forward the admin's own JWT so the
        // action is attributed to them.
        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const res = await fetch(`${supabaseUrl}/functions/v1/admin-booking-assign`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearerToken(req)}`,
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
          },
          body: JSON.stringify({
            bookingId,
            cleanerIds: [toCleanerId],
            mode: "replace",
            notify: true,
            allowUnpaid: true,
            bufferOverrideReason: String(body.bufferOverrideReason || "").trim() || undefined,
          }),
        });
        const assignJson = (await res.json().catch(() => ({}))) as Record<string, any>;
        if (!res.ok || assignJson?.error) {
          return NextResponse.json(
            { error: assignJson?.error || "Reassignment failed.", code: assignJson?.code, bufferConflict: assignJson?.bufferConflict },
            { status: res.status === 409 ? 409 : 502 },
          );
        }

        const { data: backupRow } = await (supabase.from as any)("daily_backup_cleaners")
          .select("id")
          .eq("cleaner_id", toCleanerId)
          .eq("on_call_date", booking.service_date)
          .eq("active", true)
          .maybeSingle();

        const name = (c: any) => (c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : null);

        await (supabase.from as any)("booking_reassignments").insert({
          booking_id: bookingId,
          job_id: assignJson.jobId || booking.job_id || null,
          from_cleaner_id: booking.cleaner_id || null,
          from_cleaner_name: name(fromCleaner),
          to_cleaner_id: toCleanerId,
          to_cleaner_name: name(toCleaner),
          delay_event_id: body.delayEventId || null,
          risk_flag_id: body.riskFlagId || null,
          reason,
          was_designated_backup: Boolean(backupRow),
          created_by: principal.userId,
          created_by_name: principal.email,
        });

        if (backupRow) {
          await (supabase.from as any)("daily_backup_cleaners")
            .update({ activated_booking_id: bookingId, activated_at: nowIso })
            .eq("id", backupRow.id);
        }

        if (body.riskFlagId) {
          await (supabase.from as any)("booking_risk_flags")
            .update({
              status: "reassigned",
              resolved_at: nowIso,
              resolution: `Covered by ${name(toCleaner) || "another cleaner"} — ${reason}`,
            })
            .eq("id", body.riskFlagId);
        }

        await supabase
          .from("events")
          .insert({
            event_type: "booking.coverage_reassigned",
            booking_id: bookingId,
            job_id: assignJson.jobId || booking.job_id || null,
            cleaner_id: toCleanerId,
            source: "schedule-risk",
            summary:
              `🔀 Coverage: ${name(fromCleaner) || "unassigned"} → ${name(toCleaner)}` +
              `${backupRow ? " (designated backup activated)" : ""} by ${principal.email}.\nReason: ${reason}`,
            data: {
              from_cleaner_id: booking.cleaner_id,
              to_cleaner_id: toCleanerId,
              was_designated_backup: Boolean(backupRow),
              risk_flag_id: body.riskFlagId || null,
              delay_event_id: body.delayEventId || null,
              reason,
            },
          })
          .then(() => undefined, () => undefined);

        return NextResponse.json({ ok: true, jobId: assignJson.jobId, notifications: assignJson.notifications });
      }

      // ── On-call designation ───────────────────────────────────────────────
      case "designate_backup": {
        const cleanerId = String(body.cleanerId || "");
        const onCallDate = String(body.onCallDate || "");
        if (!cleanerId || !onCallDate) {
          return NextResponse.json({ error: "cleanerId and onCallDate required" }, { status: 400 });
        }

        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("id, first_name, last_name, status, approved")
          .eq("id", cleanerId)
          .maybeSingle();
        if (!cleaner) return NextResponse.json({ error: "Cleaner not found." }, { status: 404 });
        if (cleaner.status !== "active" || !cleaner.approved) {
          return NextResponse.json({ error: "Only active, approved cleaners can be on call." }, { status: 400 });
        }

        const { error } = await (supabase.from as any)("daily_backup_cleaners").upsert(
          {
            cleaner_id: cleanerId,
            on_call_date: onCallDate,
            priority: Math.max(1, Number(body.priority) || 100),
            zips: Array.isArray(body.zips) ? body.zips.map(String) : [],
            notes: String(body.notes || "").trim() || null,
            active: true,
            designated_by: principal.userId,
            designated_by_name: principal.email,
            updated_at: nowIso,
          },
          { onConflict: "cleaner_id,on_call_date" },
        );
        if (error) throw error;

        await supabase
          .from("events")
          .insert({
            event_type: "schedule.backup_designated",
            cleaner_id: cleanerId,
            source: "schedule-risk",
            summary:
              `🛟 ${cleaner.first_name} ${cleaner.last_name} is on call for ${onCallDate} ` +
              `(designated by ${principal.email}). Normal assignment and normal pay if activated.`,
            data: { on_call_date: onCallDate, priority: Number(body.priority) || 100 },
          })
          .then(() => undefined, () => undefined);

        return NextResponse.json({ ok: true });
      }

      case "release_backup": {
        const id = String(body.id || "");
        if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
        const { error } = await (supabase.from as any)("daily_backup_cleaners")
          .update({ active: false, updated_at: nowIso })
          .eq("id", id);
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      // ── Learning loop: correct the model from measured reality ────────────
      case "apply_duration_correction": {
        const serviceType = String(body.serviceType || "");
        const homeSizeId = String(body.homeSizeId || "");
        const multiplier = Number(body.multiplier);
        if (!serviceType || !homeSizeId) {
          return NextResponse.json({ error: "serviceType and homeSizeId required" }, { status: 400 });
        }
        if (!Number.isFinite(multiplier) || multiplier < 0.5 || multiplier > 2.5) {
          return NextResponse.json({ error: "Multiplier must be between 0.5 and 2.5." }, { status: 400 });
        }

        const { data: variance } = await (supabase.from as any)("schedule_duration_variance_v1")
          .select("samples, avg_variance_pct, learned_multiplier")
          .eq("service_type", serviceType)
          .eq("home_size_id", homeSizeId)
          .maybeSingle();

        const { error } = await (supabase.from as any)("service_duration_assumptions")
          .update({
            learned_multiplier: multiplier,
            learned_from_samples: Number(variance?.samples) || 0,
            learned_at: nowIso,
            learned_by: principal.userId,
            learned_note: String(body.note || "").trim() || null,
            updated_at: nowIso,
          })
          .eq("service_type", serviceType)
          .eq("home_size_id", homeSizeId);
        if (error) throw error;

        await supabase
          .from("events")
          .insert({
            event_type: "schedule.duration_model_corrected",
            source: "schedule-risk",
            summary:
              `📐 Duration assumption for ${serviceType} / ${homeSizeId} set to ×${multiplier} by ${principal.email} ` +
              `off ${variance?.samples ?? 0} measured jobs (${variance?.avg_variance_pct ?? 0}% average variance). ` +
              `Buffers and quotes built on this projection move with it.`,
            data: {
              service_type: serviceType,
              home_size_id: homeSizeId,
              multiplier,
              previous_multiplier: variance?.learned_multiplier ?? 1,
              samples: variance?.samples ?? 0,
              avg_variance_pct: variance?.avg_variance_pct ?? null,
            },
          })
          .then(() => undefined, () => undefined);

        return NextResponse.json({ ok: true });
      }

      // ── Thresholds ────────────────────────────────────────────────────────
      case "save_settings": {
        const incoming = (body.settings || {}) as Record<string, unknown>;
        const current = await readSettings(supabase);
        const merged = mergeScheduleGuardSettings({ ...current, ...incoming });

        const clampInt = (v: number, lo: number, hi: number) =>
          Math.min(hi, Math.max(lo, Math.round(Number(v) || 0)));
        merged.buffer_minutes = clampInt(merged.buffer_minutes, 0, 480);
        merged.late_start_minutes = clampInt(merged.late_start_minutes, 1, 240);
        merged.no_show_minutes = clampInt(merged.no_show_minutes, 1, 480);
        merged.overrun_grace_minutes = clampInt(merged.overrun_grace_minutes, 0, 240);
        merged.field_flag_overrun_minutes = clampInt(merged.field_flag_overrun_minutes, 0, 480);
        merged.risk_ack_escalate_minutes = clampInt(merged.risk_ack_escalate_minutes, 1, 480);
        merged.customer_message_escalate_minutes = clampInt(merged.customer_message_escalate_minutes, 1, 480);
        merged.travel_speed_mph = clampInt(merged.travel_speed_mph, 5, 80);
        merged.variance_min_samples = clampInt(merged.variance_min_samples, 1, 100);

        // The no-show threshold sits AFTER the late-start alert by definition —
        // the 15-minute nudge always precedes the 30-minute escalation.
        if (merged.no_show_minutes <= merged.late_start_minutes) {
          return NextResponse.json(
            { error: "The no-show threshold has to be later than the late-start alert." },
            { status: 400 },
          );
        }

        const { error } = await supabase.from("app_settings").upsert(
          {
            key: SCHEDULE_GUARD_SETTINGS_KEY,
            value: merged as unknown as Record<string, unknown>,
            updated_at: nowIso,
            updated_by: principal.userId,
          },
          { onConflict: "key" },
        );
        if (error) throw error;
        return NextResponse.json({ ok: true, settings: merged });
      }

      /**
       * Run the detection sweep now instead of waiting for the five-minute
       * cron — used to verify the chain end to end (simulate a late start, see
       * the event, the at-risk booking, and the drafted text appear).
       */
      case "run_sweep": {
        const { data, error } = await supabase.rpc("sweep_schedule_risk");
        if (error) throw error;
        return NextResponse.json({ ok: true, result: data });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (e) {
    const message = (e as Error).message || "Something went wrong.";
    // eslint-disable-next-line no-console
    console.error("[schedule-risk]", action, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
