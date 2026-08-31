import { canonicalizePartnerOrigin } from "@/lib/partner-portal/origins";
import type {
  PartnershipChannel,
  PartnershipCommsSettings,
  PartnershipPolicyDecision,
  PartnershipPriority,
} from "./types";
import { DEFAULT_PARTNERSHIP_COMMS_SETTINGS } from "./types";

export function partnershipRecipientKey(
  email?: string | null,
  phone?: string | null,
): string | null {
  const em = String(email || "").trim().toLowerCase();
  if (em) return em;
  const digits = String(phone || "").replace(/\D/g, "");
  return digits ? `tel:${digits}` : null;
}

export function phoneDigits(phone?: string | null): string {
  return String(phone || "").replace(/\D/g, "");
}

function parseHm(value: string): { h: number; m: number } {
  const [h, m] = String(value || "00:00").split(":").map((n) => Number(n) || 0);
  return { h, m };
}

function localParts(now: Date, timeZone: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
  return {
    y: Number(parts.year),
    mo: Number(parts.month),
    d: Number(parts.day),
    h: Number(parts.hour),
    mi: Number(parts.minute),
    s: Number(parts.second),
  };
}

/** Wall-clock minutes since midnight in the recipient timezone. */
export function localMinutes(now: Date, timeZone: string): number {
  const p = localParts(now, timeZone);
  return p.h * 60 + p.mi;
}

export function inQuietHours(
  now: Date,
  settings: Pick<PartnershipCommsSettings, "timezone" | "quiet_hours_start" | "quiet_hours_end">,
): boolean {
  const start = parseHm(settings.quiet_hours_start);
  const end = parseHm(settings.quiet_hours_end);
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;
  const cur = localMinutes(now, settings.timezone);
  if (startMin <= endMin) return cur >= startMin && cur < endMin;
  return cur >= startMin || cur < endMin;
}

/**
 * First instant after quiet hours in the recipient timezone.
 * Overnight windows (21:00–08:00) queue until 08:00 local.
 */
export function quietHoursEndsAt(
  now: Date,
  settings: Pick<PartnershipCommsSettings, "timezone" | "quiet_hours_start" | "quiet_hours_end">,
): Date {
  const start = parseHm(settings.quiet_hours_start);
  const end = parseHm(settings.quiet_hours_end);
  const startMin = start.h * 60 + start.m;
  const endMin = end.h * 60 + end.m;
  const p = localParts(now, settings.timezone);
  const cur = p.h * 60 + p.mi;
  let y = p.y, mo = p.mo, d = p.d;
  const overnight = startMin > endMin;
  if (overnight && cur >= startMin) {
    const dt = new Date(Date.UTC(y, mo - 1, d + 1));
    y = dt.getUTCFullYear();
    mo = dt.getUTCMonth() + 1;
    d = dt.getUTCDate();
  }
  const asUtcGuess = new Date(Date.UTC(y, mo - 1, d, end.h, end.m, 0));
  // Convert "this wall clock in TZ" to an absolute instant.
  const offset = asUtcGuess.getTime() - wallClockAsUtc(asUtcGuess, settings.timezone).getTime();
  return new Date(asUtcGuess.getTime() + offset);
}

function wallClockAsUtc(date: Date, timeZone: string): Date {
  const p = localParts(date, timeZone);
  return new Date(Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s));
}

export interface OfflinePolicyInput {
  email?: string | null;
  phone?: string | null;
  channel: PartnershipChannel;
  priority: PartnershipPriority;
  now?: Date;
  settings?: PartnershipCommsSettings;
  emailOptedOut?: boolean;
  smsOptedOut?: boolean;
  recentSendCount?: number;
}

/**
 * Mirrors `partnership_comms_check` so offline tests can assert quiet hours,
 * caps, opt-outs, and the urgent exemption without a live database.
 */
export function checkPartnershipPolicy(input: OfflinePolicyInput): PartnershipPolicyDecision {
  const settings = input.settings || DEFAULT_PARTNERSHIP_COMMS_SETTINGS;
  const now = input.now || new Date();
  const key = partnershipRecipientKey(input.email, input.phone);
  if (input.channel === "email" && input.email && input.emailOptedOut) {
    return { action: "suppress", reason: "opted_out", recipient_key: key };
  }
  if (input.channel === "sms" && phoneDigits(input.phone) && input.smsOptedOut) {
    return { action: "suppress", reason: "opted_out", recipient_key: key };
  }
  if (input.priority === "urgent") {
    return { action: "send", reason: "urgent", recipient_key: key };
  }
  if (inQuietHours(now, settings)) {
    return {
      action: "queue",
      reason: "quiet_hours",
      recipient_key: key,
      send_after: quietHoursEndsAt(now, settings).toISOString(),
    };
  }
  const cap = settings.frequency_cap_count;
  if ((input.recentSendCount || 0) >= cap) {
    return {
      action: "queue",
      reason: "frequency_cap",
      recipient_key: key,
      send_after: new Date(now.getTime() + settings.frequency_cap_hours * 3600_000).toISOString(),
    };
  }
  return { action: "send", reason: "ok", recipient_key: key };
}

export function retryBackoffMs(attemptCount: number, priority: PartnershipPriority): number {
  if (priority === "urgent") {
    return [30_000, 60_000, 120_000, 300_000, 600_000][Math.max(0, attemptCount)] ?? 600_000;
  }
  return [60_000, 300_000, 900_000, 3_600_000][Math.max(0, attemptCount)] ?? 3_600_000;
}

export function mergePartnershipSettings(raw: unknown): PartnershipCommsSettings {
  const v = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const sendersIn = (v.senders && typeof v.senders === "object" ? v.senders : {}) as Record<string, { from?: string; reply_to?: string }>;
  const mergeSender = (
    role: keyof PartnershipCommsSettings["senders"],
  ): { from: string; reply_to: string } => ({
    from: sendersIn[role]?.from || DEFAULT_PARTNERSHIP_COMMS_SETTINGS.senders[role].from,
    reply_to: sendersIn[role]?.reply_to || DEFAULT_PARTNERSHIP_COMMS_SETTINGS.senders[role].reply_to,
  });
  return {
    timezone: String(v.timezone || DEFAULT_PARTNERSHIP_COMMS_SETTINGS.timezone),
    quiet_hours_start: String(v.quiet_hours_start || DEFAULT_PARTNERSHIP_COMMS_SETTINGS.quiet_hours_start),
    quiet_hours_end: String(v.quiet_hours_end || DEFAULT_PARTNERSHIP_COMMS_SETTINGS.quiet_hours_end),
    frequency_cap_count: Number(v.frequency_cap_count) > 0
      ? Number(v.frequency_cap_count)
      : DEFAULT_PARTNERSHIP_COMMS_SETTINGS.frequency_cap_count,
    frequency_cap_hours: Number(v.frequency_cap_hours) > 0
      ? Number(v.frequency_cap_hours)
      : DEFAULT_PARTNERSHIP_COMMS_SETTINGS.frequency_cap_hours,
    standard_max_attempts: Number(v.standard_max_attempts) > 0
      ? Number(v.standard_max_attempts)
      : DEFAULT_PARTNERSHIP_COMMS_SETTINGS.standard_max_attempts,
    urgent_max_attempts: Number(v.urgent_max_attempts) > 0
      ? Number(v.urgent_max_attempts)
      : DEFAULT_PARTNERSHIP_COMMS_SETTINGS.urgent_max_attempts,
    partners_origin: canonicalizePartnerOrigin(
      String(v.partners_origin || DEFAULT_PARTNERSHIP_COMMS_SETTINGS.partners_origin),
    ),
    senders: {
      partner: mergeSender("partner"),
      walkthrough_agent: mergeSender("walkthrough_agent"),
      admin: mergeSender("admin"),
    },
  };
}
