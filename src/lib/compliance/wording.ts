// Editable legal copy. These drafts are the seed. Counsel publishes a new
// version from the admin compliance page; a published version is never
// rewritten. Customer pages render the live version. The "Draft pending
// legal review" mark is admin-only and is not part of the customer text.

export type WordingStatus = "draft" | "reviewed";

export type WordingKind =
  | "terms"
  | "refund_policy"
  | "cancellation_policy"
  | "card_authorization"
  | "membership_terms"
  | "sms_service"
  | "sms_promo"
  | "email_marketing"
  | "authority_to_book"
  | "photos_recordings"
  | "electronic_consent"
  | "disclaimer"
  | "service_agreement"
  | "cookie_banner"
  | "privacy_summary";

export interface WordingVersion {
  id: string;
  kind: WordingKind;
  version: number;
  status: WordingStatus;
  title: string;
  /** Customer-facing text. {{tokens}} are filled from the booking. Links are [label](url). */
  body: string;
  createdAt: string;
  createdBy: string;
}

const SEEDED_AT = "2026-10-16T00:00:00.000Z";

function seed(
  kind: WordingKind,
  title: string,
  body: string,
): WordingVersion {
  return {
    id: `${kind}-v1`,
    kind,
    version: 1,
    status: "draft",
    title,
    body,
    createdAt: SEEDED_AT,
    createdBy: "system",
  };
}

export const SEEDED_WORDING: WordingVersion[] = [
  seed(
    "terms",
    "Terms of service",
    "I agree to the Novara Cleaning [Terms of Service](https://novaracleaning.com/terms) and to the booking or agreement terms shown on this page.",
  ),
  seed(
    "refund_policy",
    "Refund policy",
    "I have read the [Refund Policy](https://novaracleaning.com/refund-policy) and I understand how refunds work before I pay.",
  ),
  seed(
    "cancellation_policy",
    "Cancellation policy",
    "I have read the [Cancellation Policy](https://novaracleaning.com/cancellation-policy) and I understand how to cancel and which fees can apply before I pay.",
  ),
  seed(
    "card_authorization",
    "Card on file and payment authorization",
    "I authorize Novara Cleaning to charge the card I provide {{dueNowWhen}}. The amount due now is {{dueNowLabel}}. {{balanceSentence}} The amount is determined like this: {{amountBasis}}. The card will be saved {{savedFor}}. I can cancel a visit or change the card online from my booking or membership page, or by emailing hello@novaracleaning.com. I do not have to call. [Refund Policy](https://novaracleaning.com/refund-policy). [Cancellation Policy](https://novaracleaning.com/cancellation-policy).",
  ),
  seed(
    "membership_terms",
    "Membership and recurring billing",
    "I agree to a recurring Novara Cleaning plan at {{pricePerVisit}} per visit, billed {{frequency}}. The first charge is {{firstChargeLabel}} {{firstChargeWhen}}. The next charge is {{nextChargeWhen}}. The plan renews automatically until I cancel. I can cancel, pause, or change the card online on my membership page. I do not have to call. [Cancellation Policy](https://novaracleaning.com/cancellation-policy). [Refund Policy](https://novaracleaning.com/refund-policy).",
  ),
  seed(
    "sms_service",
    "Service text messages",
    "I agree that Novara Cleaning may text {{phone}} about this booking, reminders, and service updates. This box is not consent for promotions. Message frequency varies with the booking, usually a few messages per visit. Message and data rates may apply. Reply STOP to opt out and HELP for help. [Privacy Policy](https://novaracleaning.com/privacy). If I do not want texts, Novara Cleaning will use email for coordination wherever it can.{{textsRequiredSentence}}",
  ),
  seed(
    "sms_promo",
    "Promotional text messages",
    "I agree that Novara Cleaning may text {{phone}} promotional offers. This is separate from service texts. About four messages a month. Message and data rates may apply. Reply STOP to opt out and HELP for help. [Privacy Policy](https://novaracleaning.com/privacy). This is optional and is not required to book.",
  ),
  seed(
    "email_marketing",
    "Email marketing",
    "I agree to receive promotional emails from Novara Cleaning. I can unsubscribe in any email. This is optional and is not required to book. Emails about this booking are separate and still sent.",
  ),
  seed(
    "authority_to_book",
    "Authority to book",
    "{{authoritySentence}} This acceptance applies to {{property}}.",
  ),
  seed(
    "photos_recordings",
    "Photos, cameras, and recordings",
    "I understand Novara Cleaning takes before and after photos inside the home as proof that the service was done and to review quality. Those photos are used for the job record, quality review, and payment disputes. They are not used in marketing unless I give separate permission. I will tell Novara Cleaning about cameras or other recording devices in the home. I will not record audio of cleaners. Calls with Novara Cleaning may be recorded or transcribed for training, quality, and record-keeping.",
  ),
  seed(
    "electronic_consent",
    "Electronic records and signatures",
    "I agree to do business electronically with Novara Cleaning, including this signature and these acceptances. To get a paper copy, I can email hello@novaracleaning.com.",
  ),
  seed(
    "disclaimer",
    "Disclaimer",
    "I acknowledge the [Disclaimer](https://novaracleaning.com/disclaimer).",
  ),
  seed(
    "service_agreement",
    "Service agreement",
    "I have read and agree to the [One-Time Service Agreement](/agreements/one-time-service-agreement.pdf), including the deposit and any balance charged after the cleaning.",
  ),
  seed(
    "cookie_banner",
    "Cookie notice",
    "Novara Cleaning uses essential cookies so booking, security, and payments work. Those stay on. Analytics, and advertising or tracking (including the Meta pixel and ad measurement), stay off unless you accept them. Declining does not block booking and does not change the price.",
  ),
  seed(
    "privacy_summary",
    "Privacy summary (draft for counsel)",
    "Novara Cleaning collects the contact details, home details, booking details, and payment references needed to schedule and perform cleaning, to charge the card you authorize, and to send booking messages. Payment card numbers are handled by Stripe. Texts are sent through the messaging provider on the account. If you accept advertising cookies, Meta and Google Ads receive the booking event only (started or completed), not your name, full address, or access details. Access codes are kept for the crew for a limited time and then removed. You can ask to see, correct, or delete your information from the privacy request page. Some records are kept when the law, taxes, a claim, or a payment dispute requires it, and that reason is written on the request.",
  ),
];

export function wordingByKind(versions: WordingVersion[], kind: WordingKind): WordingVersion | null {
  const rows = versions.filter((row) => row.kind === kind);
  if (!rows.length) return null;
  return rows.reduce((best, row) => (row.version > best.version ? row : best));
}
