// Proximity auto-dispatch job offers — SMS copy, expiry, dedicated from-number.

/** Response window for auto-assigned proximity offers. */
export const JOB_OFFER_EXPIRY_MINUTES = 10;

/** Exclusive outbound number for cleaner job offers (E.164). */
export const JOB_OFFER_SMS_FROM_E164 = "+14432744402";

export interface JobOfferSmsContext {
  jobDateFormatted: string;
  /** Human arrival window, e.g. "8:00 AM – 12:00 PM". Optional. */
  arrivalWindow?: string;
  city: string;
  zip: string;
  durationHours: number;
  distanceMiles: number;
  role: string;
  /** Cleaners auto-selected for this job (1–3). */
  teamSize: number;
  /** This cleaner's estimated pay in cents. */
  perCleanerPayCents: number;
  /** Team revenue-share % used for the pool (highest tier on team). */
  sharePct: number;
  /** Total team pool before split (cents). Never include customer job cost in SMS. */
  teamPoolCents: number;
  offerUrl: string;
  expiresAt: Date;
}

export function formatOfferExpiresAt(d: Date): string {
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function buildJobOfferSmsMessage(ctx: JobOfferSmsContext): string {
  const yourPay = (ctx.perCleanerPayCents / 100).toFixed(2);
  const teamPool = ctx.teamPoolCents > 0 ? (ctx.teamPoolCents / 100).toFixed(2) : null;
  const expiresLabel = formatOfferExpiresAt(ctx.expiresAt);

  const teamLine =
    ctx.teamSize > 1
      ? `Team: ${ctx.teamSize} cleaners (you're ${ctx.role})`
      : `Solo job (${ctx.role})`;

  // Never show customer job cost / revenue — only the cleaner's own pay.
  let payBlock = `Your pay: $${yourPay}`;
  if (ctx.teamSize > 1 && teamPool) {
    payBlock +=
      `\nSplit among ${ctx.teamSize} · ${ctx.sharePct}% pool ≈ $${teamPool}`;
  } else {
    payBlock += ` · ${ctx.sharePct}% revenue share`;
  }

  const whenLine = ctx.arrivalWindow
    ? `Date: ${ctx.jobDateFormatted}\nArrival: ${ctx.arrivalWindow}\n`
    : `Date: ${ctx.jobDateFormatted}\n`;

  return (
    `Novara — Job offer\n\n` +
    `${teamLine}\n` +
    `${payBlock}\n\n` +
    whenLine +
    `Location: ${ctx.city}${ctx.zip ? `, ${ctx.zip}` : ""}\n` +
    `~${ctx.durationHours} hrs · ${ctx.distanceMiles.toFixed(1)} mi away\n\n` +
    `Accept or decline within ${JOB_OFFER_EXPIRY_MINUTES} min (by ${expiresLabel}):\n` +
    `${ctx.offerUrl}\n\n` +
    `Open LeadConnector for full job details.`
  );
}

export function offerExpiresAtFromNow(): string {
  return new Date(Date.now() + JOB_OFFER_EXPIRY_MINUTES * 60 * 1000).toISOString();
}

export async function sendJobOfferSms(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: {
    phone: string;
    email?: string;
    firstName?: string;
    lastName?: string;
    message: string;
    jobId?: string;
    assignmentId?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { error } = await supabase.functions.invoke("send-ghl-sms", {
      body: {
        phone: args.phone,
        email: args.email,
        firstName: args.firstName,
        lastName: args.lastName,
        message: args.message,
        type: "job_offer",
        fromNumber: JOB_OFFER_SMS_FROM_E164,
      },
    });
    if (error) return { ok: false, error: error.message || String(error) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
