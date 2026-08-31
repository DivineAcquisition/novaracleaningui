export type PartnershipRole = "partner" | "walkthrough_agent" | "admin";
export type PartnershipPriority = "urgent" | "standard" | "routine";
export type PartnershipChannel = "email" | "sms";
export type PartnershipMessageStatus =
  | "queued"
  | "sending"
  | "sent"
  | "failed"
  | "suppressed"
  | "retry";

export interface PartnershipCommsSettings {
  timezone: string;
  quiet_hours_start: string;
  quiet_hours_end: string;
  frequency_cap_count: number;
  frequency_cap_hours: number;
  standard_max_attempts: number;
  urgent_max_attempts: number;
  partners_origin: string;
  senders: Record<
    PartnershipRole,
    { from: string; reply_to: string }
  >;
}

export const DEFAULT_PARTNERSHIP_COMMS_SETTINGS: PartnershipCommsSettings = {
  timezone: "America/New_York",
  quiet_hours_start: "21:00",
  quiet_hours_end: "08:00",
  frequency_cap_count: 3,
  frequency_cap_hours: 4,
  standard_max_attempts: 3,
  urgent_max_attempts: 5,
  partners_origin: "https://partner.novaracleaning.com",
  senders: {
    partner: {
      from: "Novara Cleaning <hello@novaracleaning.com>",
      reply_to: "support@novaracleaning.com",
    },
    walkthrough_agent: {
      from: "Novara Ops <ops@novaracleaning.com>",
      reply_to: "ops@novaracleaning.com",
    },
    admin: {
      from: "Novara Cleaning <ops@novaracleaning.com>",
      reply_to: "ops@novaracleaning.com",
    },
  },
};

export interface PartnershipTemplate {
  id?: string;
  key: string;
  version: number;
  is_current: boolean;
  role: PartnershipRole;
  priority: PartnershipPriority;
  channels: PartnershipChannel[];
  subject: string | null;
  html: string | null;
  sms_body: string | null;
  description: string | null;
  created_at?: string;
  created_by_name?: string | null;
}

export interface PartnershipSendInput {
  templateKey: string;
  trigger: string;
  email?: string | null;
  phone?: string | null;
  vars?: Record<string, string | number | null | undefined>;
  /** Override the template's channel list. */
  channels?: PartnershipChannel[];
  /** Rendered subject override (logged as sent). */
  subject?: string | null;
  /** Rendered HTML override (logged as sent). */
  html?: string | null;
  /** Rendered SMS override (logged as sent). */
  sms?: string | null;
  attachments?: Array<{ filename: string; content: string }>;
  idempotencyKey?: string;
  hostId?: string | null;
  accountId?: string | null;
  walkthroughId?: string | null;
  priority?: PartnershipPriority;
  role?: PartnershipRole;
}

export interface PartnershipChannelResult {
  channel: PartnershipChannel;
  status: PartnershipMessageStatus;
  reason?: string;
  id?: string;
  error?: string;
}

export interface PartnershipSendResult {
  ok: boolean;
  emailed: boolean;
  texted: boolean;
  results: PartnershipChannelResult[];
}

export interface PartnershipPolicyDecision {
  action: "send" | "queue" | "suppress";
  reason: string;
  recipient_key?: string | null;
  send_after?: string | null;
}
