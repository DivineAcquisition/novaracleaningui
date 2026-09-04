/** Decision helper for unanswered pulse-check entries. Keep in sync with pulse-check-runner. */

export type PulseSilenceAction = "none" | "followup" | "complete_claimed" | "terminate";

export function pulseSilenceAction(args: {
  submitted: boolean;
  claimedCount: number;
  sentAt: string | null | undefined;
  followupSent: boolean;
  followupDays: number;
  terminateDays: number;
  tokenExpiresAt: string | null | undefined;
  now: Date;
}): PulseSilenceAction {
  if (args.submitted) return "none";
  const nowMs = args.now.getTime();
  const sentMs = args.sentAt ? new Date(args.sentAt).getTime() : NaN;
  const sentOk = Number.isFinite(sentMs);
  const terminateDue = sentOk && nowMs >= sentMs + args.terminateDays * 86_400_000;
  const expired = args.tokenExpiresAt
    ? (() => {
        const t = new Date(args.tokenExpiresAt).getTime();
        return Number.isFinite(t) && t < nowMs;
      })()
    : false;
  if (terminateDue || expired) {
    return args.claimedCount > 0 ? "complete_claimed" : "terminate";
  }
  if (args.followupSent || !sentOk) return "none";
  if (nowMs >= sentMs + args.followupDays * 86_400_000) return "followup";
  return "none";
}
