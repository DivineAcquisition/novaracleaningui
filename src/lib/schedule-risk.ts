// ─── Schedule guard: shared types + settings shape ───────────────────────────
//
// The rules themselves are in Postgres (see the 20260728200000 /
// 20260728200100 / 20260729120000 migrations). This file is only the shape the
// workspace reads and writes, plus the defaults, so a partially-populated
// settings row can never leave a threshold undefined.

export const SCHEDULE_GUARD_SETTINGS_KEY = "schedule_guard_settings";

export interface ScheduleGuardSettings {
  timezone: string;
  /** Minutes of breathing room required between a crew's consecutive jobs. */
  buffer_minutes: number;
  /** Master switch on the write guards. Off means projections still compute. */
  enforce_buffer_at_write: boolean;
  travel_time_enabled: boolean;
  travel_speed_mph: number;
  /**
   * Contact before conclusion. Minutes past the arrival window with no
   * en-route/start before we NUDGE the cleaner — the first rung, and the one
   * that saves most jobs, because most misses are a dead phone.
   */
  cleaner_nudge_minutes: number;
  /** Still nothing → the VA is alerted and the job is marked at risk. */
  late_start_minutes: number;
  /** Still unreachable → no-show: QC case, customer contact, coverage. */
  no_show_minutes: number;
  overrun_grace_minutes: number;
  /** Overrun assumed the moment a crew flags the job as bigger than scoped. */
  field_flag_overrun_minutes: number;
  risk_ack_escalate_minutes: number;
  customer_message_escalate_minutes: number;
  auto_send_initial_heads_up: boolean;
  /** Source coverage automatically the moment a no-show is declared. */
  coverage_auto_source: boolean;
  /** How long a coverage offer is held before it rolls to the next candidate. */
  coverage_offer_window_minutes: number;
  /** Offer the top N at once; first accept wins and the rest auto-withdraw. */
  coverage_simultaneous_offers: number;
  coverage_max_rounds: number;
  /** Past this with nobody accepting, the job is marked uncovered. */
  coverage_give_up_minutes: number;
  /** Inside this window a job counts as urgent and may be direct-assigned. */
  coverage_urgent_within_minutes: number;
  /** Fallback guest check-in time used as an STR turnover's hard deadline. */
  str_checkin_time: string;
  /** Margin-funded service recovery on an uncovered job. Never cleaner pay. */
  goodwill_credit_cents: number;
  /** Notice below which a cleaner-initiated cancellation is short notice. */
  short_notice_cancel_hours: number;
  condition_multipliers: Record<string, number>;
  variance_min_samples: number;
}

export const SCHEDULE_GUARD_DEFAULTS: ScheduleGuardSettings = {
  timezone: "America/New_York",
  buffer_minutes: 60,
  enforce_buffer_at_write: true,
  travel_time_enabled: true,
  travel_speed_mph: 30,
  cleaner_nudge_minutes: 10,
  late_start_minutes: 15,
  no_show_minutes: 30,
  overrun_grace_minutes: 10,
  field_flag_overrun_minutes: 45,
  risk_ack_escalate_minutes: 20,
  customer_message_escalate_minutes: 20,
  auto_send_initial_heads_up: false,
  coverage_auto_source: true,
  coverage_offer_window_minutes: 10,
  coverage_simultaneous_offers: 1,
  coverage_max_rounds: 4,
  coverage_give_up_minutes: 45,
  coverage_urgent_within_minutes: 60,
  str_checkin_time: "16:00",
  goodwill_credit_cents: 2500,
  short_notice_cancel_hours: 24,
  condition_multipliers: { light: 0.9, normal: 1.0, heavy: 1.25, severe: 1.5 },
  variance_min_samples: 5,
};

export type DelayEventType =
  | "late_start"
  | "overrun"
  | "field_flag"
  | "no_show"
  | "cleaner_cancellation";

export const DELAY_EVENT_LABELS: Record<DelayEventType, string> = {
  late_start: "Late start",
  overrun: "Running over",
  field_flag: "Bigger than scoped",
  no_show: "No-show",
  cleaner_cancellation: "Cancelled by cleaner",
};

export interface RiskBoardRow {
  risk_flag_id: string;
  status: "open" | "acknowledged" | "resolved" | "dismissed" | "reassigned";
  reason: string;
  delay_minutes: number;
  position_in_chain: number;
  scheduled_start_at: string | null;
  projected_arrival_at: string | null;
  acknowledged_at: string | null;
  acknowledged_by_name: string | null;
  escalated_at: string | null;
  created_at: string;
  resolved_at: string | null;
  resolution: string | null;
  booking_id: string;
  booking_ref: string;
  service_date: string | null;
  time_slot: string | null;
  service_type: string | null;
  home_size_id: string | null;
  booking_status: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  city: string | null;
  zip_code: string | null;
  job_id: string | null;
  delay_event_id: string;
  delay_event_type: DelayEventType;
  minutes_late: number | null;
  minutes_over: number | null;
  delay_detected_at: string;
  qc_issue_id: string | null;
  upstream_booking_id: string | null;
  upstream_booking_ref: string | null;
  upstream_projected_end_at: string | null;
  cleaner_id: string | null;
  cleaner_name: string | null;
  cleaner_phone: string | null;
  message_id: string | null;
  message_status: "pending" | "sent" | "dismissed" | "failed" | null;
  message_channel: "sms" | "email" | "both" | null;
  draft_body: string | null;
  sent_body: string | null;
  new_eta_at: string | null;
  sent_at: string | null;
  sent_by_name: string | null;
  message_escalated_at: string | null;
  message_prepared_at: string | null;
}

export interface CoverageCandidate {
  cleaner_id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  is_designated_backup: boolean;
  backup_priority: number | null;
  novara_score: number | null;
  overall_score: number | null;
  distance_miles: number | null;
  zone_fit: string | null;
  jobs_that_day: number;
  slack_minutes: number;
  buffer_ok: boolean;
  buffer_note: string | null;
  /** Any narrowing they stated for that day ("nothing after 3pm"). */
  availability_note: string | null;
  /** Why they sit where they sit, so the dispatcher chooses with context. */
  rank_reason: string | null;
  rank_score: number | null;
}

export type CoverageTrigger = "no_show" | "cleaner_cancellation" | "cascade_risk" | "admin";

export const COVERAGE_TRIGGER_LABELS: Record<CoverageTrigger, string> = {
  no_show: "No-show",
  cleaner_cancellation: "Cleaner cancelled",
  cascade_risk: "Cascade risk",
  admin: "Opened by admin",
};

export type CoverageOfferStatus =
  | "offered"
  | "accepted"
  | "declined"
  | "expired"
  | "withdrawn"
  | "failed";

export interface CoverageOffer {
  id: string;
  cleaner_id: string;
  cleaner_name: string | null;
  cleaner_phone: string | null;
  rank_position: number;
  rank_reason: string | null;
  round: number;
  was_designated_backup: boolean;
  status: CoverageOfferStatus;
  offered_at: string;
  expires_at: string;
  responded_at: string | null;
  decline_reason: string | null;
  notified_via: string[] | null;
  /** Always false. Declining backup cover is never a reliability penalty. */
  counts_against_reliability: boolean;
}

export interface CoverageRow {
  coverage_request_id: string;
  status: "sourcing" | "offered" | "covered" | "uncovered" | "cancelled";
  trigger: CoverageTrigger;
  trigger_detail: string | null;
  mode: "sequential" | "simultaneous" | "direct";
  round: number;
  max_rounds: number;
  offer_window_minutes: number;
  offers_per_round: number;
  is_urgent: boolean;
  urgency_reason: string | null;
  is_str_turnover: boolean;
  hard_deadline_at: string | null;
  scheduled_start_at: string | null;
  candidate_count: number;
  candidates_snapshot: CoverageCandidate[] | null;
  give_up_at: string | null;
  from_cleaner_id: string | null;
  from_cleaner_name: string | null;
  covered_by_cleaner_id: string | null;
  covered_by_name: string | null;
  covered_at: string | null;
  covered_via: "offer_accepted" | "direct_assign" | "manual" | null;
  was_designated_backup: boolean;
  uncovered_at: string | null;
  uncovered_reason: string | null;
  goodwill_credit_cents: number;
  goodwill_applied_at: string | null;
  reschedule_offered_at: string | null;
  opened_by_name: string | null;
  notes: string | null;
  created_at: string;
  delay_event_id: string | null;
  risk_flag_id: string | null;
  booking_id: string;
  booking_ref: string;
  service_date: string | null;
  time_slot: string | null;
  service_type: string | null;
  booking_status: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  zip_code: string | null;
  job_id: string | null;
  delay_event_type: DelayEventType | null;
  minutes_late: number | null;
  notice_minutes: number | null;
  cleaner_eta_at: string | null;
  nudge_sent_at: string | null;
  va_alerted_at: string | null;
  qc_issue_id: string | null;
  offers: CoverageOffer[];
  live_offers: number | null;
  next_expiry_at: string | null;
}

export interface CoverageHealthRow {
  service_date: string;
  jobs: number;
  str_turnovers: number;
  backups: number;
  backups_activated: number;
  uncovered_jobs: number;
  coverage_open: number;
  /** Jobs on the books and nobody left on the bench for the day. */
  uncovered_day: boolean;
  /** The same, on a day carrying STR turnovers — the least forgiving case. */
  str_day_exposed: boolean;
}

export interface CoverageGapRow {
  service_date: string;
  weekday: string;
  client_type: string;
  service_type: string;
  uncovered_jobs: number;
  uncovered_str_turnovers: number;
  from_no_show: number;
  from_cancellation: number;
  avg_candidates_available: number | null;
  goodwill_cents: number;
  backups_that_day: number;
  last_uncovered_at: string | null;
}

export interface CleanerReliabilityRow {
  cleaner_id: string;
  cleaner_name: string | null;
  novara_score: number | null;
  overall_score: number | null;
  no_shows_90d: number;
  no_shows_30d: number;
  cancellations_90d: number;
  short_notice_cancellations_90d: number;
  avg_cancellation_notice_minutes: number | null;
  /** Late but reachable — the behaviour we want, counted separately. */
  late_but_reachable_90d: number;
  nudges_unanswered_90d: number;
  last_no_show_at: string | null;
  last_cancellation_at: string | null;
  coverage_offers_declined_90d: number;
  coverage_offers_accepted_90d: number;
  days_on_call_90d: number;
}

export interface DurationVarianceRow {
  service_type: string;
  home_size_id: string;
  samples: number;
  avg_projected_hours: number | null;
  avg_actual_hours: number | null;
  avg_variance_pct: number | null;
  median_variance_pct: number | null;
  runs_over_count: number;
  last_recorded_at: string | null;
  base_hours: number | null;
  learned_multiplier: number | null;
  suggested_multiplier: number | null;
  chronic: boolean;
}

export interface LateStartOffenderRow {
  cleaner_id: string;
  cleaner_name: string | null;
  novara_score: number | null;
  measured_jobs: number;
  late_starts: number;
  late_start_rate_pct: number | null;
  avg_late_minutes: number | null;
  no_shows_90d: number;
  late_events_90d: number;
}

export interface BufferConflictDetail {
  kind: "before" | "after";
  booking_id: string;
  booking_ref: string;
  cleaner_id: string | null;
  cleaner_name: string | null;
  customer_name: string | null;
  other_start_at: string | null;
  other_projected_end_at: string | null;
  this_start_at: string | null;
  this_projected_end_at: string | null;
  travel_minutes: number | null;
  required_minutes: number;
  gap_minutes: number;
  shortfall_minutes: number;
  message: string;
}

export interface BufferConflictPayload {
  requiredBufferMinutes: number;
  startAt: string | null;
  projectedEndAt: string | null;
  conflicts: BufferConflictDetail[];
}

/** Merge a stored settings row over the defaults. */
export function mergeScheduleGuardSettings(value: unknown): ScheduleGuardSettings {
  const raw = (value && typeof value === "object" ? value : {}) as Partial<ScheduleGuardSettings>;
  return {
    ...SCHEDULE_GUARD_DEFAULTS,
    ...raw,
    condition_multipliers: {
      ...SCHEDULE_GUARD_DEFAULTS.condition_multipliers,
      ...(raw.condition_multipliers || {}),
    },
  };
}

const SIZE_BAND_LABELS: Record<string, string> = {
  "0_999": "under 1,000 sqft",
  "1000_1500": "1,000–1,500 sqft",
  "1501_2000": "1,501–2,000 sqft",
  "2001_2500": "2,001–2,500 sqft",
  "2501_3000": "2,501–3,000 sqft",
  "3001_3500": "3,001–3,500 sqft",
  "3501_4000": "3,501–4,000 sqft",
  "4001_4500": "4,001–4,500 sqft",
  "4501_5000": "4,501–5,000 sqft",
  "5000_plus": "5,000+ sqft",
};

const SERVICE_LABELS: Record<string, string> = {
  standard: "Standard clean",
  deep: "Deep clean",
  moveinout: "Move-in / move-out",
  combo: "Deep + standard combo",
};

export function serviceBandLabel(serviceType: string, homeSizeId: string): string {
  const service = SERVICE_LABELS[serviceType] || serviceType;
  const band = SIZE_BAND_LABELS[homeSizeId] || homeSizeId;
  return `${band} ${service.toLowerCase()}s`;
}

/**
 * "3.5 hr notice" / "2 days notice". Reads at a glance because the whole point
 * of recording notice is making early warning visibly better than silence.
 */
export function noticeLabel(minutes: number | null | undefined): string {
  const m = Number(minutes);
  if (!Number.isFinite(m) || m < 0) return "unknown notice";
  if (m >= 2880) return `${Math.round(m / 1440)} days notice`;
  if (m >= 1440) return `${(m / 1440).toFixed(1)} days notice`;
  if (m >= 60) return `${(m / 60).toFixed(1)} hr notice`;
  return `${Math.round(m)} min notice`;
}

/** One line describing where a coverage search stands. */
export function coverageHeadline(row: CoverageRow): string {
  switch (row.status) {
    case "covered":
      return `Covered by ${row.covered_by_name || "another cleaner"}${
        row.covered_via === "direct_assign" ? " (direct-assigned)" : ""
      }${row.was_designated_backup ? " — backup activated" : ""}`;
    case "uncovered":
      return row.uncovered_reason || "Nobody could cover this job.";
    case "cancelled":
      return row.notes || "Coverage no longer needed.";
    case "offered":
      return `${row.live_offers || 0} offer${row.live_offers === 1 ? "" : "s"} out, round ${row.round} of ${row.max_rounds}`;
    default:
      return `${row.candidate_count} candidate${row.candidate_count === 1 ? "" : "s"} ranked`;
  }
}

/** "2,001–2,500 deep cleans run 18% over projection" */
export function varianceHeadline(row: DurationVarianceRow): string {
  const pct = Math.round(Number(row.avg_variance_pct ?? 0));
  const label = serviceBandLabel(row.service_type, row.home_size_id);
  if (pct === 0) return `${label} land on projection`;
  return pct > 0
    ? `${label} run ${pct}% over projection`
    : `${label} finish ${Math.abs(pct)}% under projection`;
}
