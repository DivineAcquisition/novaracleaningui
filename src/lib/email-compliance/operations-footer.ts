// NVC Operations footer. Base block on every contractor email, plus one add-on.
// Draft pending legal review until counsel marks the wording reviewed.
// Links are words. Plain text repeats the address in angle brackets.

export type OperationsAddon =
  | "application"
  | "onboarding"
  | "identity"
  | "background"
  | "pre_adverse"
  | "final_adverse"
  | "agreement"
  | "assignment"
  | "relationship"
  | "payout"
  | "payout_change"
  | "w9"
  | "tax_form"
  | "data_request"
  | "recruiting";

const ADDON_BY_TEMPLATE: Record<string, OperationsAddon> = {
  contractor_invitation: "onboarding",
  readiness_reminder: "onboarding",
  contractor_reject: "application",
  field_cleaner_application: "application",
  contractor_identity: "identity",
  contractor_background: "background",
  contractor_pre_adverse: "pre_adverse",
  contractor_final_adverse: "final_adverse",
  contractor_agreement: "agreement",
  docuseal_agreement: "agreement",
  contractor_assignment: "assignment",
  contractor_engagement_end: "relationship",
  contractor_payout: "payout",
  contractor_payment_summary: "payout",
  contractor_final_payment: "payout",
  contractor_payout_change: "payout_change",
  contractor_w9: "w9",
  contractor_tax: "tax_form",
  contractor_data_request: "data_request",
  contractor_recruiting: "recruiting",
};

export function operationsAddon(templateKey: string | null | undefined): OperationsAddon {
  return ADDON_BY_TEMPLATE[String(templateKey || "").trim()] || "application";
}

export interface OperationsFooterInput {
  templateKey?: string | null;
  legalName: string;
  senderName: string;
  addressLine: string;
  email: string;
  phone: string;
  privacyUrl: string;
  officialDomain: string;
  payoutTaxLine: string;
  taxYear?: string;
  consentDate?: string;
  correctionDays?: string;
  paperCopy?: string;
  withdraw?: string;
  unsubscribeUrl?: string | null;
  applicationDate?: string;
  deadlineDate?: string;
  imageDeleteDays?: string;
  finalDecisionDate?: string;
  backgroundCompany?: string;
  dataRequestDays?: string;
  recruitingReason?: string;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function link(href: string, label: string): string {
  return `<a href="${esc(href)}" style="color:#5B5670;text-decoration:underline;">${esc(label)}</a>`;
}

function telHref(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+1${digits.replace(/\D/g, "")}`;
}

function companyLine(input: OperationsFooterInput): string {
  const named = (input.backgroundCompany || "").trim();
  return named || "the background check company named in your authorization";
}

function addonParagraphs(input: OperationsFooterInput, addon: OperationsAddon): string[] {
  const phone = input.phone;
  const company = companyLine(input);
  switch (addon) {
    case "application":
      return [
        `You are receiving this email because you applied to work with ${input.legalName} as an independent contractor on ${input.applicationDate || "the date of your application"}. These messages are about your application only.`,
        "If you no longer want to be considered, reply WITHDRAW. We will stop contacting you about this application.",
        `If you need an accommodation to complete the application, reply to this email or call ${phone}.`,
      ];
    case "onboarding":
      return [
        `You are receiving this email because you were conditionally approved to join Novara's contractor network. Approval depends on finishing onboarding, including identity and vehicle checks and a background check. Your onboarding link expires on ${input.deadlineDate || "the date in your link"}.`,
        "Need more time or help? Reply to this email. Time spent waiting on Novara does not count against your deadline.",
        "If you no longer want to continue, reply WITHDRAW.",
      ];
    case "identity":
      return [
        `We use your ID photo and selfie only to confirm you are the person who applied. We delete these images ${input.imageDeleteDays || "the number of"} days after your result, as stated in our Privacy Notice.`,
        "If you prefer not to use the automatic face match, reply to this email and a person at Novara will review a secure upload instead.",
        "Do not send your ID by email. Upload it only through your onboarding link.",
      ];
    case "background":
      return [
        "Novara Cleaning may obtain a consumer report about you for contractor onboarding. A background check is ordered only after you give a separate written authorization. The background check company does not make decisions about your application. Novara does.",
        `To ask about your report, contact ${input.email} or ${company}.`,
      ];
    case "pre_adverse":
      return [
        "Before Novara decides whether to continue your onboarding, we are sending you a copy of your background check report and A Summary of Your Rights Under the Fair Credit Reporting Act (attached). You may dispute or explain anything in the report. The background check company did not make this decision and cannot tell you why.",
        `You have until ${input.finalDecisionDate || "the date in this notice"} to respond. Reply to this email or call ${phone} to send a correction or an explanation.`,
        `Background check company: ${company}. You can get a free copy of your report from them within 60 days and dispute its accuracy with them directly.`,
      ];
    case "final_adverse":
      return [
        "This decision was made by Novara, not by the background check company, which did not know the reasons for it.",
        `Background check company: ${company}.`,
        "You have the right to a free copy of your report from them within 60 days, and to dispute the accuracy or completeness of any information in it directly with them.",
        "A Summary of Your Rights Under the Fair Credit Reporting Act was sent with your earlier notice. Reply to this email to ask for another copy.",
      ];
    case "agreement":
      return [
        `You are receiving this email because a signature or acceptance is needed under your relationship with ${input.legalName} as an independent contractor. A copy of what you sign is kept in your contractor record and is available on request.`,
        `Read the full document before you sign. You may ask questions or ask for time to review before signing. Reply to this email or call ${phone}.`,
      ];
    case "assignment":
      return [
        "You are receiving this message about work you may accept under your Independent Contractor Agreement. You can accept or decline any job offer.",
        "Do not reply with gate codes or alarm codes. Open the job in the Novara app to see access details.",
      ];
    case "relationship":
      return [
        `This message relates to your independent contractor relationship with ${input.legalName} under your Independent Contractor Agreement. Questions or corrections: reply to this email.`,
        "A copy of this message is kept in your contractor record.",
      ];
    case "payout":
      return [
        input.payoutTaxLine,
        "Payments are made to the payout method you chose. If a detail looks wrong, reply right away and do not send your bank or card numbers by email.",
        "This Payment Summary shows jobs and amounts paid.",
      ];
    case "payout_change":
      return [
        "We received a request to change your payout method. If this was not you, reply STOP CHANGE immediately and we will freeze it. We may verify changes before the next pay run.",
      ];
    case "w9":
      return [
        "We need your W-9 to report payments to you. Provide it only through the secure form in your onboarding link. Do not email your Social Security number, EIN, or ITIN.",
        "Questions about which taxpayer ID to use? Ask your own tax adviser. Novara cannot give you tax advice.",
      ];
    case "tax_form":
      return [
        `Your Form 1099-NEC for ${input.taxYear || "the tax year"} is available through the secure link in this email. You are receiving it electronically because you consented on ${input.consentDate || "the date you consented"}. ${input.paperCopy || "To request a paper copy, reply to this email."} ${input.withdraw || "To withdraw your consent, reply to this email."} If anything looks wrong, reply within ${input.correctionDays || "the number of"} days.`,
        "This email does not include your full taxpayer ID.",
      ];
    case "data_request":
      return [
        `You are receiving this email because you asked about the information Novara holds about you. We will respond within ${input.dataRequestDays || "the number of"} days. We may need to confirm your identity first. We cannot delete some records that we are required to keep, such as tax and payment records.`,
      ];
    case "recruiting":
      return [];
    default:
      return [];
  }
}

function baseText(input: OperationsFooterInput): string[] {
  return [
    `${input.senderName}, on behalf of ${input.legalName}`,
    input.addressLine,
    `${input.email} | ${input.phone}`,
    "Novara works with cleaners as independent contractors.",
    `Privacy Notice <${input.privacyUrl}>`,
    `Safety reminder: we will never ask for your full Social Security number, bank account number, or card number by email or text. Only enter details on pages on ${input.officialDomain}.`,
    `Questions about your information? Email ${input.email}. You can ask to see, correct, or delete what we hold about you.`,
  ];
}

export function operationsFooter(raw: OperationsFooterInput): { html: string; text: string; addon: OperationsAddon } {
  const addon = operationsAddon(raw.templateKey);
  const phoneHref = telHref(raw.phone);
  if (addon === "recruiting") {
    const reason = raw.recruitingReason || "you asked to hear about openings";
    const unsub = raw.unsubscribeUrl || `mailto:${raw.email}?subject=Unsubscribe`;
    const text = [
      `Advertisement. Independent contractor opportunity with ${raw.legalName}.`,
      `${raw.senderName}, on behalf of ${raw.legalName}`,
      `${raw.addressLine} | ${raw.email} | ${raw.phone}`,
      `You are receiving this because ${reason}.`,
      `Unsubscribe <${unsub}>`,
      "Reply STOP",
      "Unsubscribing takes effect within 10 business days. We will honor it sooner, usually immediately. We never sell your email address.",
      `Privacy Notice <${raw.privacyUrl}>`,
    ];
    const html = `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #E5E1F2;font-family:Inter,Arial,sans-serif;font-size:12px;line-height:1.5;color:#5B5670;">
      <p style="margin:0 0 6px 0;">Advertisement. Independent contractor opportunity with ${esc(raw.legalName)}.</p>
      <p style="margin:0 0 6px 0;"><strong>${esc(raw.senderName)}, on behalf of ${esc(raw.legalName)}</strong><br>
      ${esc(raw.addressLine)} | ${link(`mailto:${raw.email}`, raw.email)} | ${link(phoneHref.startsWith("+") ? `tel:${phoneHref}` : `tel:${phoneHref}`, raw.phone)}</p>
      <p style="margin:0 0 6px 0;">You are receiving this because ${esc(reason)}.</p>
      <p style="margin:0 0 6px 0;">${link(unsub, "Unsubscribe")}<br>Reply STOP</p>
      <p style="margin:0 0 6px 0;">Unsubscribing takes effect within 10 business days. We will honor it sooner, usually immediately. We never sell your email address.</p>
      <p style="margin:0;">${link(raw.privacyUrl, "Privacy Notice")}</p>
    </div>`;
    return { html, text: text.join("\n"), addon };
  }

  const paragraphs = addonParagraphs(raw, addon);
  const base = baseText(raw);
  const text = [...paragraphs, ...base].join("\n");
  const addonHtml = paragraphs.map((line) => `<p style="margin:0 0 6px 0;">${esc(line)}</p>`).join("");
  const html = `<div style="margin-top:24px;padding-top:12px;border-top:1px solid #E5E1F2;font-family:Inter,Arial,sans-serif;font-size:12px;line-height:1.5;color:#5B5670;">
    ${addonHtml}
    <p style="margin:0 0 6px 0;"><strong>${esc(raw.senderName)}, on behalf of ${esc(raw.legalName)}</strong><br>
    ${esc(raw.addressLine)}<br>
    ${link(`mailto:${raw.email}`, raw.email)} | ${link(`tel:${phoneHref}`, raw.phone)}</p>
    <p style="margin:0 0 6px 0;">Novara works with cleaners as independent contractors.<br>
    ${link(raw.privacyUrl, "Privacy Notice")}</p>
    <p style="margin:0 0 6px 0;">Safety reminder: we will never ask for your full Social Security number, bank account number, or card number by email or text. Only enter details on pages on ${esc(raw.officialDomain)}.</p>
    <p style="margin:0;">Questions about your information? ${link(`mailto:${raw.email}`, "Contact Operations")}. You can ask to see, correct, or delete what we hold about you.</p>
  </div>`;
  return { html, text, addon };
}
