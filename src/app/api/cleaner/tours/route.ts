// ─── /api/cleaner/tours ───────────────────────────────────────────────────────
//
// Walkthrough progress for the signed-in contractor.
//
//   GET  → which walkthroughs they've seen, plus the admin-configured
//          behaviour (does the first-login sequence run, does a version bump
//          re-offer).
//   POST → record where they got to.
//
// Why a route instead of querying from the browser: the settings live in
// `app_settings`, which is admin-and-VA-only by RLS, and widening that policy
// so contractors could read one key would widen it for every other key in the
// table. The route reads it with the service client and returns only this
// feature's settings.
//
// Progress itself is RLS-protected per contractor, so the route resolves the
// caller's own cleaner row from their verified session and never accepts a
// cleaner id from the request body.

import { NextResponse } from "next/server";

import { requireUser, AdminAuthError } from "@/lib/admin-auth";
import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";
import { getTour, tourCatalogSignature } from "@/lib/tours/catalog";
import {
  normalizeTourSettings,
  type TourProgressRecord,
  type TourStatus,
} from "@/lib/tours/progress";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SETTINGS_KEY = "contractor_tours";
const VALID_STATUSES: TourStatus[] = ["in_progress", "skipped", "completed"];

interface ProgressRow {
  tour_id: string;
  version: number;
  status: string;
  last_step_index: number;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

function toRecord(row: ProgressRow): TourProgressRecord {
  return {
    tourId: String(row.tour_id),
    version: Number(row.version) || 1,
    status: (VALID_STATUSES.includes(row.status as TourStatus)
      ? row.status
      : "in_progress") as TourStatus,
    lastStepIndex: Number(row.last_step_index) || 0,
    startedAt: row.started_at || null,
    completedAt: row.completed_at || null,
    updatedAt: row.updated_at || null,
  };
}

/**
 * The caller's own cleaner row.
 *
 * Most cleaner rows predate the auth link, so `user_id` is often null and the
 * email is the only thing tying a session to a contractor. Matching on email
 * as a fallback mirrors `resolveCleanerAuth()` on the client; without it, a
 * contractor who signed in before their row was linked would silently get no
 * walkthroughs at all.
 */
async function resolveCleanerId(
  admin: ReturnType<typeof getAdminSupabase>,
  userId: string,
  email: string,
): Promise<string> {
  const byUser = await admin
    .from("cleaners")
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  if (byUser.data?.id) return String(byUser.data.id);

  const trimmed = (email || "").trim();
  if (!trimmed) return "";

  const byEmail = await admin
    .from("cleaners")
    .select("id")
    .ilike("email", trimmed)
    .maybeSingle();
  return byEmail.data?.id ? String(byEmail.data.id) : "";
}

async function loadSettings(admin: ReturnType<typeof getAdminSupabase>) {
  const { data } = await admin
    .from("app_settings")
    .select("value")
    .eq("key", SETTINGS_KEY)
    .maybeSingle();
  // normalizeTourSettings falls back to the defaults field by field, so a
  // missing or half-written settings row degrades to "behave normally"
  // rather than to "no walkthroughs for anyone".
  return normalizeTourSettings(data?.value);
}

export async function GET(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  try {
    const admin = getAdminSupabase();
    const cleanerId = await resolveCleanerId(admin, user.userId, user.email);
    const settings = await loadSettings(admin);

    // No cleaner row yet (mid-onboarding). Hand back the settings anyway so
    // the client can still run walkthroughs off localStorage — a contractor
    // who hasn't finished onboarding is exactly who most needs them.
    if (!cleanerId) {
      return NextResponse.json({
        ok: true,
        cleanerId: null,
        settings,
        progress: [],
        catalogSignature: tourCatalogSignature(),
      });
    }

    const { data, error } = await admin
      .from("cleaner_tour_progress")
      .select("tour_id, version, status, last_step_index, started_at, completed_at, updated_at")
      .eq("cleaner_id", cleanerId);

    if (error) throw error;

    return NextResponse.json({
      ok: true,
      cleanerId,
      settings,
      progress: ((data || []) as ProgressRow[]).map(toRecord),
      catalogSignature: tourCatalogSignature(),
    });
  } catch (err) {
    console.error("[cleaner/tours] GET failed", err);
    return NextResponse.json({ error: "Could not load walkthrough progress." }, { status: 500 });
  }
}

export async function POST(req: Request): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser(req);
  } catch (err) {
    const e = err as AdminAuthError;
    return NextResponse.json({ error: e.message }, { status: e.status || 401 });
  }

  let body: {
    tourId?: string;
    status?: string;
    lastStepIndex?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const tour = getTour(String(body.tourId || ""));
  if (!tour) {
    return NextResponse.json({ error: "Unknown walkthrough." }, { status: 400 });
  }

  const status = String(body.status || "");
  if (!VALID_STATUSES.includes(status as TourStatus)) {
    return NextResponse.json({ error: "Unknown status." }, { status: 400 });
  }

  const rawStep = Number(body.lastStepIndex);
  const lastStepIndex = Number.isFinite(rawStep)
    ? Math.min(Math.max(Math.floor(rawStep), 0), tour.steps.length - 1)
    : 0;

  try {
    const admin = getAdminSupabase();
    const cleanerId = await resolveCleanerId(admin, user.userId, user.email);

    // Nothing to write against. Not an error: the client keeps its local copy
    // and will sync it the next time it posts with a resolvable cleaner row.
    if (!cleanerId) {
      return NextResponse.json({ ok: true, stored: false, reason: "no_cleaner_row" });
    }

    const now = new Date().toISOString();
    // The version is taken from the catalog, not the request. The client can
    // only tell us where it got to; what that progress refers to is decided
    // here, so a stale tab can't record "finished v3" of a walkthrough it ran
    // as v2.
    const { error } = await admin
      .from("cleaner_tour_progress")
      .upsert(
        {
          cleaner_id: cleanerId,
          tour_id: tour.id,
          version: tour.version,
          status,
          last_step_index: lastStepIndex,
          completed_at: status === "completed" ? now : null,
          updated_at: now,
        },
        { onConflict: "cleaner_id,tour_id" },
      );

    if (error) throw error;

    return NextResponse.json({ ok: true, stored: true });
  } catch (err) {
    console.error("[cleaner/tours] POST failed", err);
    return NextResponse.json({ error: "Could not save walkthrough progress." }, { status: 500 });
  }
}
