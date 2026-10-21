import { usesForbiddenApplicantLanguage } from "./decide";
import { wordingById } from "./wording";

export type ApplicantMessageKind =
  | "submitted"
  | "conditional_approval"
  | "not_a_fit"
  | "waitlist"
  | "needs_review"
  | "reminder"
  | "step_completed"
  | "background_status"
  | "pre_adverse"
  | "final_adverse"
  | "expired"
  | "trial_scheduled"
  | "activated"
  | "lead_invite"
  | "lead_paused"
  | "lead_decision";

export interface ApplicantMessage {
  kind: ApplicantMessageKind;
  subject: string;
  text: string;
}

const SENDER = "NVC Operations";

function finish(kind: ApplicantMessageKind, subject: string, text: string): ApplicantMessage {
  const body = `${text}\n\n${SENDER}\noperations@novaracleaning.com`;
  if (usesForbiddenApplicantLanguage(`${subject}\n${body}`)) {
    throw new Error(`Applicant message uses language that is not allowed: ${kind}`);
  }
  return { kind, subject, text: body };
}

export function applicantMessage(
  kind: ApplicantMessageKind,
  detail?: { firstName?: string | null; body?: string | null; link?: string | null },
): ApplicantMessage {
  const name = (detail?.firstName || "").trim() || "there";
  const extra = (detail?.body || "").trim();
  const link = (detail?.link || "").trim();
  switch (kind) {
    case "submitted":
      return finish(kind, "We received your application", `Hi ${name}, we received your application. We will write to you with the result.`);
    case "conditional_approval":
      return finish(
        kind,
        "Your application is conditionally approved",
        `Hi ${name}, you are conditionally approved. Approval depends on finishing onboarding, including identity and vehicle verification and a background check. No phone call is required.${link ? `\n\nStart onboarding: ${link}` : ""}`,
      );
    case "not_a_fit":
      return finish(kind, "About your application", `Hi ${name}, ${extra || "A requirement for this role was not met."}`);
    case "waitlist":
      return finish(kind, "You are on the waitlist", `Hi ${name}, your ZIP is outside the area we cover today. We will contact you if that area opens. This is not a rejection.`);
    case "needs_review":
      return finish(kind, "Your application is being reviewed", `Hi ${name}, ${extra || "A person is reviewing your application."}`);
    case "reminder":
      return finish(kind, "Your onboarding step is still open", `Hi ${name}, ${extra || "An onboarding step is still open."}${link ? `\n\n${link}` : ""}`);
    case "step_completed":
      return finish(kind, "Onboarding step received", `Hi ${name}, ${extra || "We received that onboarding step."}`);
    case "background_status":
      return finish(kind, "Background check update", `Hi ${name}, ${extra || "Your background check status changed."}`);
    case "pre_adverse":
      return finish(
        kind,
        "Notice before a decision on your background check",
        `Hi ${name}, before Novara decides whether to continue, we are sending the background check report and A Summary of Your Rights Under the Fair Credit Reporting Act. You can dispute or explain the report during the waiting period. The background check company did not make this decision.`,
      );
    case "final_adverse":
      return finish(
        kind,
        "Decision after your background check",
        `Hi ${name}, Novara is not continuing your onboarding based on the consumer report. The background check company did not make this decision. You can dispute the report with that company and ask them for a free copy within 60 days. ${extra}`.trim(),
      );
    case "expired":
      return finish(kind, "Onboarding window closed", `Hi ${name}, ${extra || "The onboarding window closed. You can apply again after the reapply date."}`);
    case "trial_scheduled":
      return finish(kind, "Your trial job is scheduled", `Hi ${name}, your first job is a trial job.${link ? ` Details: ${link}` : ""} An admin records the result.`);
    case "activated":
      return finish(kind, "You are active on the Novara network", `Hi ${name}, you are active and in the probation period described in your agreement. Job offers can come through the app.`);
    case "lead_invite":
      return finish(kind, "Lead Cleaner invitation", `Hi ${name}, you meet the Lead Cleaner requirements on file. This invitation is optional. You can apply, or you can leave it.${link ? `\n\n${link}` : ""}`);
    case "lead_paused":
      return finish(kind, "Lead status is paused", `Hi ${name}, ${extra || "Lead status is paused. You are still an active cleaner."}`);
    case "lead_decision":
      return finish(kind, "Lead Cleaner decision", `Hi ${name}, ${extra || "A person recorded a decision on your Lead Cleaner application."}`);
    default:
      return finish("submitted", "We received your application", `Hi ${name}, we received your application.`);
  }
}

export function messageUsesDraftWording(id: string): boolean {
  return wordingById(id)?.status !== "reviewed";
}
