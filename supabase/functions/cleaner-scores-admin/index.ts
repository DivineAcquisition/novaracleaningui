// cleaner-scores-admin
//
// Admin/VA management for the Novara scoring system:
//   { action:"override", cleanerId, field, value, reason }  — pin a score
//     (novara_score | quality_score | overall_score) with a REQUIRED logged
//     reason (who/when/why/old→new). Never silent.
//   { action:"clear_override", cleanerId, field, reason }   — back to computed.
//   { action:"set_weights", weights }                       — composite config.
//   { action:"recompute" }                                  — run the engine now.
//   { action:"history", cleanerId }                         — override audit trail.
//   { action:"risk_flags", bookingId }                      — the ops risk layer:
//     per-cleaner flags (score trends, QC history, stated-constraint
//     mismatches vs this job) + suggestions. FLAGS AND SUGGESTS ONLY —
//     never auto-restricts; the human dispatcher decides.

import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    headers: { ...corsHeaders, "Content-Type": "application/json" }, status,
  });
}

// deno-lint-ignore no-explicit-any
type SB = any;

const FIELDS = ["novara_score", "quality_score", "overall_score"];

async function ensureAdminOrVa(admin: SB, req: Request): Promise<{ id: string; name: string }> {
  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) throw new Error("Not signed in.");
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
  return { id: u.user.id, name: String(u.user.user_metadata?.full_name || u.user.email || "Admin") };
}

/** Parse "HH:MM"/"3pm"-style times to minutes-of-day; null when unparseable. */
function toMinutes(v: string | null | undefined): number | null {
  if (!v) return null;
  const s = String(v).trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  return h * 60 + min;
}

/** Extract the latest time mentioned in a slot/deadline string. */
function latestTimeIn(text: string | null | undefined): number | null {
  if (!text) return null;
  const times = String(text).match(/\d{1,2}(?::\d{2})?\s*(?:am|pm)/gi) || [];
  let latest: number | null = null;
  for (const t of times) {
    const mins = toMinutes(t);
    if (mins != null && (latest == null || mins > latest)) latest = mins;
  }
  if (/after 6\s*pm|overnight|after close/i.test(String(text))) latest = Math.max(latest ?? 0, 18 * 60);
  return latest;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const admin: SB = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  try {
    const actor = await ensureAdminOrVa(admin, req);
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");

    // ─── Override (logged, never silent) ─────────────────────────────────
    if (action === "override" || action === "clear_override") {
      const cleanerId = String(body?.cleanerId || "");
      const field = String(body?.field || "");
      const reason = String(body?.reason || "").trim().slice(0, 1000);
      if (!cleanerId || !FIELDS.includes(field)) return json({ ok: false, error: "cleanerId + valid field required" }, 400);
      if (!reason) return json({ ok: false, error: "A reason is required — overrides are never silent." }, 400);

      const { data: cleaner } = await admin.from("cleaners").select(`id, first_name, last_name, ${field}`).eq("id", cleanerId).maybeSingle();
      if (!cleaner) return json({ ok: false, error: "Cleaner not found" }, 404);
      const oldValue = cleaner[field] != null ? Number(cleaner[field]) : null;

      let newValue: number | null = null;
      if (action === "override") {
        newValue = Number(body?.value);
        if (!Number.isFinite(newValue) || newValue < 0 || newValue > 100) {
          return json({ ok: false, error: "Value must be 0–100." }, 400);
        }
      }

      // Retire any prior active override on this field, then log the new state.
      await admin.from("cleaner_score_overrides").update({ active: false })
        .eq("cleaner_id", cleanerId).eq("field", field).eq("active", true);
      await admin.from("cleaner_score_overrides").insert({
        cleaner_id: cleanerId,
        field,
        old_value: oldValue,
        new_value: newValue,           // null = cleared
        reason,
        active: action === "override", // cleared rows are inactive but logged
        created_by: actor.id,
        created_by_name: actor.name,
      });

      if (action === "override" && newValue != null) {
        await admin.from("cleaners").update({ [field]: newValue }).eq("id", cleanerId);
      }
      // Recompute so cleared overrides return to computed values (and pinned
      // overall stays consistent when a component was pinned).
      await admin.functions.invoke("compute-cleaner-scores", { body: {} }).catch(() => undefined);

      await admin.from("events").insert({
        event_type: "cleaner.score_override",
        cleaner_id: cleanerId,
        source: "cleaner-scores-admin",
        summary: `${actor.name} ${action === "override" ? `set ${field} ${oldValue ?? "—"} → ${newValue}` : `cleared ${field} override (was ${oldValue ?? "—"})`} for ${cleaner.first_name || ""} ${cleaner.last_name || ""}: "${reason}"`,
        data: { field, old_value: oldValue, new_value: newValue, reason },
      }).then(() => undefined, () => undefined);

      return json({ ok: true });
    }

    if (action === "set_weights") {
      const wts = body?.weights || {};
      const keys = ["acceptance", "workload", "volume", "reliability", "quality"];
      const clean: Record<string, number> = {};
      for (const k of keys) {
        const v = Number(wts[k]);
        if (!Number.isFinite(v) || v < 0 || v > 100) return json({ ok: false, error: `Weight '${k}' must be 0–100.` }, 400);
        clean[k] = Math.round(v);
      }
      await admin.from("app_settings").upsert({
        key: "scoring_weights",
        value: clean,
        description: "Novara Score composite weights and Overall split.",
        updated_at: new Date().toISOString(),
        updated_by: actor.id,
      });
      await admin.functions.invoke("compute-cleaner-scores", { body: {} }).catch(() => undefined);
      return json({ ok: true, weights: clean });
    }

    if (action === "recompute") {
      const { data } = await admin.functions.invoke("compute-cleaner-scores", { body: {} });
      return json({ ok: true, result: data });
    }

    if (action === "history") {
      const cleanerId = String(body?.cleanerId || "");
      if (!cleanerId) return json({ ok: false, error: "cleanerId required" }, 400);
      const { data } = await admin
        .from("cleaner_score_overrides")
        .select("*")
        .eq("cleaner_id", cleanerId)
        .order("created_at", { ascending: false })
        .limit(50);
      return json({ ok: true, history: data || [] });
    }

    // ─── Risk layer: flag + suggest; the human decides ────────────────────
    if (action === "risk_flags") {
      const bookingId = String(body?.bookingId || "");
      if (!bookingId) return json({ ok: false, error: "bookingId required" }, 400);
      const { data: booking } = await admin
        .from("bookings")
        .select("id, service_date, time_slot, arrival_window, hard_deadline, booking_type")
        .eq("id", bookingId)
        .maybeSingle();
      if (!booking) return json({ ok: false, error: "Booking not found" }, 404);

      const jobLatest = latestTimeIn(booking.hard_deadline) ?? latestTimeIn(booking.time_slot || booking.arrival_window);
      const jobDay = booking.service_date
        ? new Date(`${booking.service_date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long" })
        : null;

      const { data: cleaners } = await admin
        .from("cleaners")
        .select("id, first_name, last_name, status, approved, novara_score, quality_score, overall_score, constraints, preferred_work_days, acceptance_rate, total_offers_received, total_offers_accepted")
        .eq("status", "active").eq("approved", true)
        .limit(300);

      const since = new Date(Date.now() - 90 * 86400_000).toISOString();
      const { data: recentIssues } = await admin
        .from("qc_issues")
        .select("cleaner_id, severity")
        .not("cleaner_id", "is", null)
        .gte("created_at", since);
      const issueCount = new Map<string, number>();
      for (const i of recentIssues || []) {
        issueCount.set(i.cleaner_id, (issueCount.get(i.cleaner_id) || 0) + 1);
      }

      // Recent acceptance trend: last 10 offers vs lifetime.
      const { data: recentAssigns } = await admin
        .from("job_assignments")
        .select("cleaner_id, status, created_at")
        .gte("created_at", new Date(Date.now() - 30 * 86400_000).toISOString())
        .limit(3000);
      const recentByCleaner = new Map<string, { offered: number; declined: number }>();
      for (const a of recentAssigns || []) {
        const s = String(a.status || "").toLowerCase();
        const e = recentByCleaner.get(a.cleaner_id) || { offered: 0, declined: 0 };
        e.offered++;
        if (s === "declined" || s === "expired") e.declined++;
        recentByCleaner.set(a.cleaner_id, e);
      }

      const results = (cleaners || []).map((c: Record<string, unknown>) => {
        const flags: string[] = [];
        const cons = (c.constraints || {}) as Record<string, unknown>;
        // Constraint mismatch — stated limits vs this job's window.
        const noAfter = toMinutes(cons.no_work_after as string);
        if (noAfter != null && jobLatest != null && jobLatest > noAfter) {
          flags.push(`Stated constraint: can't work after ${cons.no_work_after} — this job runs to ${booking.hard_deadline || booking.time_slot || "later"}`);
        }
        const days = Array.isArray(c.preferred_work_days) ? (c.preferred_work_days as string[]) : [];
        if (jobDay && days.length > 0 && !days.some((d) => d.toLowerCase().startsWith(jobDay.toLowerCase().slice(0, 3)))) {
          flags.push(`${jobDay} is outside their preferred work days (${days.join(", ")})`);
        }
        // QC history.
        const cases = issueCount.get(c.id as string) || 0;
        if (cases >= 2) flags.push(`${cases} QC cases in the last 90 days — quality risk`);
        // Declining acceptance trend.
        const rec = recentByCleaner.get(c.id as string);
        if (rec && rec.offered >= 4 && rec.declined / rec.offered >= 0.4) {
          flags.push(`Declined ${rec.declined}/${rec.offered} recent offers — reliability risk`);
        }
        // Low overall.
        if (c.overall_score != null && Number(c.overall_score) < 40) {
          flags.push(`Overall score ${Number(c.overall_score).toFixed(0)} — below the fleet floor`);
        }
        return {
          cleanerId: c.id,
          name: `${c.first_name || ""} ${c.last_name || ""}`.trim(),
          novara: c.novara_score != null ? Number(c.novara_score) : null,
          quality: c.quality_score != null ? Number(c.quality_score) : null,
          overall: c.overall_score != null ? Number(c.overall_score) : null,
          flags,
          constraintsNotes: (cons.notes as string) || null,
        };
      });

      // Suggestions: highest overall among unflagged (then flagged as backup).
      const suggested = [...results]
        .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0))
        .sort((a, b) => (a.flags.length > 0 ? 1 : 0) - (b.flags.length > 0 ? 1 : 0))
        .slice(0, 8)
        .map((r) => r.cleanerId);

      return json({ ok: true, cleaners: results, suggested, note: "Flags are advisory — the dispatcher decides. No cleaner is auto-restricted." });
    }

    return json({ ok: false, error: `Unknown action '${action}'` }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = msg.includes("Not signed in") ? 401 : msg.includes("only") ? 403 : 500;
    return json({ ok: false, error: msg }, status);
  }
});
