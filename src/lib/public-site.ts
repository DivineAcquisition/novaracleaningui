// Visitor-facing business facts and the numbers the booking code actually charges.
// Policy pages and the booking site should read this module. Do not type a
// second copy of a fee, a discount, or the phone number into a page.
//
// Discount percents and the deposit come from src/lib/pricing.ts.
// Cancel and reschedule fees come from supabase/functions/_shared/booking-policy.ts.
// The re-clean window comes from supabase/functions/_shared/reclean.ts.
// scripts/verify-public-site.ts fails if those files drift from the values below.

import { DEPOSIT_PERCENT, SERVICE_DISCOUNT_RATES } from "@/lib/pricing";

export const LEGAL_NAME = "Novara Cleaning LLC";
export const BRAND_NAME = "NovaraCleaning";
export const STREET_ADDRESS = "7404 Executive Place, Lanham, MD 20706";

/** Must stay equal to SUPPORT_PHONE_DISPLAY / SUPPORT_PHONE_E164 in booking-policy.ts. */
export const PHONE_DISPLAY = "(844) 735-2070";
export const PHONE_E164 = "+18447352070";
export const PHONE_TEL = `tel:${PHONE_E164}`;

export const EMAILS = {
  support: "support@novaracleaning.com",
  refunds: "refunds@novaracleaning.com",
  cancellations: "cancellations@novaracleaning.com",
  membership: "membership@novaracleaning.com",
  operations: "operations@novaracleaning.com",
} as const;

/**
 * Privacy requests use support@ until the owner confirms a privacy@ mailbox.
 * That choice is an owner decision. It is not shown as a guess of privacy@.
 */
export const PRIVACY_REQUESTS_EMAIL = EMAILS.support;

/** Must stay equal to SHORT_NOTICE_WINDOW_HOURS. */
export const NOTICE_WINDOW_HOURS = 24;
/** Must stay equal to CANCEL_SHORT_NOTICE_FEE_CENTS. */
export const LATE_CANCEL_FEE_CENTS = 5000;
/** Must stay equal to RESCHEDULE_SHORT_NOTICE_FEE_CENTS. */
export const RESCHEDULE_FEE_CENTS = 2500;
/** Must stay equal to DEFAULT_GUARANTEE_WINDOW_HOURS. */
export const RECLEAN_WINDOW_HOURS = 48;

const standardPercent = Math.round(SERVICE_DISCOUNT_RATES.standard * 100);
const deepPercent = Math.round(SERVICE_DISCOUNT_RATES.deep * 100);

export const OFFER_LINES = [
  {
    service: "Standard Clean",
    percentOff: standardPercent,
    terms: `${standardPercent}% off the regular standard-clean price. Not limited to a first visit. Move-in and move-out cleans are not included.`,
  },
  {
    service: "Deep Clean",
    percentOff: deepPercent,
    terms: `${deepPercent}% off the regular deep-clean price. Not limited to a first visit.`,
  },
  {
    service: "Deep plus Standard bundle",
    percentOff: 50,
    terms: "Half off the standard visit only. The deep visit stays at the regular price. This is not half off the whole bundle.",
  },
] as const;

export const OFFER_SUMMARY =
  `Standard cleans are ${standardPercent}% off the regular price. Deep cleans are ${deepPercent}% off. A deep plus standard bundle takes half off the standard visit only. Move-in and move-out cleans and memberships are not discounted. The rate is for that service and home. It is not a first-visit coupon, and it does not expire on a timer.`;

export const DEPOSIT_PERCENT_DISPLAY = Math.round(DEPOSIT_PERCENT * 100);

export const PAYMENT_SUMMARY =
  "Most bookings take a 50% deposit today. The rest is charged after the cleaning. Focused cleans are paid in full at booking. Sales tax is not added.";

export const CANCEL_SUMMARY =
  "Cancel or reschedule at least 24 hours before the visit at no fee. Inside 24 hours, a cancellation is $50 and a reschedule is $25. Outside that window the fee is $0.";

export const PROMISE_SUMMARY =
  "Tell us within 48 hours after the clean and we will schedule a re-clean at no charge. That is the satisfaction promise. It is not a promise that every home will look a certain way.";

export const APPROVED_PUBLIC_CLAIMS = ["Insured", PROMISE_SUMMARY] as const;

/** Shown in admin only. Never render this string on a public page. */
export const DRAFT_REVIEW_LABEL = "Draft pending legal review";

export const ADMIN_GAPS = [
  "The written brief asked for 25% off the first clean everywhere. The pricing engine charges 15% off standard, 25% off deep, and half off only the standard visit in a bundle. Pages now follow the engine.",
  "brand-config.ts still contains an unused 50% new-customer calculator. Live checkout uses src/lib/pricing.ts, which does not apply that 50%.",
  "A separate video-testimonial email still offers 50% off the second clean. That is not the booking discount. It stays blocked in email compliance until the owner approves it.",
  "Failed payment fee, membership cancellation notice, membership minimum visits, pause rules, and support response time are not in the booking or billing code. They were not copied from the old policy pages.",
  "Privacy requests use support@novaracleaning.com. Confirm whether privacy@novaracleaning.com exists before switching.",
  "Legal name is stored as Novara Cleaning LLC until the owner confirms the Maryland registration.",
  "Identity verification is not shown as a public claim. Confirm it is required for every cleaner who enters a home before any verification line is added.",
  "Testimonials on the app home page had no source link, so that section is hidden.",
] as const;

export const POLICY_LINKS = [
  { label: "Terms", href: "https://novaracleaning.com/terms" },
  { label: "Privacy Policy", href: "https://novaracleaning.com/privacy" },
  { label: "Cancellation Policy", href: "https://novaracleaning.com/cancellation-policy" },
  { label: "Refund Policy", href: "https://novaracleaning.com/refund-policy" },
  { label: "Membership Policy", href: "https://novaracleaning.com/membership-policy" },
  { label: "Disclaimer", href: "https://novaracleaning.com/disclaimer" },
  { label: "Text Message Terms", href: "/text-message-terms" },
  { label: "Privacy requests", href: "/privacy-request" },
] as const;

export const PUBLIC_SITE = {
  legalName: LEGAL_NAME,
  brand: BRAND_NAME,
  address: STREET_ADDRESS,
  phoneDisplay: PHONE_DISPLAY,
  phoneTel: PHONE_TEL,
  emails: EMAILS,
  privacyRequestsEmail: PRIVACY_REQUESTS_EMAIL,
  offerSummary: OFFER_SUMMARY,
  offerLines: OFFER_LINES,
  depositPercent: DEPOSIT_PERCENT_DISPLAY,
  paymentSummary: PAYMENT_SUMMARY,
  cancelSummary: CANCEL_SUMMARY,
  promiseSummary: PROMISE_SUMMARY,
  noticeWindowHours: NOTICE_WINDOW_HOURS,
  lateCancelFeeDollars: LATE_CANCEL_FEE_CENTS / 100,
  rescheduleFeeDollars: RESCHEDULE_FEE_CENTS / 100,
  outsideWindowFeeDollars: 0,
  recleanWindowHours: RECLEAN_WINDOW_HOURS,
  recleanCustomerChargeDollars: 0,
  approvedClaims: APPROVED_PUBLIC_CLAIMS,
  policyLinks: POLICY_LINKS,
};

const NEEDS_APPROVAL = [
  "licensed",
  "bonded",
  "background-checked",
  "background checked",
  "guaranteed",
  "best",
  "number one",
  "certified",
];

/** Admin check. Returns phrases that should be reviewed before publishing. */
export function needsApprovalHits(text: string): string[] {
  const lower = text.toLowerCase();
  return NEEDS_APPROVAL.filter((phrase) => lower.includes(phrase));
}

export function visitorSitePayload() {
  return PUBLIC_SITE;
}
