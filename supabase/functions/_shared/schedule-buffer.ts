// ─── Schedule buffer helpers (edge side) ─────────────────────────────────────
//
// The buffer rules themselves live in Postgres (20260728190000_schedule_buffer
// _projections.sql): the duration model, the projection, the conflict math, and
// the write guards that enforce it on job_assignments and bookings. That is
// deliberate — there is one set of numbers and one place they are enforced, so
// no booking path can drift out of the rules by forgetting to call something.
//
// These helpers are the polite front door to that guard:
//   * ask BEFORE writing, so the caller can explain the conflict in its own
//     words instead of surfacing a database error;
//   * translate the guard's exception into the same shape when a write does
//     reach it;
//   * record an explicit admin override, with its reason, on the record.

// deno-lint-ignore-file no-explicit-any
type SB = any;

export interface BufferConflict {
  kind: "before" | "after";
  booking_id: string;
  booking_ref: string;
  cleaner_id: string | null;
  cleaner_name: string | null;
  customer_name: string | null;
  other_start_at: string | null;
  other_projected_end_at: string | null;
  other_service_type: string | null;
  other_home_size_id: string | null;
  this_start_at: string | null;
  this_projected_end_at: string | null;
  this_duration_hours: number | null;
  travel_minutes: number | null;
  required_minutes: number;
  gap_minutes: number;
  shortfall_minutes: number;
  message: string;
}

export interface BufferCheck {
  ok: boolean;
  evaluated: boolean;
  reason?: string;
  required_buffer_minutes: number;
  start_at?: string | null;
  projected_end_at?: string | null;
  projected_duration_hours?: number | null;
  conflicts: BufferConflict[];
  message?: string | null;
}

const EMPTY_OK: BufferCheck = {
  ok: true,
  evaluated: false,
  required_buffer_minutes: 0,
  conflicts: [],
};

/**
 * Would putting this crew on this booking (optionally at a new date/time)
 * leave the required buffer around their other jobs that day?
 *
 * Pass serviceType/homeSizeId to evaluate a slot that has no booking row yet
 * (recurring generation) — without them the projection would fall back to a
 * generic duration, which is exactly the flat guess this feature exists to
 * replace.
 *
 * A failure to evaluate returns ok: the DB write guard is the backstop, and an
 * unreachable RPC must never be the reason a job can't be staffed.
 */
export async function checkScheduleBuffer(
  admin: SB,
  opts: {
    bookingId?: string | null;
    cleanerIds?: (string | null | undefined)[];
    serviceDate?: string | null;
    timeSlot?: string | null;
    serviceType?: string | null;
    homeSizeId?: string | null;
    conditionLevel?: string | null;
  },
): Promise<BufferCheck> {
  const cleanerIds = (opts.cleanerIds || []).filter(Boolean) as string[];
  try {
    const prospective = !opts.bookingId || opts.serviceType != null || opts.homeSizeId != null;
    const { data, error } = prospective
      ? await admin.rpc("evaluate_schedule_buffer", {
        p_booking_id: opts.bookingId ?? null,
        p_cleaner_ids: cleanerIds,
        p_service_date: opts.serviceDate ?? null,
        p_time_slot: opts.timeSlot ?? null,
        p_service_type: opts.serviceType ?? null,
        p_home_size_id: opts.homeSizeId ?? null,
        p_condition_level: opts.conditionLevel ?? null,
      })
      : await admin.rpc("check_booking_buffer", {
        p_booking_id: opts.bookingId,
        p_cleaner_ids: cleanerIds.length ? cleanerIds : null,
        p_service_date: opts.serviceDate ?? null,
        p_time_slot: opts.timeSlot ?? null,
      });
    if (error) {
      console.error("[schedule-buffer] check failed", error.message);
      return EMPTY_OK;
    }
    return { ...EMPTY_OK, ...(data as BufferCheck) };
  } catch (e) {
    console.error("[schedule-buffer] check threw", e instanceof Error ? e.message : String(e));
    return EMPTY_OK;
  }
}

/** The write guard raises with HINT='buffer_conflict'. */
export function isBufferConflict(error: unknown): boolean {
  const e = error as { hint?: string; message?: string; details?: string } | null;
  if (!e) return false;
  if (e.hint === "buffer_conflict") return true;
  return String(e.details || "").includes('"required_buffer_minutes"')
    && String(e.message || "").includes("buffer");
}

/** Pull the structured conflict back out of a guard exception. */
export function bufferConflictFromError(error: unknown): BufferCheck {
  const e = error as { message?: string; details?: string } | null;
  try {
    const parsed = JSON.parse(String(e?.details || "{}")) as BufferCheck;
    if (parsed && typeof parsed === "object") {
      return { ...EMPTY_OK, ...parsed, ok: false, message: parsed.message || e?.message || null };
    }
  } catch { /* not JSON — fall through to the message alone */ }
  return { ...EMPTY_OK, ok: false, evaluated: true, message: e?.message || "Buffer conflict." };
}

/** The 409 body every caller returns, so the UI handles one shape. */
export function bufferConflictBody(check: BufferCheck, extra: Record<string, unknown> = {}) {
  return {
    error: check.message
      || "This start time does not leave the required buffer after the crew's other job.",
    code: "buffer_conflict",
    bufferConflict: {
      requiredBufferMinutes: check.required_buffer_minutes,
      startAt: check.start_at ?? null,
      projectedEndAt: check.projected_end_at ?? null,
      conflicts: check.conflicts || [],
    },
    ...extra,
  };
}

/**
 * Log the admin's decision to book inside the buffer, THEN let the write
 * through. The override row is what the guard looks for, and it stays on the
 * booking so a cascade can always be traced back to the call that allowed it.
 */
export async function recordBufferOverride(
  admin: SB,
  opts: {
    bookingId: string;
    cleanerIds: string[];
    check: BufferCheck;
    reason: string;
    actorId?: string | null;
    actorName?: string | null;
  },
): Promise<{ ok: boolean; error?: string }> {
  const reason = String(opts.reason || "").trim();
  if (!reason) {
    return { ok: false, error: "An override needs a written reason." };
  }

  const conflicts = opts.check.conflicts || [];
  const rows = (opts.cleanerIds.length ? opts.cleanerIds : [null]).map((cleanerId) => {
    const c = conflicts.find((x) => !cleanerId || x.cleaner_id === cleanerId) || conflicts[0];
    return {
      booking_id: opts.bookingId,
      cleaner_id: cleanerId,
      conflicting_booking_id: c?.booking_id ?? null,
      required_buffer_minutes: c?.required_minutes ?? opts.check.required_buffer_minutes ?? 60,
      actual_gap_minutes: c?.gap_minutes ?? null,
      travel_minutes: c?.travel_minutes ?? null,
      projected_end_at: c?.other_projected_end_at ?? null,
      reason,
      conflict_detail: opts.check as unknown as Record<string, unknown>,
      created_by: opts.actorId ?? null,
      created_by_name: opts.actorName ?? null,
    };
  });

  const { error } = await admin.from("schedule_buffer_overrides").insert(rows);
  if (error) return { ok: false, error: error.message };

  await admin.from("events").insert({
    event_type: "booking.buffer_override",
    booking_id: opts.bookingId,
    cleaner_id: opts.cleanerIds[0] ?? null,
    source: "schedule-buffer",
    summary:
      `⚠️ Buffer override — ${opts.actorName || "an admin"} booked inside the required ` +
      `${opts.check.required_buffer_minutes ?? 60} min buffer.\n` +
      `${conflicts[0]?.message || ""}\nReason: ${reason}`,
    data: {
      reason,
      conflicts,
      cleaner_ids: opts.cleanerIds,
      required_buffer_minutes: opts.check.required_buffer_minutes ?? null,
    },
  }).then(() => undefined, () => undefined);

  return { ok: true };
}

/**
 * Run a write that the guard protects, converting a guard exception into the
 * standard conflict shape rather than a 500.
 */
export async function withBufferConflictHandling<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; check: BufferCheck }> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    if (isBufferConflict(e)) return { ok: false, check: bufferConflictFromError(e) };
    throw e;
  }
}
