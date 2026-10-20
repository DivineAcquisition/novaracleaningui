// Copy for the one membership offer sent after a completed cleaning.
// Pure data so the compliance checks can run without the sender.

export const WELCOME_PERCENT = 15;
export const WELCOME_VALID_DAYS = 30;
export const WELCOME_CODE_PREFIX = "WELCOME-";

export const WELCOME_OFFER_TERMS =
  "15% off the first month of a Glow membership. First-time members only, one per household, expires 30 days after the completed cleaning, applied at checkout.";

/** The phrase the approved savings claim requires beside the percentage. */
export const WELCOME_CLAIM_WORDING = "first month of a Glow membership";

export function welcomeClaimUrl(token: string): string {
  return `https://try.novaracleaning.com/welcome/${encodeURIComponent(token)}`;
}

export function renderWelcomeOfferEmail(input: {
  firstName: string;
  code: string;
  url: string;
  expiresLabel: string;
}): string {
  const name = escapeHtml(input.firstName || "there");
  return `<h1 style="margin:0 0 14px;font-family:Inter,Arial,sans-serif;font-size:28px;line-height:1.2;font-weight:700;color:#ffffff;">15% off your first Glow membership</h1>
<p style="margin:0 0 16px;">Hi ${name}, thank you for having Novara in your home.</p>
<p style="margin:0 0 16px;">This note is a promotional email. You can take <strong>15% off your first month of a Glow membership</strong>. First-time members only, one per household. It expires ${escapeHtml(input.expiresLabel)} and is applied at checkout. Your later months stay at the regular membership price.</p>
<p style="margin:0 0 16px;">Your code is <strong style="color:#ffffff;letter-spacing:0.08em;">${escapeHtml(input.code)}</strong>.</p>
<p style="margin:22px 0 0;"><a class="novara-btn" href="${escapeHtml(input.url)}" style="display:inline-block;padding:14px 28px;background:#e7e7ea;color:#18181b;text-decoration:none;border-radius:12px;font-weight:600;">Claim 15% off your first month</a></p>
<p style="margin:16px 0 0;font-size:14px;">The offer opens after you pick a Glow plan and pay the first month. It cannot be used on a one-time cleaning.</p>`;
}

function escapeHtml(value: string): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
