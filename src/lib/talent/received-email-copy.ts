// Copy for the "we received your application" email. No network, no secrets —
// the sender and the offline check both read this.

export interface ReceivedEmailContent {
  subject: string;
  html: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function applicantReceivedEmail(args: {
  firstName?: string | null;
  fullName?: string | null;
}): ReceivedEmailContent {
  const first =
    String(args.firstName || "").trim() ||
    String(args.fullName || "").trim().split(/\s+/)[0] ||
    "there";
  const safe = escapeHtml(first);
  return {
    subject: "We received your Novara Cleaning application",
    html: `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 8px;font-size:20px">We received your application</h2>
      <p style="margin:0 0 16px;color:#475569">Hi ${safe},</p>
      <p style="margin:0 0 16px;color:#475569">
        Thank you for applying to join the Novara Cleaning contractor team. We have your application.
      </p>
      <p style="margin:0 0 16px;color:#475569">
        If you are selected, expect a phone call or a text from us to set up a phone screen.
        Please watch your phone and this inbox so we can reach you.
      </p>
      <p style="margin:0 0 16px;color:#475569">
        We review applications as openings come up. Selection is not guaranteed.
      </p>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">
        Novara Cleaning · <a href="mailto:team@novaracleaning.com" style="color:#64748b">team@novaracleaning.com</a>
      </p>
    </div>`,
  };
}
