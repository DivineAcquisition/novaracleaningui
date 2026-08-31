// ─── /api/admin/schedule-risk ────────────────────────────────────────────────
//
// The Needs Attention surface behind the schedule guard. Detection, the cascade
// walk, the coverage ranking and the buffer rules all live in Postgres; this
// route is where a HUMAN acts on them:
//
//   GET  → the at-risk board, live delay events, the coverage board and its
//          offer trails, per-day bench depth, on-call backups, the
//          projected-vs-actual variance report, the reliability pattern per
//          cleaner, recurring coverage gaps, recent overrides, and thresholds.
//   POST → acknowledge a risk · send or dismiss the customer heads-up ·
//          rank coverage candidates · send coverage offers · direct-assign for
//          a tight window · log an ETA a cleaner gave over the phone · record a
//          cleaner-initiated cancellation · mark a job uncovered and apply the
//          goodwill credit · designate a backup · correct a duration
//          assumption · save thresholds · run the sweep.
//
// Nothing here decides a consequence. A no-show opens a QC reliability case
// automatically; whether that becomes coaching, a strike, or a suspension is a
// person's call from the QC console, and pay for completed work is never
// touched — an uncovered job's goodwill gesture comes out of margin.

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { sendPartnershipMessage } from "@/lib/partnership-comms";
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
  const coverageSinceIso = new Date(Date.now() - 14 * 86400_000).toISOString();

  const [
    board,
    events,
    backups,
    variance,
    offenders,
    overrides,
    reassignments,
    assumptions,
    coverage,
    health,
    gaps,
    reliability,
  ] = await Promise.all([
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
      (supabase.from as any)("coverage_board_v1")
        .select("*")
        .gte("created_at", coverageSinceIso)
        .order("created_at", { ascending: false })
        .limit(120),
      (supabase.from as any)("coverage_health_v1").select("*"),
      (supabase.from as any)("coverage_gap_v1").select("*").limit(60),
      (supabase.from as any)("cleaner_reliability_v1")
        .select("*")
        .or(
          "no_shows_90d.gt.0,cancellations_90d.gt.0,nudges_unanswered_90d.gt.0," +
            "coverage_offers_accepted_90d.gt.0,days_on_call_90d.gt.0",
        )
        .order("no_shows_90d", { ascending: false })
        .limit(60),
    ]);

  const rows = (board.data || []) as any[];
  const openRows = rows.filter((r) => r.status === "open" || r.status === "acknowledged");
  const coverageRows = (coverage.data || []) as any[];
  const liveCoverage = coverageRows.filter(
    (r) => r.status === "sourcing" || r.status === "offered",
  );
  const healthRows = (health.data || []) as any[];

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
    coverage: coverageRows,
    coverageHealth: healthRows,
    coverageGaps: gaps.data || [],
    reliability: reliability.data || [],
    counts: {
      atRisk: openRows.length,
      unacknowledged: openRows.filter((r) => r.status === "open").length,
      awaitingCustomerMessage: openRows.filter((r) => r.message_status === "pending").length,
      escalated: openRows.filter((r) => r.escalated_at || r.message_escalated_at).length,
      noShows: openRows.filter((r) => r.delay_event_type === "no_show").length,
      coverageOpen: liveCoverage.length,
      coverageUrgent: liveCoverage.filter((r) => r.is_urgent).length,
      // The highest-severity operational event in the system, so it gets its
      // own number rather than being folded into "at risk".
      uncovered: coverageRows.filter((r) => r.status === "uncovered").length,
      // Days with jobs and nobody on the bench, counted from today forward:
      // the thing the coverage view exists to make impossible to miss.
      daysWithoutBackup: healthRows.filter(
        (r) => r.uncovered_day && r.service_date >= onCallDate,
      ).length,
      strDaysExposed: healthRows.filter(
        (r) => r.str_day_exposed && r.service_date >= onCallDate,
      ).length,
    },
  });
}

// ─── Coverage handoff ────────────────────────────────────────────────────────

interface CoverageMoveResult {
  ok: boolean;
  status?: number;
  error?: string;
  code?: string;
  bufferConflict?: unknown;
  jobId?: string | null;
  fromCleanerName?: string | null;
  toCleanerName?: string | null;
  wasDesignatedBackup?: boolean;
}

/**
 * Move a booking to a new cleaner and leave a complete trail behind it.
 *
 * Everything goes through the canonical assign path (admin-booking-assign)
 * rather than writing assignments here, because that path is what gives the
 * incoming cleaner the WHOLE job — address and unit, access method, the scope
 * checklist and add-ons, the special instructions, the deadline and their
 * locked pay — and what withdraws the outgoing cleaner so the job leaves their
 * portal and their time-scoped access to its details goes with it. A partially
 * informed replacement is how a covered job still fails.
 */
async function moveCoverage(
  supabase: SupabaseClient,
  jwt: string,
  principal: { userId: string; email: string },
  opts: {
    bookingId: string;
    toCleanerId: string;
    reason: string;
    via: "direct_assign" | "manual";
    urgencyReason?: string;
    bufferOverrideReason?: string;
    riskFlagId?: string | null;
    delayEventId?: string | null;
    coverageRequestId?: string | null;
  },
): Promise<CoverageMoveResult> {
  const nowIso = new Date().toISOString();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, job_id, cleaner_id, service_date")
    .eq("id", opts.bookingId)
    .maybeSingle();
  if (!booking) return { ok: false, status: 404, error: "Booking not found." };

  const [{ data: fromCleaner }, { data: toCleaner }] = await Promise.all([
    booking.cleaner_id
      ? supabase.from("cleaners").select("id, first_name, last_name").eq("id", booking.cleaner_id).maybeSingle()
      : Promise.resolve({ data: null } as any),
    supabase.from("cleaners").select("id, first_name, last_name").eq("id", opts.toCleanerId).maybeSingle(),
  ]);
  if (!toCleaner) return { ok: false, status: 404, error: "That cleaner isn't in the directory." };

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
  const res = await fetch(`${supabaseUrl}/functions/v1/admin-booking-assign`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${jwt}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
    },
    body: JSON.stringify({
      bookingId: opts.bookingId,
      cleanerIds: [opts.toCleanerId],
      mode: "replace",
      notify: true,
      allowUnpaid: true,
      actorName: principal.email,
      bufferOverrideReason: opts.bufferOverrideReason || undefined,
    }),
  });
  const assignJson = (await res.json().catch(() => ({}))) as Record<string, any>;
  if (!res.ok || assignJson?.error) {
    return {
      ok: false,
      status: res.status === 409 ? 409 : 502,
      error: assignJson?.error || "Reassignment failed.",
      code: assignJson?.code,
      bufferConflict: assignJson?.bufferConflict,
    };
  }

  const { data: backupRow } = await (supabase.from as any)("daily_backup_cleaners")
    .select("id")
    .eq("cleaner_id", opts.toCleanerId)
    .eq("on_call_date", booking.service_date)
    .eq("active", true)
    .maybeSingle();

  const name = (c: any) => (c ? `${c.first_name || ""} ${c.last_name || ""}`.trim() : null);
  const fullReason = opts.urgencyReason
    ? `${opts.reason} — urgent: ${opts.urgencyReason}`
    : opts.reason;

  await (supabase.from as any)("booking_reassignments").insert({
    booking_id: opts.bookingId,
    job_id: assignJson.jobId || booking.job_id || null,
    from_cleaner_id: booking.cleaner_id || null,
    from_cleaner_name: name(fromCleaner),
    to_cleaner_id: opts.toCleanerId,
    to_cleaner_name: name(toCleaner),
    delay_event_id: opts.delayEventId || null,
    risk_flag_id: opts.riskFlagId || null,
    reason: fullReason,
    was_designated_backup: Boolean(backupRow),
    created_by: principal.userId,
    created_by_name: principal.email,
  });

  if (backupRow) {
    await (supabase.from as any)("daily_backup_cleaners")
      .update({ activated_booking_id: opts.bookingId, activated_at: nowIso })
      .eq("id", backupRow.id);
  }

  // Close the coverage search this move answers — an open request would keep
  // offering a job that now has somebody on it.
  let requestId = opts.coverageRequestId || null;
  if (!requestId) {
    const { data: live } = await (supabase.from as any)("coverage_requests")
      .select("id")
      .eq("booking_id", opts.bookingId)
      .in("status", ["sourcing", "offered"])
      .maybeSingle();
    requestId = live?.id || null;
  }
  if (requestId) {
    await supabase.rpc("settle_coverage_request", {
      p_request_id: requestId,
      p_cleaner_id: opts.toCleanerId,
      p_via: opts.via,
      p_actor: principal.userId,
      p_actor_name: principal.email,
    });
  }

  if (opts.riskFlagId) {
    await (supabase.from as any)("booking_risk_flags")
      .update({
        status: "reassigned",
        resolved_at: nowIso,
        resolution: `Covered by ${name(toCleaner) || "another cleaner"} — ${fullReason}`,
      })
      .eq("id", opts.riskFlagId);
  }

  await supabase
    .from("events")
    .insert({
      event_type: opts.via === "direct_assign" ? "coverage.direct_assigned" : "booking.coverage_reassigned",
      booking_id: opts.bookingId,
      job_id: assignJson.jobId || booking.job_id || null,
      cleaner_id: opts.toCleanerId,
      source: "schedule-risk",
      summary:
        (opts.via === "direct_assign"
          ? `⚡ Direct-assigned (offer cycle skipped): `
          : `🔀 Coverage: `) +
        `${name(fromCleaner) || "unassigned"} → ${name(toCleaner)}` +
        `${backupRow ? " (designated backup activated)" : ""} by ${principal.email}.\nReason: ${fullReason}`,
      data: {
        from_cleaner_id: booking.cleaner_id,
        to_cleaner_id: opts.toCleanerId,
        was_designated_backup: Boolean(backupRow),
        risk_flag_id: opts.riskFlagId || null,
        delay_event_id: opts.delayEventId || null,
        coverage_request_id: requestId,
        via: opts.via,
        reason: opts.reason,
        urgency_reason: opts.urgencyReason || null,
      },
    })
    .then(() => undefined, () => undefined);

  return {
    ok: true,
    jobId: assignJson.jobId || booking.job_id || null,
    fromCleanerName: name(fromCleaner),
    toCleanerName: name(toCleaner),
    wasDesignatedBackup: Boolean(backupRow),
  };
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
          .select("id, booking_number, first_name, last_name, phone, email, service_date, time_slot, address, city, state, business_account_id")
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
        const commercialAccountId = (booking as { business_account_id?: string | null }).business_account_id || null;

        if (commercialAccountId) {
          const result = await sendPartnershipMessage(supabase, {
            templateKey: "crew_lead_heads_up",
            trigger: "schedule-risk.crew_lead_heads_up",
            email: booking.email,
            phone: booking.phone,
            accountId: commercialAccountId,
            priority: "urgent",
            vars: {
              first_name: booking.first_name || "there",
              message: text.replace(/\n/g, "<br/>"),
            },
            html: `<p>Hi ${booking.first_name || "there"},</p><p>${text.replace(/\n/g, "<br/>")}</p><p>Reply to this email and it reaches the conversation on your account.</p>`,
            sms: text,
            channels: channel === "both" ? ["email", "sms"] : [channel],
          });
          for (const r of result.results) {
            if (r.status === "sent" || r.status === "queued" || r.status === "retry") sentVia.push(r.channel);
            else if (r.error) lastError = r.error;
          }
        } else {
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
       *
       * `urgent: true` is the override for a tight window (an STR turnover
       * before check-in, a job starting within the hour): it skips the offer
       * cycle entirely and demands a written urgency reason for the record.
       */
      case "reassign":
      case "direct_assign": {
        const bookingId = String(body.bookingId || "");
        const toCleanerId = String(body.toCleanerId || "");
        const reason = String(body.reason || "").trim();
        const urgent = action === "direct_assign" || body.urgent === true;
        const urgencyReason = String(body.urgencyReason || "").trim();

        if (!bookingId || !toCleanerId) {
          return NextResponse.json({ error: "bookingId and toCleanerId required" }, { status: 400 });
        }
        if (!reason) {
          return NextResponse.json({ error: "Every reassignment needs a reason on the record." }, { status: 400 });
        }
        if (urgent && !urgencyReason) {
          return NextResponse.json(
            {
              error:
                "Skipping the offer cycle needs its reason written down — what makes this window too tight to ask?",
            },
            { status: 400 },
          );
        }

        const move = await moveCoverage(supabase, bearerToken(req), principal, {
          bookingId,
          toCleanerId,
          reason,
          via: urgent ? "direct_assign" : "manual",
          urgencyReason: urgent ? urgencyReason : undefined,
          bufferOverrideReason: String(body.bufferOverrideReason || "").trim() || undefined,
          riskFlagId: body.riskFlagId || null,
          delayEventId: body.delayEventId || null,
          coverageRequestId: body.coverageRequestId || null,
        });
        if (!move.ok) {
          return NextResponse.json(
            { error: move.error, code: move.code, bufferConflict: move.bufferConflict },
            { status: move.status || 502 },
          );
        }

        return NextResponse.json({
          ok: true,
          jobId: move.jobId,
          toCleanerName: move.toCleanerName,
          wasDesignatedBackup: move.wasDesignatedBackup,
        });
      }

      // ── The offer cycle ───────────────────────────────────────────────────

      /** Start (or reuse) a coverage search for a job that needs somebody. */
      case "open_coverage": {
        const bookingId = String(body.bookingId || "");
        if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

        const { data: requestId, error } = await supabase.rpc("open_coverage_request", {
          p_booking_id: bookingId,
          p_trigger: String(body.trigger || "admin"),
          p_delay_event_id: body.delayEventId || null,
          p_risk_flag_id: body.riskFlagId || null,
          p_actor: principal.userId,
          p_actor_name: principal.email,
          p_trigger_detail: String(body.detail || "").trim() || null,
        });
        if (error) throw error;
        if (!requestId) {
          return NextResponse.json(
            { error: "Couldn't open a coverage search — the booking has no usable date or window." },
            { status: 400 },
          );
        }

        // Offering is the default. Nobody should have to remember a second tap
        // to start looking for cover.
        if (body.sendOffers !== false) {
          const { data: sent } = await supabase.rpc("issue_coverage_offers", {
            p_request_id: requestId,
            p_count: body.count ? Math.min(10, Math.max(1, Number(body.count))) : null,
          });
          return NextResponse.json({ ok: true, coverageRequestId: requestId, offersSent: sent ?? 0 });
        }
        return NextResponse.json({ ok: true, coverageRequestId: requestId, offersSent: 0 });
      }

      /** Push the next round of offers out now instead of waiting for the cycle. */
      case "offer_coverage": {
        const requestId = String(body.coverageRequestId || "");
        if (!requestId) {
          return NextResponse.json({ error: "coverageRequestId required" }, { status: 400 });
        }
        const { data: sent, error } = await supabase.rpc("issue_coverage_offers", {
          p_request_id: requestId,
          p_count: body.count ? Math.min(10, Math.max(1, Number(body.count))) : null,
        });
        if (error) throw error;
        return NextResponse.json({ ok: true, offersSent: sent ?? 0 });
      }

      case "withdraw_offer": {
        const offerId = String(body.offerId || "");
        if (!offerId) return NextResponse.json({ error: "offerId required" }, { status: 400 });
        const { error } = await (supabase.from as any)("coverage_offers")
          .update({ status: "withdrawn", responded_at: nowIso })
          .eq("id", offerId)
          .eq("status", "offered");
        if (error) throw error;
        return NextResponse.json({ ok: true });
      }

      /**
       * Nobody can take it. Marks the job uncovered, swaps the customer draft
       * to a reschedule offer with the goodwill gesture, and alerts admin — an
       * uncovered job is the highest-severity operational event we have, and
       * it is logged as a bench-depth signal rather than a cleaner failure.
       */
      case "mark_uncovered": {
        const requestId = String(body.coverageRequestId || "");
        if (!requestId) {
          return NextResponse.json({ error: "coverageRequestId required" }, { status: 400 });
        }
        const { data, error } = await supabase.rpc("mark_coverage_uncovered", {
          p_request_id: requestId,
          p_reason: String(body.reason || "").trim() || null,
          p_actor: principal.userId,
          p_actor_name: principal.email,
        });
        if (error) throw error;
        if (data && (data as any).ok === false) {
          return NextResponse.json({ error: (data as any).error }, { status: 409 });
        }
        return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
      }

      /**
       * The goodwill gesture on an uncovered job. Margin-funded through the
       * existing customer credit ledger — cleaner pay is never the source, and
       * pay for work already completed is never docked.
       */
      case "apply_goodwill": {
        const requestId = String(body.coverageRequestId || "");
        if (!requestId) {
          return NextResponse.json({ error: "coverageRequestId required" }, { status: 400 });
        }

        const { data: request } = await (supabase.from as any)("coverage_requests")
          .select("id, booking_id, goodwill_credit_cents, goodwill_applied_at")
          .eq("id", requestId)
          .maybeSingle();
        if (!request) return NextResponse.json({ error: "Coverage request not found." }, { status: 404 });
        if (request.goodwill_applied_at) {
          return NextResponse.json({ error: "That credit has already been applied." }, { status: 409 });
        }

        const amountCents = Math.round(Number(body.amountCents) || Number(request.goodwill_credit_cents) || 0);
        if (amountCents <= 0) {
          return NextResponse.json({ error: "Set the credit amount first." }, { status: 400 });
        }

        const { data: booking } = await supabase
          .from("bookings")
          .select("id, booking_number, email, first_name")
          .eq("id", request.booking_id)
          .maybeSingle();
        if (!booking?.email) {
          return NextResponse.json(
            { error: "No email on this booking to attach the credit to." },
            { status: 400 },
          );
        }

        const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "";
        const res = await fetch(`${supabaseUrl}/functions/v1/admin-grant-credit`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${bearerToken(req)}`,
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
          },
          body: JSON.stringify({
            action: "grant",
            email: booking.email,
            amountCents,
            source: "goodwill",
            reason:
              `Uncovered job ${booking.booking_number ? `NVC-${String(booking.booking_number).padStart(4, "0")}` : ""} — ` +
              `we could not staff the visit. Margin-funded; no cleaner pay affected.`,
            bookingId: request.booking_id,
          }),
        });
        const grant = (await res.json().catch(() => ({}))) as Record<string, any>;
        if (!res.ok || grant?.error) {
          return NextResponse.json(
            { error: grant?.error || "Could not apply the credit." },
            { status: 502 },
          );
        }

        await (supabase.from as any)("coverage_requests")
          .update({
            goodwill_credit_cents: amountCents,
            goodwill_applied_at: nowIso,
            goodwill_applied_by: principal.userId,
            updated_at: nowIso,
          })
          .eq("id", requestId);

        await supabase
          .from("events")
          .insert({
            event_type: "coverage.goodwill_applied",
            booking_id: request.booking_id,
            source: "schedule-risk",
            summary:
              `🎁 $${(amountCents / 100).toFixed(2)} goodwill credit applied to ` +
              `${booking.first_name || "the customer"} for an uncovered job, by ${principal.email}. ` +
              `Funded from margin — no cleaner pay affected.`,
            data: { coverage_request_id: requestId, amount_cents: amountCents },
          })
          .then(() => undefined, () => undefined);

        return NextResponse.json({ ok: true, amountCents });
      }

      case "run_coverage_cycle": {
        const { data, error } = await supabase.rpc("run_coverage_cycle");
        if (error) throw error;
        return NextResponse.json({ ok: true, result: data });
      }

      // ── Contact before conclusion ─────────────────────────────────────────

      /**
       * The ETA a VA got on the phone. This is the difference between a late
       * job we can explain and a no-show we can't, so logging it has to be
       * one field and one tap.
       */
      case "record_eta": {
        const bookingId = String(body.bookingId || "");
        if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

        const minutes = Number(body.etaMinutes);
        const etaAt = body.etaAt
          ? new Date(String(body.etaAt)).toISOString()
          : Number.isFinite(minutes) && minutes > 0 && minutes <= 600
          ? new Date(Date.now() + minutes * 60_000).toISOString()
          : null;
        if (!etaAt) {
          return NextResponse.json(
            { error: "Give the ETA they actually said — minutes out, or a time." },
            { status: 400 },
          );
        }

        const { data, error } = await supabase.rpc("record_cleaner_eta", {
          p_booking_id: bookingId,
          p_eta: etaAt,
          p_note: String(body.note || "").trim() || null,
          p_via: String(body.via || "call"),
          p_actor: principal.userId,
          p_actor_name: principal.email,
        });
        if (error) throw error;
        if (data && (data as any).ok === false) {
          return NextResponse.json({ error: (data as any).error }, { status: 400 });
        }
        return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
      }

      /** Send the cleaner another nudge with the one-tap ETA link. */
      case "nudge_cleaner": {
        const bookingId = String(body.bookingId || "");
        if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

        const { data: event } = await (supabase.from as any)("schedule_delay_events")
          .select("id, cleaner_id, nudge_count")
          .eq("booking_id", bookingId)
          .in("event_type", ["late_start", "no_show"])
          .is("resolved_at", null)
          .order("detected_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (!event) {
          return NextResponse.json(
            { error: "Nothing open on this booking to nudge about." },
            { status: 404 },
          );
        }

        const { data: cleaner } = await supabase
          .from("cleaners")
          .select("id, first_name, phone")
          .eq("id", event.cleaner_id)
          .maybeSingle();

        const { error } = await (supabase.from as any)("coverage_notifications").insert({
          booking_id: bookingId,
          delay_event_id: event.id,
          cleaner_id: event.cleaner_id,
          audience: "cleaner",
          kind: "nudge",
          channels: ["sms", "push"],
          to_phone: cleaner?.phone || null,
          title: "Are you on the way?",
          body:
            `Novara: we still haven't heard from you and your window has opened. ` +
            `Tap to send your ETA or tell us you can't make it: {{ETA_URL}}`,
        });
        if (error) throw error;

        await (supabase.from as any)("schedule_delay_events")
          .update({ nudge_count: (Number(event.nudge_count) || 0) + 1, nudge_sent_at: nowIso })
          .eq("id", event.id);

        return NextResponse.json({ ok: true });
      }

      /**
       * A cleaner told us in advance. Logged as a cancellation with the notice
       * period — deliberately not a no-show, and it starts coverage straight
       * away, because more time is better coverage odds.
       */
      case "cleaner_cancellation": {
        const bookingId = String(body.bookingId || "");
        if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });

        const { data, error } = await supabase.rpc("record_cleaner_cancellation", {
          p_booking_id: bookingId,
          p_cleaner_id: body.cleanerId || null,
          p_reason: String(body.reason || "").trim() || null,
          p_via: String(body.via || "admin"),
          p_actor: principal.userId,
          p_actor_name: principal.email,
        });
        if (error) throw error;
        if (data && (data as any).ok === false) {
          return NextResponse.json({ error: (data as any).error }, { status: 400 });
        }

        const requestId = (data as any)?.coverageRequestId;
        if (requestId && body.sendOffers !== false) {
          const { data: sent } = await supabase.rpc("issue_coverage_offers", {
            p_request_id: requestId,
            p_count: null,
          });
          return NextResponse.json({ ok: true, ...(data as Record<string, unknown>), offersSent: sent ?? 0 });
        }
        return NextResponse.json({ ok: true, ...(data as Record<string, unknown>) });
      }

      /** The immovable finish time on a job (STR guest check-in, event start). */
      case "set_hard_deadline": {
        const bookingId = String(body.bookingId || "");
        if (!bookingId) return NextResponse.json({ error: "bookingId required" }, { status: 400 });
        const deadline = body.deadlineAt ? new Date(String(body.deadlineAt)) : null;
        if (body.deadlineAt && Number.isNaN(deadline?.getTime())) {
          return NextResponse.json({ error: "That deadline isn't a valid time." }, { status: 400 });
        }
        const { error } = await supabase
          .from("bookings")
          .update({ hard_deadline_at: deadline ? deadline.toISOString() : null } as never)
          .eq("id", bookingId);
        if (error) throw error;
        return NextResponse.json({ ok: true });
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

        // Backup is a scheduling LABEL on availability the cleaner already
        // gave us, not a new commitment we can invent for them. Designating
        // someone who told us they don't work that day would put a name on the
        // coverage view that can't actually be activated — which is worse than
        // an honestly empty day.
        const { data: window } = await supabase.rpc("cleaner_stated_window", {
          p_cleaner_id: cleanerId,
          p_date: onCallDate,
        });
        const win = (window || {}) as { available?: boolean; note?: string };
        if (win.available === false && body.force !== true) {
          return NextResponse.json(
            {
              error:
                `${cleaner.first_name} isn't available that day — ${win.note || "their stated availability doesn't cover it"}. ` +
                `Being on call is a label on availability they already gave us, not a new commitment.`,
              code: "unavailable_that_day",
            },
            { status: 400 },
          );
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
        merged.cleaner_nudge_minutes = clampInt(merged.cleaner_nudge_minutes, 1, 240);
        merged.late_start_minutes = clampInt(merged.late_start_minutes, 1, 240);
        merged.no_show_minutes = clampInt(merged.no_show_minutes, 1, 480);
        merged.overrun_grace_minutes = clampInt(merged.overrun_grace_minutes, 0, 240);
        merged.field_flag_overrun_minutes = clampInt(merged.field_flag_overrun_minutes, 0, 480);
        merged.risk_ack_escalate_minutes = clampInt(merged.risk_ack_escalate_minutes, 1, 480);
        merged.customer_message_escalate_minutes = clampInt(merged.customer_message_escalate_minutes, 1, 480);
        merged.travel_speed_mph = clampInt(merged.travel_speed_mph, 5, 80);
        merged.variance_min_samples = clampInt(merged.variance_min_samples, 1, 100);
        merged.coverage_offer_window_minutes = clampInt(merged.coverage_offer_window_minutes, 1, 240);
        merged.coverage_simultaneous_offers = clampInt(merged.coverage_simultaneous_offers, 1, 10);
        merged.coverage_max_rounds = clampInt(merged.coverage_max_rounds, 1, 20);
        merged.coverage_give_up_minutes = clampInt(merged.coverage_give_up_minutes, 5, 480);
        merged.coverage_urgent_within_minutes = clampInt(merged.coverage_urgent_within_minutes, 0, 480);
        merged.goodwill_credit_cents = clampInt(merged.goodwill_credit_cents, 0, 50_000);
        merged.short_notice_cancel_hours = clampInt(merged.short_notice_cancel_hours, 1, 336);

        // Contact before conclusion is a rule, not a preference, so the ladder
        // is enforced here rather than trusted to whoever edits the numbers:
        // the cleaner is nudged before the VA is pulled in, and the VA is
        // pulled in before anybody is declared a no-show.
        if (merged.cleaner_nudge_minutes > merged.late_start_minutes) {
          return NextResponse.json(
            {
              error:
                "The cleaner nudge has to come before the VA alert — reaching the person is the first step, not the second.",
            },
            { status: 400 },
          );
        }
        if (merged.no_show_minutes <= merged.late_start_minutes) {
          return NextResponse.json(
            { error: "The no-show threshold has to be later than the VA alert." },
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
