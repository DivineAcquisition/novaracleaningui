export {
  DEFAULT_PARTNERSHIP_COMMS_SETTINGS,
  type PartnershipChannel,
  type PartnershipChannelResult,
  type PartnershipCommsSettings,
  type PartnershipMessageStatus,
  type PartnershipPolicyDecision,
  type PartnershipPriority,
  type PartnershipRole,
  type PartnershipSendInput,
  type PartnershipSendResult,
  type PartnershipTemplate,
} from "./types";
export {
  substitutePartnershipTemplate,
  partnershipVars,
} from "./substitute";
export {
  checkPartnershipPolicy,
  inQuietHours,
  mergePartnershipSettings,
  partnershipRecipientKey,
  phoneDigits,
  quietHoursEndsAt,
  retryBackoffMs,
} from "./policy";

// Node send path (crypto, Resend, GHL) lives in ./server so client
// screens can import this barrel without failing the Vercel bundle.
