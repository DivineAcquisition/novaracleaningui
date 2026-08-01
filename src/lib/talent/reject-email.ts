// ─── Applicant rejection email ────────────────────────────────────────────────
//
// Sent whenever an applicant moves to `rejected` (manual reject or phone-screen
// decline). From team@, CC contact@, best-effort — a missing Resend key or
// bounce must never block the stage change itself.

import { getAdminSupabase } from "@/lib/airtable/sources/admin-client";

const FROM = "Novara Cleaning Team <team@novaracleaning.com>";
const CC = ["contact@novaracleaning.com"];

async function resolveResendKey(): Promise<string> {
  const fromEnv = (process.env.RESEND_API_KEY || "").trim();
  if (fromEnv) return fromEnv;
  try {
    const supabase = getAdminSupabase();
    const { data } = await supabase.from("app_secrets").select("value").eq("key", "RESEND_API_KEY").maybeSingle();
    return String(data?.value || "").trim();
  } catch {
    return "";
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface RejectEmailResult {
  sent: boolean;
  error: string | null;
}

/**
 * Email the applicant that their application was not moved forward.
 * Does not throw — callers treat delivery as informational.
 */
export async function sendApplicantRejectEmail(args: {
  email: string | null | undefined;
  firstName?: string | null;
  fullName?: string | null;
  reason?: string | null;
}): Promise<RejectEmailResult> {
  const to = String(args.email || "").trim().toLowerCase();
  if (!to || !to.includes("@")) {
    return { sent: false, error: "No email on the applicant record." };
  }

  const key = await resolveResendKey();
  if (!key) {
    return { sent: false, error: "RESEND_API_KEY is not configured." };
  }

  const first =
    String(args.firstName || "").trim() ||
    String(args.fullName || "").trim().split(/\s+/)[0] ||
    "there";
  const reason = String(args.reason || "").trim();

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <h2 style="margin:0 0 8px;font-size:20px">Update on your Novara Cleaning application</h2>
      <p style="margin:0 0 16px;color:#475569">Hi ${escapeHtml(first)},</p>
      <p style="margin:0 0 16px;color:#475569">
        Thank you for your interest in joining the Novara Cleaning contractor team.
        After reviewing your application, we will not be moving forward at this time.
      </p>
      ${
        reason
          ? `<p style="margin:0 0 16px;color:#475569"><strong>Note:</strong> ${escapeHtml(reason)}</p>`
          : ""
      }
      <p style="margin:0 0 16px;color:#475569">
        We appreciate the time you took to apply and wish you the best.
      </p>
      <p style="margin:16px 0 0;color:#94a3b8;font-size:12px">
        Novara Cleaning · <a href="mailto:team@novaracleaning.com" style="color:#64748b">team@novaracleaning.com</a>
      </p>
    </div>`;

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        to: [to],
        cc: CC,
        subject: "Update on your Novara Cleaning application",
        html,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { sent: false, error: `Resend ${res.status}${body ? `: ${body.slice(0, 200)}` : ""}` };
    }
    return { sent: true, error: null };
  } catch (err) {
    return { sent: false, error: (err as Error).message || "Failed to send rejection email" };
  }
}
