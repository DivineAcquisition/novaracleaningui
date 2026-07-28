// ─── Schedule guard: shared types + settings shape ───────────────────────────
//
// The rules themselves are in Postgres (see the 20260728200000 /
// 20260728200100 migrations). This file is only the shape the workspace reads
// and writes, plus the defaults, so a partially-populated settings row can
// never leave a threshold undefined.

export const SCHEDULE_GUARD_SETTINGS_KEY = "schedule_guard_settings";

export interface ScheduleGuardSettings {
  timezone: string;
  /** Minutes of breathing room required between a crew's consecutive jobs. */
  buffer_minutes: number;
  /** Master switch on the write guards. Off means projections still compute. */
  enforce_buffer_at_write: boolean;
  travel_time_enabled: boolean;
  travel_speed_mph: number;
  /** Minutes past the arrival window with no en-route/start → late-start event. */
  late_start_minutes: number;
  /** The firmer threshold → no-show event, QC case, coverage suggestions. */
  no_show_minutes: number;
  overrun_grace_minutes: number;
  /** Overrun assumed the moment a crew flags the job as bigger than scoped. */
  field_flag_overrun_minutes: number;
  risk_ack_escalate_minutes: number;
  customer_message_escalate_minutes: number;
  auto_send_initial_heads_up: boolean;
  condition_multipliers: Record<string, number>;
  variance_min_samples: number;
}

export const SCHEDULE_GUARD_DEFAULTS: ScheduleGuardSettings = {
  timezone: "America/New_York",
  buffer_minutes: 60,
  enforce_buffer_at_write: true,
  travel_time_enabled: true,
  travel_speed_mph: 30,
  late_start_minutes: 15,
  no_show_minutes: 30,
  overrun_grace_minutes: 10,
  field_flag_overrun_minutes: 45,
  risk_ack_escalate_minutes: 20,
  customer_message_escalate_minutes: 20,
  auto_send_initial_heads_up: false,
  condition_multipliers: { light: 0.9, normal: 1.0, heavy: 1.25, severe: 1.5 },
  variance_min_samples: 5,
};

export type DelayEventType = "late_start" | "overrun" | "field_flag" | "no_show";

export const DELAY_EVENT_LABELS: Record<DelayEventType, string> = {
  late_start: "Late start",
  overrun: "Running over",
  field_flag: "Bigger than scoped",
  no_show: "No-show",
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
  rank_score: number | null;
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

/** "2,001–2,500 deep cleans run 18% over projection" */
export function varianceHeadline(row: DurationVarianceRow): string {
  const pct = Math.round(Number(row.avg_variance_pct ?? 0));
  const label = serviceBandLabel(row.service_type, row.home_size_id);
  if (pct === 0) return `${label} land on projection`;
  return pct > 0
    ? `${label} run ${pct}% over projection`
    : `${label} finish ${Math.abs(pct)}% under projection`;
}
