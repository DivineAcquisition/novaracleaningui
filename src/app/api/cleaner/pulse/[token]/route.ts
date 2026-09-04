// Public tokenized contractor pulse check — no login.
// GET form + eligible jobs · PATCH autosave · POST submit · POST claim.

import { NextResponse } from "next/server";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import {
  availabilityChanged,
  availabilityPatch,
  claimTakenMessage,
  EMPTY_PULSE_DRAFT,
  normalizePulseDraft,
  outcomeFromAnswers,
  pulseDraftComplete,
  type PulseDraft,
} from "@/lib/pulse-check/answers";
import {
  ensureJobForBooking,
  listEligiblePulseJobs,
  offerThenAccept,
} from "@/lib/pulse-check/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ token: string }> };

const CLEANER_SELECT =
  "id, first_name, last_name, email, status, preferred_work_days, constraints, home_lat, home_lng, home_zip, service_zip_codes, max_travel_miles, max_weekly_bookings, average_rating, total_ratings, workload_score, acceptance_rate, on_time_rate, approved, available_for_bookings";

async function resolveToken(token: string) {
  const supabase = getAdminSupabase();
  if (!token || token.length < 16) {
    return { supabase, entry: null as Record<string, unknown> | null, error: "This link isn't valid.", status: 404 };
  }
  const { data: entry, error } = await (supabase.from as any)("pulse_check_entries")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) {
    return { supabase, entry: null, error: error.message, status: 500 };
  }
  if (!entry) {
    return { supabase, entry: null, error: "This link isn't valid — ask Novara for a fresh one.", status: 404 };
  }
  const expired =
    entry.token_expires_at && new Date(String(entry.token_expires_at)).getTime() < Date.now();
  if (expired && !entry.submitted_at) {
    return {
      supabase,
      entry,
      error: "This check-in link has expired. The office has been notified.",
      status: 410,
    };
  }
  return { supabase, entry: entry as Record<string, unknown>, error: null as string | null, status: 200 };
}

async function loadCleaner(supabase: ReturnType<typeof getAdminSupabase>, cleanerId: string) {
  const { data } = await (supabase.from as any)("cleaners")
    .select(CLEANER_SELECT)
    .eq("id", cleanerId)
    .maybeSingle();
  return data as Record<string, unknown> | null;
}

async function upcomingCount(supabase: ReturnType<typeof getAdminSupabase>, cleanerId: string): Promise<number> {
  try {
    const { count } = await supabase
      .from("job_assignments")
      .select("id", { count: "exact", head: true })
      .eq("cleaner_id", cleanerId)
      .in("status", ["Confirmed", "Accepted", "Assigned", "In Progress", "confirmed", "accepted"]);
    return count || 0;
  } catch {
    return 0;
  }
}

function constraintsOf(cleaner: Record<string, unknown> | null) {
  const c = (cleaner?.constraints && typeof cleaner.constraints === "object"
    ? cleaner.constraints
    : {}) as { no_work_after?: string; no_work_before?: string };
  return {
    noWorkAfter: String(c.no_work_after || ""),
    noWorkBefore: String(c.no_work_before || ""),
    preferredWorkDays: Array.isArray(cleaner?.preferred_work_days)
      ? (cleaner!.preferred_work_days as string[])
      : [],
  };
}

function draftFrom(entry: Record<string, unknown>, cleaner: Record<string, unknown> | null): PulseDraft {
  const onFile = constraintsOf(cleaner);
  return normalizePulseDraft(entry.draft || entry.answers || {}, {
    ...EMPTY_PULSE_DRAFT,
    preferredWorkDays: onFile.preferredWorkDays,
    noWorkAfter: onFile.noWorkAfter,
    noWorkBefore: onFile.noWorkBefore,
  });
}

async function markOpened(supabase: ReturnType<typeof getAdminSupabase>, entry: Record<string, unknown>) {
  if (entry.opened_at) return;
  await (supabase.from as any)("pulse_check_entries")
    .update({ opened_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", entry.id)
    .is("opened_at", null);
}

export async function GET(_req: Request, ctx: Ctx): Promise<NextResponse> {
  const { token: raw } = await ctx.params;
  const token = String(raw || "").trim();
  const { supabase, entry, error, status } = await resolveToken(token);
  if (!entry || error) {
    return NextResponse.json({ error: error || "Not found", reason: status === 410 ? "expired" : "invalid" }, { status });
  }

  const cleaner = await loadCleaner(supabase, String(entry.cleaner_id));
  if (!cleaner) {
    return NextResponse.json({ error: "This link isn't valid.", reason: "invalid" }, { status: 404 });
  }
  if (String(cleaner.status) === "terminated") {
    return NextResponse.json({ error: "This account is no longer active.", reason: "terminated" }, { status: 409 });
  }

  await markOpened(supabase, entry);

  const onFile = constraintsOf(cleaner);
  const draft = draftFrom(entry, cleaner);
  const upcoming = await upcomingCount(supabase, String(cleaner.id));
  let jobs: Awaited<ReturnType<typeof listEligiblePulseJobs>> = [];
  try {
    jobs = await listEligiblePulseJobs(supabase, {
      id: String(cleaner.id),
      home_lat: cleaner.home_lat as number | null,
      home_lng: cleaner.home_lng as number | null,
      home_zip: cleaner.home_zip as string | null,
      service_zip_codes: cleaner.service_zip_codes as string[] | null,
      preferred_work_days: (draft.preferredWorkDays.length
        ? draft.preferredWorkDays
        : onFile.preferredWorkDays) as string[],
      max_travel_miles: cleaner.max_travel_miles as number | null,
      max_weekly_bookings: cleaner.max_weekly_bookings as number | null,
      average_rating: cleaner.average_rating as number | null,
      total_ratings: cleaner.total_ratings as number | null,
      workload_score: cleaner.workload_score as number | null,
      acceptance_rate: cleaner.acceptance_rate as number | null,
      on_time_rate: cleaner.on_time_rate as number | null,
      upcoming_jobs_count: upcoming,
      constraints: {
        no_work_after: draft.noWorkAfter || onFile.noWorkAfter,
        no_work_before: draft.noWorkBefore || onFile.noWorkBefore,
      },
    });
  } catch (e) {
    console.error("[pulse-check] jobs list failed", e instanceof Error ? e.message : e);
  }

  return NextResponse.json({
    ok: true,
    submitted: Boolean(entry.submitted_at),
    outcome: entry.outcome,
    expiresAt: entry.token_expires_at,
    cleaner: {
      firstName: cleaner.first_name || "",
      name: `${cleaner.first_name || ""} ${cleaner.last_name || ""}`.trim(),
    },
    draft,
    onFile,
    claimedJobIds: entry.claimed_job_ids || [],
    jobs,
  });
}

export async function PATCH(req: Request, ctx: Ctx): Promise<NextResponse> {
  const { token: raw } = await ctx.params;
  const { supabase, entry, error, status } = await resolveToken(String(raw || "").trim());
  if (!entry || error) {
    return NextResponse.json({ error: error || "Not found" }, { status });
  }
  if (entry.submitted_at) {
    return NextResponse.json({ ok: true, savedAt: entry.submitted_at, submitted: true });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const cleaner = await loadCleaner(supabase, String(entry.cleaner_id));
  const draft = normalizePulseDraft(body.draft ?? body, draftFrom(entry, cleaner));
  const now = new Date().toISOString();
  const { error: upErr } = await (supabase.from as any)("pulse_check_entries")
    .update({
      draft,
      opened_at: entry.opened_at || now,
      updated_at: now,
    })
    .eq("id", entry.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });
  return NextResponse.json({ ok: true, savedAt: now, submitted: false, draft });
}

export async function POST(req: Request, ctx: Ctx): Promise<NextResponse> {
  const { token: raw } = await ctx.params;
  const token = String(raw || "").trim();
  const { supabase, entry, error, status } = await resolveToken(token);
  if (!entry || error) {
    return NextResponse.json({ error: error || "Not found" }, { status });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const action = String(body.action || "submit").toLowerCase();
  const cleaner = await loadCleaner(supabase, String(entry.cleaner_id));
  if (!cleaner) {
    return NextResponse.json({ error: "This link isn't valid." }, { status: 404 });
  }

  if (action === "claim") {
    const bookingId = String(body.bookingId || "").trim();
    if (!bookingId) {
      return NextResponse.json({ error: "Missing job." }, { status: 400 });
    }

    const ensured = await ensureJobForBooking(supabase, bookingId);
    if ("error" in ensured) {
      return NextResponse.json(
        { ok: false, taken: Boolean(ensured.taken), message: ensured.error },
        { status: ensured.taken ? 200 : 400 },
      );
    }

    const result = await offerThenAccept({
      supabase,
      jobId: ensured.jobId,
      cleanerId: String(cleaner.id),
      booking: ensured.booking,
    });

    if (!result.ok) {
      const taken = Boolean(result.taken);
      return NextResponse.json(
        {
          ok: false,
          taken,
          already: Boolean(result.already),
          message: taken
            ? claimTakenMessage(result.reason || result.message)
            : result.message || claimTakenMessage(result.reason),
        },
        { status: 200 },
      );
    }

    const jobIds = Array.from(new Set([...(entry.claimed_job_ids as string[] || []), result.jobId].filter(Boolean))) as string[];
    const assignmentIds = Array.from(
      new Set([...(entry.claimed_assignment_ids as string[] || []), result.assignmentId].filter(Boolean)),
    ) as string[];
    const bookingIds = Array.from(new Set([...(entry.claimed_booking_ids as string[] || []), bookingId])) as string[];
    const now = new Date().toISOString();
    await (supabase.from as any)("pulse_check_entries")
      .update({
        claimed_job_ids: jobIds,
        claimed_assignment_ids: assignmentIds,
        claimed_booking_ids: bookingIds,
        updated_at: now,
      })
      .eq("id", entry.id);

    await supabase.from("events").insert({
      event_type: "cleaner.pulse_claimed",
      cleaner_id: cleaner.id,
      job_id: result.jobId,
      booking_id: bookingId,
      source: "pulse-check",
      summary: `${cleaner.first_name || "Contractor"} claimed a job from their pulse check`,
      data: {
        entry_id: entry.id,
        cycle_id: entry.cycle_id,
        assignment_id: result.assignmentId,
        already: Boolean(result.already),
      },
    }).then(() => undefined, () => undefined);

    return NextResponse.json({
      ok: true,
      claimed: true,
      already: Boolean(result.already),
      jobId: result.jobId,
      assignmentId: result.assignmentId,
      message: result.already
        ? "This job is already on your schedule."
        : "It's yours — this job is now on your schedule. The full address is in your portal.",
    });
  }

  // submit
  if (entry.submitted_at) {
    return NextResponse.json({
      ok: true,
      submitted: true,
      outcome: entry.outcome,
      alreadySubmitted: true,
    });
  }

  const draft = normalizePulseDraft(body.draft ?? body, draftFrom(entry, cleaner));
  if (!pulseDraftComplete(draft)) {
    return NextResponse.json(
      { error: "Please answer each question before submitting." },
      { status: 400 },
    );
  }

  const onFile = constraintsOf(cleaner);
  const changed = availabilityChanged(draft, onFile);
  if (changed) {
    const patch = availabilityPatch(
      draft,
      cleaner.constraints as Record<string, unknown> | null,
    );
    const { error: cErr } = await (supabase.from as any)("cleaners")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", cleaner.id);
    if (cErr) return NextResponse.json({ error: cErr.message }, { status: 400 });
  }

  const outcome = outcomeFromAnswers(draft);
  const now = new Date().toISOString();
  const answers = {
    status: draft.status,
    ability: draft.ability,
    abilityNote: draft.abilityNote,
    preferredWorkDays: draft.preferredWorkDays,
    noWorkAfter: draft.noWorkAfter,
    noWorkBefore: draft.noWorkBefore,
  };
  const { error: upErr } = await (supabase.from as any)("pulse_check_entries")
    .update({
      draft,
      answers,
      submitted_at: now,
      outcome,
      availability_updated: changed,
      updated_at: now,
    })
    .eq("id", entry.id);
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 400 });

  const claimedCount = Array.isArray(entry.claimed_job_ids) ? entry.claimed_job_ids.length : 0;
  await supabase.from("events").insert({
    event_type: "cleaner.pulse_responded",
    cleaner_id: cleaner.id,
    source: "pulse-check",
    summary:
      `${cleaner.first_name || "Contractor"} pulse check: ${draft.status}` +
      (draft.ability === "blocked" ? " (not able to work)" : "") +
      (claimedCount ? ` · claimed ${claimedCount} job(s)` : "") +
      (outcome === "needs_review" ? " — needs review" : ""),
    data: {
      entry_id: entry.id,
      cycle_id: entry.cycle_id,
      outcome,
      answers,
      claimed_job_count: claimedCount,
      availability_updated: changed,
    },
  }).then(() => undefined, () => undefined);

  return NextResponse.json({
    ok: true,
    submitted: true,
    outcome,
    availabilityUpdated: changed,
    claimedJobCount: claimedCount,
  });
}
