// ─── VA Performance admin API ─────────────────────────────────────────────────
//
// Backs the VA Performance tab. Admin-only (not VA) — this surface shows every
// VA's verified numbers, their blockers and their coaching history, and none of
// that should be visible to peers. Qualitative fields in particular are only
// safe to be honest in if the audience is the person they're addressed to.
//
// Nothing in here penalizes anyone. Reviewing a flag records a human decision;
// the coaching log records a documented conversation. Neither touches pay,
// status, or access.

import { NextResponse } from "next/server";

import { AdminAuthError, requireAdmin } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { isApployeConfigured, listMembers as listApployeMembers } from "@/lib/apploye/client";
import { syncTeamPerformanceBase } from "@/lib/va-performance/airtable";
import {
  generatePeriod,
  listTargets,
  openFlagCounts,
  readSubmissions,
  todayView,
  vaDetail,
} from "@/lib/va-performance/reporting";
import {
  addDays,
  getDiscrepancyThresholds,
  getEodSettings,
  localDate,
  primePerformanceSecrets,
} from "@/lib/va-performance/settings";
import { listAllVas } from "@/lib/va-performance/vas";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const FLAG_STATUSES = ["open", "explained", "confirmed_issue", "dismissed"] as const;
const COACHING_TYPES = ["coaching_note", "formal_warning", "recognition", "performance_review"] as const;
const PERFORMANCE_STATUSES = ["active", "probation", "inactive", "removed"] as const;
const RATINGS = ["exceeding", "on_track", "needs_improvement", "at_risk"] as const;

function fail(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

const str = (v: unknown) => String(v ?? "").trim();

export async function POST(req: Request): Promise<NextResponse> {
  let principal: { userId: string; email: string };
  try {
    principal = await requireAdmin(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return fail(e.message, e.status || 401);
  }

  await primePerformanceSecrets();
  const supabase = getAdminSupabase();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = str(body.action) || "overview";

  try {
    switch (action) {
      // ── Reads ──────────────────────────────────────────────────────────
      case "overview": {
        const settings = await getEodSettings();
        const today = localDate(new Date(), settings.timezone);
        const [view, vas, targets, thresholds] = await Promise.all([
          todayView(body.date ? str(body.date) : undefined),
          listAllVas(),
          listTargets(),
          getDiscrepancyThresholds(),
        ]);
        return NextResponse.json({ ok: true, today: view, vas, targets, settings, thresholds, serverDate: today });
      }

      case "compliance": {
        const settings = await getEodSettings();
        const today = localDate(new Date(), settings.timezone);
        const days = Math.min(90, Math.max(7, Number(body.days) || 30));
        const startDate = addDays(today, -(days - 1));
        const vas = await listAllVas();
        const tracked = vas.filter((v) => v.status === "approved" && v.performanceStatus !== "removed");
        const submissions = await readSubmissions(tracked.map((v) => v.id), startDate, today);
        const flags = await openFlagCounts(tracked.map((v) => v.id));
        return NextResponse.json({
          ok: true,
          startDate,
          endDate: today,
          vas: tracked,
          submissions,
          openFlags: Object.fromEntries(flags),
        });
      }

      case "va_detail": {
        const vaId = str(body.vaId);
        if (!vaId) return fail("Missing vaId.");
        const settings = await getEodSettings();
        const today = localDate(new Date(), settings.timezone);
        const days = Math.min(180, Math.max(7, Number(body.days) || 30));
        const detail = await vaDetail(vaId, addDays(today, -(days - 1)), today);
        return NextResponse.json({ ok: true, ...detail });
      }

      case "flag_queue": {
        const statuses = Array.isArray(body.statuses)
          ? (body.statuses as unknown[]).map(str).filter((s) => (FLAG_STATUSES as readonly string[]).includes(s))
          : ["open", "explained"];
        const { data, error } = await supabase
          .from("va_discrepancy_flags")
          .select("*")
          .in("status", statuses.length ? statuses : ["open"])
          .order("severity", { ascending: false })
          .order("work_date", { ascending: false })
          .limit(300);
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, flags: data || [], vas: await listAllVas() });
      }

      // ── Discrepancy review: a human decides ────────────────────────────
      case "review_flag": {
        const flagId = str(body.flagId);
        const status = str(body.status);
        if (!flagId) return fail("Missing flagId.");
        if (!(FLAG_STATUSES as readonly string[]).includes(status)) return fail("Invalid status.");

        const note = str(body.reviewNote);
        if ((status === "confirmed_issue" || status === "dismissed") && !note) {
          // A conclusion without a written reason isn't a review.
          return fail("Add a review note explaining the decision.");
        }

        const { data, error } = await supabase
          .from("va_discrepancy_flags")
          .update({
            status,
            review_note: note || null,
            reviewed_by: principal.userId,
            reviewed_by_name: principal.email,
            reviewed_at: new Date().toISOString(),
          })
          .eq("id", flagId)
          .select("*")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return fail("Flag not found.", 404);

        const flag = data as Record<string, unknown>;
        await supabase.from("events").insert({
          event_type: "va.discrepancy.reviewed",
          source: "va-performance",
          summary: `Discrepancy ${status.replace("_", " ")} — ${flag.metric_label || flag.metric_key} on ${flag.work_date} (by ${principal.email})`,
          data: { flag_id: flagId, status, va_id: flag.va_id, reviewed_by: principal.email },
        });

        return NextResponse.json({ ok: true, flag });
      }

      // ── Performance periods ────────────────────────────────────────────
      case "generate_period": {
        const vaId = str(body.vaId);
        const periodType = str(body.periodType) === "monthly" ? "monthly" : "weekly";
        if (!vaId) return fail("Missing vaId.");
        const settings = await getEodSettings();
        const anchor = str(body.anchorDate) || localDate(new Date(), settings.timezone);
        const period = await generatePeriod(vaId, periodType, anchor);
        return NextResponse.json({ ok: true, period });
      }

      case "save_period_review": {
        const periodId = str(body.periodId);
        if (!periodId) return fail("Missing periodId.");
        const rating = str(body.overallRating);
        const update: Record<string, unknown> = {
          review_notes: str(body.reviewNotes) || null,
          reviewed_by: principal.userId,
          reviewed_by_name: principal.email,
          reviewed_at: new Date().toISOString(),
          status: str(body.status) === "final" ? "final" : "reviewed",
        };
        if (rating) {
          if (!(RATINGS as readonly string[]).includes(rating)) return fail("Invalid rating.");
          update.overall_rating = rating;
        }
        const { data, error } = await supabase
          .from("va_performance_periods")
          .update(update)
          .eq("id", periodId)
          .select("*")
          .maybeSingle();
        if (error) throw new Error(error.message);
        return NextResponse.json({ ok: true, period: data });
      }

      // ── Coaching log: documented conversations, never pay consequences ──
      case "log_coaching": {
        const vaId = str(body.vaId);
        const entryType = str(body.entryType);
        const summary = str(body.summary);
        if (!vaId) return fail("Missing vaId.");
        if (!(COACHING_TYPES as readonly string[]).includes(entryType)) return fail("Invalid entry type.");
        if (!summary) return fail("A summary is required — the record is the point.");

        const { data, error } = await supabase
          .from("va_coaching_log")
          .insert({
            va_id: vaId,
            entry_date: str(body.entryDate) || undefined,
            entry_type: entryType,
            trigger_flag_id: str(body.triggerFlagId) || null,
            trigger_period_id: str(body.triggerPeriodId) || null,
            summary,
            action_agreed: str(body.actionAgreed) || null,
            follow_up_date: str(body.followUpDate) || null,
            logged_by: principal.userId,
            logged_by_name: principal.email,
            outcome: str(body.outcome) || null,
          })
          .select("*")
          .single();
        if (error) throw new Error(error.message);

        await supabase.from("events").insert({
          event_type: "va.coaching.logged",
          source: "va-performance",
          summary: `${entryType.replace("_", " ")} logged for a VA by ${principal.email}`,
          data: { va_id: vaId, entry_type: entryType, logged_by: principal.email },
        });

        return NextResponse.json({ ok: true, entry: data });
      }

      // ── Configuration ──────────────────────────────────────────────────
      case "save_va_profile": {
        const vaId = str(body.vaId);
        if (!vaId) return fail("Missing vaId.");
        const update: Record<string, unknown> = {};
        if (body.apployeMemberId !== undefined) update.apploye_member_id = str(body.apployeMemberId) || null;
        if (body.ghlUserId !== undefined) update.ghl_user_id = str(body.ghlUserId) || null;
        if (body.startDate !== undefined) update.start_date = str(body.startDate) || null;
        if (body.rateCents !== undefined) {
          const cents = Number(body.rateCents);
          update.rate_cents = Number.isFinite(cents) && cents >= 0 ? Math.round(cents) : null;
        }
        if (Array.isArray(body.functionsAssigned)) {
          update.functions_assigned = (body.functionsAssigned as unknown[])
            .map((f) => str(f).toLowerCase())
            .filter((f) => ["operations", "sales", "recruiting"].includes(f));
        }
        if (body.performanceStatus !== undefined) {
          const status = str(body.performanceStatus);
          if (!(PERFORMANCE_STATUSES as readonly string[]).includes(status)) {
            return fail("Invalid performance status.");
          }
          update.performance_status = status;
        }
        if (!Object.keys(update).length) return fail("Nothing to update.");

        const { data, error } = await supabase
          .from("va_onboarding")
          .update(update)
          .eq("id", vaId)
          .select("id")
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) return fail("VA not found.", 404);
        return NextResponse.json({ ok: true });
      }

      // Resolve Apploye member ids by email, the same way the cleaner side
      // does it (supabase/functions/apploye-invite-cleaner). Nobody should have
      // to copy UUIDs out of a dashboard by hand.
      case "link_apploye": {
        if (!isApployeConfigured()) {
          return fail("Apploye isn't connected — set APPLOYE_API_KEY in app_secrets.", 503);
        }
        let members;
        try {
          members = await listApployeMembers();
        } catch (err) {
          return fail(`Couldn't reach Apploye: ${(err as Error).message}`, 502);
        }
        const byEmail = new Map<string, string>(
          members.filter((m) => m.email).map((m) => [m.email as string, m.id]),
        );

        const vas = await listAllVas();
        const targetId = str(body.vaId);
        const scope = targetId ? vas.filter((v) => v.id === targetId) : vas;

        const linked: { name: string; memberId: string }[] = [];
        const unmatched: string[] = [];
        for (const va of scope) {
          if (va.apployeMemberId) continue;
          const memberId = byEmail.get(va.email.trim().toLowerCase());
          if (!memberId) {
            unmatched.push(va.email);
            continue;
          }
          await supabase
            .from("va_onboarding")
            .update({ apploye_member_id: memberId })
            .eq("id", va.id);
          linked.push({ name: va.name, memberId });
        }

        return NextResponse.json({
          ok: true,
          linked,
          unmatched,
          // Apploye has no invite endpoint on the public API — an unmatched VA
          // has to be invited from the dashboard first, then linked.
          inviteUrl: "https://app.apploye.com/members/invite",
        });
      }

      case "save_targets": {
        const targets = Array.isArray(body.targets) ? (body.targets as Record<string, unknown>[]) : [];
        if (!targets.length) return fail("No targets supplied.");
        for (const t of targets) {
          const id = str(t.id);
          const update = {
            target_value: Number(t.targetValue),
            active: t.active !== false,
            label: str(t.label) || undefined,
          };
          if (!Number.isFinite(update.target_value)) continue;
          if (id) {
            await supabase.from("va_kpi_targets").update(update).eq("id", id);
          } else {
            await supabase.from("va_kpi_targets").insert({
              function: str(t.function) || "all",
              metric_key: str(t.metricKey),
              label: str(t.label) || str(t.metricKey),
              target_value: update.target_value,
              comparator: str(t.comparator) === "lte" ? "lte" : "gte",
              unit: str(t.unit) || null,
              period: ["daily", "weekly", "monthly"].includes(str(t.period)) ? str(t.period) : "daily",
              va_id: str(t.vaId) || null,
              active: update.active,
            });
          }
        }
        return NextResponse.json({ ok: true, targets: await listTargets() });
      }

      case "save_settings": {
        const writes: { key: string; value: Record<string, unknown> }[] = [];
        if (body.eodSettings && typeof body.eodSettings === "object") {
          const s = body.eodSettings as Record<string, unknown>;
          writes.push({
            key: "va_eod_settings",
            value: {
              timezone: str(s.timezone) || "America/New_York",
              backdate_days: Math.min(14, Math.max(0, Number(s.backdateDays) || 0)),
              cutoff_local_time: /^\d{2}:\d{2}$/.test(str(s.cutoffLocalTime)) ? str(s.cutoffLocalTime) : "17:30",
              lock_after_hours: Math.max(1, Number(s.lockAfterHours) || 36),
            },
          });
        }
        if (body.thresholds && typeof body.thresholds === "object") {
          const t = body.thresholds as Record<string, Record<string, unknown>>;
          const band = (b: Record<string, unknown> | undefined, dp: number, da: number) => ({
            pct: Math.max(0, Number(b?.pct) || dp),
            abs: Math.max(0, Number(b?.abs) || da),
          });
          writes.push({
            key: "va_discrepancy_thresholds",
            value: {
              base: band(t.base, 20, 10),
              medium: band(t.medium, 40, 25),
              high: band(t.high, 75, 50),
              repeat: {
                window_days: Math.max(1, Number(t.repeat?.windowDays) || 14),
                count: Math.max(2, Number(t.repeat?.count) || 3),
              },
            },
          });
        }
        if (!writes.length) return fail("Nothing to save.");
        for (const w of writes) {
          await supabase
            .from("app_settings")
            .upsert(
              { key: w.key, value: w.value, updated_at: new Date().toISOString(), updated_by: principal.userId },
              { onConflict: "key" },
            );
        }
        return NextResponse.json({
          ok: true,
          settings: await getEodSettings(),
          thresholds: await getDiscrepancyThresholds(),
        });
      }

      // ── Airtable mirror ────────────────────────────────────────────────
      case "airtable_sync": {
        const settings = await getEodSettings();
        const today = localDate(new Date(), settings.timezone);
        const days = Math.min(120, Math.max(1, Number(body.days) || 30));
        const result = await syncTeamPerformanceBase({
          startDate: addDays(today, -(days - 1)),
          endDate: today,
        });
        return NextResponse.json({ ok: true, ...result });
      }

      default:
        return fail(`Unsupported action: ${action}`);
    }
  } catch (err) {
    console.error("[va-performance-admin] failed:", (err as Error).message);
    return fail((err as Error).message, 500);
  }
}
