// Booking confirmation comms: one checklist, one membership offer, compliance on both.
//
//   Run: npx tsx scripts/verify-booking-customer-emails.ts

import {
  buildPersonalChecklist,
  checklistViewState,
  personalChecklistUrl,
  renderPersonalEmail,
  resolveChecklistType,
} from "../supabase/functions/_shared/customer-checklists";
import {
  renderWelcomeOfferEmail,
  WELCOME_CLAIM_WORDING,
  WELCOME_OFFER_TERMS,
} from "../supabase/functions/_shared/membership-welcome-copy";
import {
  evaluateEmail,
  mergeBusinessIdentity,
  type ApprovedClaim,
  type ConsentRecord,
} from "../src/lib/email-compliance/engine";

let failures = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

const deep = buildPersonalChecklist({
  first_name: "Sam",
  booking_number: 12,
  service_type: "deep",
  service_date: "2026-11-02",
  time_slot: "9:00 AM - 12:00 PM",
  address: "10 Main St",
  city: "Baltimore",
  state: "MD",
  bedrooms: 3,
  bathrooms: 2,
  add_ons: ["fridge", "oven"],
  pets: "One dog",
});
check("deep clean uses the deep checklist", deep.checklistType === "deep" && deep.heading.includes("Deep"));
check("booked add-ons are listed on their own", deep.yourAddOns.includes("Inside the refrigerator") && deep.yourAddOns.includes("Inside the oven"));
check("a booked add-on is not offered again as an extra", !deep.extras.some((line) => /refrigerator|oven interior/i.test(line)));
check("the visit is on the page", deep.visit.address === "10 Main St, Baltimore, MD" && deep.bookingNumber === "NVC-0012");
check("notes from the booking are included", deep.notes.some((note) => note.label === "Pets" && note.value === "One dog"));
check("move-in resolves", resolveChecklistType("move_in_out") === "moveinout");
check("a cancelled visit cannot be opened", checklistViewState({ status: "cancelled", service_date: "2026-11-02" }) === "cancelled");
check(
  "a visit expires a month after the service date",
  checklistViewState({ status: "completed", service_date: "2026-01-01" }, new Date("2026-03-15T00:00:00Z")) === "expired",
);
const link = personalChecklistUrl("abc123");
check("the checklist link is the private page", link === "https://try.novaracleaning.com/my-checklist/abc123");

const checklistHtml = renderPersonalEmail(deep, link);
const urls = {
  unsubscribeUrl: "https://app.novaracleaning.com/email/unsubscribe?t=abc",
  preferencesUrl: "https://app.novaracleaning.com/email/preferences?t=abc",
  oneClickUrl: "https://app.novaracleaning.com/api/email/unsubscribe?t=abc",
};
const identity = mergeBusinessIdentity({});
const checklistMail = evaluateEmail({
  declaredType: "customer_service",
  templateKey: "cleaning_checklist",
  subject: "Your cleaning checklist for Monday, November 2, 2026",
  html: checklistHtml,
  identity,
  ...urls,
});
check("checklist email sends", checklistMail.decision === "send");
check("checklist email is a service message", checklistMail.type === "customer_service");
check("checklist email keeps the private link", checklistMail.html.includes(link));
check("checklist email carries the service footer", checklistMail.text.includes("because of your booking or account"));
check("checklist email has no unsubscribe", !/Unsubscribe/.test(checklistMail.footer.text));
check("checklist email is not rewritten as marketing", checklistMail.promoRemoved === false);

const welcomeHtml = renderWelcomeOfferEmail({
  firstName: "Sam",
  code: "WELCOME-ABCD2345",
  url: "https://try.novaracleaning.com/welcome/tok",
  expiresLabel: "December 2, 2026",
});
const welcomeClaim: ApprovedClaim = {
  id: "savings_percent",
  phrase: "15% off",
  basis: "First month of a Glow membership after a completed cleaning.",
  conditional: true,
  requiredWording: WELCOME_CLAIM_WORDING,
  active: true,
};
const secondCleanClaim: ApprovedClaim = {
  id: "savings_percent",
  phrase: "50% off",
  basis: "Video testimonial, second cleaning only.",
  conditional: true,
  requiredWording: "second cleaning",
  active: true,
};
const booked: ConsentRecord = {
  status: "not_asked",
  source: "booking_form",
  sourceNote: "Completed a paid cleaning.",
  consentBasis: "Completed a paid cleaning with Novara Cleaning.",
  categories: null,
  at: "2026-11-02T00:00:00.000Z",
};
const welcome = evaluateEmail({
  declaredType: "customer_marketing",
  templateKey: "membership_welcome_offer",
  subject: "Your Glow membership offer: 15% off the first month",
  html: welcomeHtml,
  identity,
  claims: [secondCleanClaim, welcomeClaim],
  consent: booked,
  offerTerms: WELCOME_OFFER_TERMS,
  ...urls,
});
check("welcome offer sends", welcome.decision === "send");
check("welcome offer is marketing", welcome.type === "customer_marketing");
check("welcome offer comes from hello@", welcome.from.includes("hello@novaracleaning.com"));
check("welcome offer replies to hello@", welcome.replyTo.includes("hello@novaracleaning.com"));
check("welcome offer has an unsubscribe", welcome.headers["List-Unsubscribe"]?.includes("unsubscribe"));
check("welcome offer footer names it as promotional", /promotional email/i.test(welcome.text));
check("welcome offer keeps the code", welcome.html.includes("WELCOME-ABCD2345"));

const bare = evaluateEmail({
  declaredType: "customer_marketing",
  templateKey: "membership_welcome_offer",
  subject: "15% off",
  html: "<p>Take 15% off today.</p>",
  identity,
  claims: [secondCleanClaim, welcomeClaim],
  consent: booked,
  offerTerms: WELCOME_OFFER_TERMS,
  ...urls,
});
check("a percentage with neither approved wording is blocked", bare.decision === "block");

const noConsent = evaluateEmail({
  declaredType: "customer_marketing",
  templateKey: "membership_welcome_offer",
  subject: "Your Glow membership offer: 15% off the first month",
  html: welcomeHtml,
  identity,
  claims: [welcomeClaim],
  offerTerms: WELCOME_OFFER_TERMS,
  ...urls,
});
check("the offer does not send with no source on file", noConsent.decision === "block");

console.log(failures === 0 ? "\nAll booking email checks passed." : `\n${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
