// Copy and address checks for the cleaner onboarding invite. No I/O, so the
// launch path and the offline check can share one definition.

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A real inbox address. Placeholder rows created during phone-bypass are not. */
export function usableInviteEmail(input: string | null | undefined): string | null {
  const email = String(input || "").trim().toLowerCase();
  if (!email.includes("@") || email.startsWith("@") || email.endsWith("@")) return null;
  if (email.endsWith("@pending.novara")) return null;
  return email;
}

export function buildOnboardingInviteEmail(args: {
  firstName?: string | null;
  onboardingUrl: string;
}): { subject: string; html: string } {
  const first = escapeHtml(String(args.firstName || "").trim() || "there");
  const url = escapeHtml(args.onboardingUrl);
  const subject = "Welcome to Novara Cleaning — start your onboarding";
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 8px;font-size:20px">You're in — let's finish onboarding</h2>
      <p style="margin:0 0 16px;color:#475569">Hi ${first},</p>
      <p style="margin:0 0 16px;color:#475569">
        You've been selected to join the Novara Cleaning contractor team.
        This link opens your onboarding: the agreement, phone verification, supplies,
        dress code, W-9, Stripe payouts, and training videos.
      </p>
      <p style="margin:24px 0;text-align:center">
        <a href="${url}"
           style="display:inline-block;background:#7c3aed;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none;font-weight:600">
          Start onboarding
        </a>
      </p>
      <p style="margin:0 0 8px;color:#64748b;font-size:14px">
        Or paste this link into your browser. It stays valid for 14 days:
      </p>
      <p style="margin:0 0 16px;font-size:13px;word-break:break-all">
        <a href="${url}" style="color:#7c3aed">${url}</a>
      </p>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">
        Novara Cleaning · <a href="mailto:operations@novaracleaning.com" style="color:#64748b">operations@novaracleaning.com</a>
      </p>
    </div>`;
  return { subject, html };
}
