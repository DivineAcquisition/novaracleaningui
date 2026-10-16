// Email type, footer, consent, and send rules.
//
//   Run:  npx tsx scripts/verify-email-compliance.ts

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  EMAIL_CATALOG,
  applyConsentChange,
  asEvidenceExcerpt,
  buildFooter,
  canReceiveMarketing,
  evaluateEmail,
  hasMailingAddress,
  mergeBusinessIdentity,
  migrationReport,
  retentionCutoff,
  toDeliveryRecord,
  type ApprovedClaim,
  type ConsentRecord,
} from "../src/lib/email-compliance/engine";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}
function assert(name: string, ok: boolean) {
  check(name, ok, true);
}

const address = {
  line1: "100 King St",
  line2: "",
  city: "Alexandria",
  region: "VA",
  postalCode: "22314",
  country: "US",
};
const ready = mergeBusinessIdentity({
  mailingAddress: address,
  marketing: {
    displayName: "Novara Cleaning",
    address: "hello@mail.novaracleaning.com",
    replyTo: "support@novaracleaning.com",
    streamKey: "marketing",
  },
});
const urls = {
  unsubscribeUrl: "https://app.novaracleaning.com/email/unsubscribe?t=abc",
  preferencesUrl: "https://app.novaracleaning.com/email/preferences?t=abc",
  oneClickUrl: "https://app.novaracleaning.com/api/email/unsubscribe?t=abc",
};
const subscribed: ConsentRecord = {
  status: "subscribed",
  source: "booking_form",
  sourceNote: "",
  consentBasis: "Asked on the booking form",
  categories: null,
  at: "2026-10-01T00:00:00.000Z",
};
const offerClaim: ApprovedClaim = {
  id: "savings_percent",
  phrase: "50% off",
  basis: "One video testimonial code, second cleaning only",
  conditional: true,
  requiredWording: "second cleaning",
  active: true,
};

console.log("Catalog:");
assert("every template has one type", EMAIL_CATALOG.every((row) => Boolean(row.assignedType)));
assert("unclear templates still have a type", EMAIL_CATALOG.filter((row) => row.ownerDecisionNeeded).every((row) => row.assignedType === "customer_service" || row.assignedType === "customer_marketing"));
assert("migration lists every template", migrationReport().length === EMAIL_CATALOG.length);
for (const key of ["booking_confirmation", "abandoned_cart", "job_feedback", "testimonial_offer", "contractor_payout", "contractor_tax"]) {
  assert(`${key} is on the shared sender`, EMAIL_CATALOG.find((row) => row.key === key)?.routed === true);
}

console.log("\nService mail:");
const confirmation = evaluateEmail({
  declaredType: "customer_service",
  templateKey: "booking_confirmation",
  subject: "Your Novara cleaning is confirmed",
  html: "<p>Your cleaning on Tuesday is confirmed.</p><p>New Customer Discount: -$20.00</p>",
  identity: ready,
  ...urls,
});
check("booking confirmation sends", confirmation.decision, "send");
check("booking confirmation is service", confirmation.type, "customer_service");
assert("service footer names the booking", confirmation.text.includes("because of your booking or account"));
assert("service footer has the address", confirmation.text.includes("100 King St"));
assert("service footer has no unsubscribe", !/Unsubscribe/.test(confirmation.footer.text));
assert("service footer warns about card numbers", confirmation.text.includes("full card number"));
assert("service footer links the refund policy", confirmation.footer.text.includes("https://novaracleaning.com/refund-policy"));
assert("policy words carry the address", confirmation.footer.html.includes(">Refund Policy</a>") && !/>Refund Policy \(http/.test(confirmation.footer.html));
assert("legal links sit under the service text", confirmation.footer.html.indexOf("full card number") < confirmation.footer.html.indexOf(">Privacy Policy</a>"));
assert("applied discount is not treated as a promotion", confirmation.promoRemoved === false);
assert("booking mail is sent from support@", confirmation.from.includes("support@novaracleaning.com") && !confirmation.from.includes("hello@"));
assert("reply-to is the support inbox", confirmation.replyTo === "support@novaracleaning.com");
assert("plain text carries the footer", confirmation.text.includes(confirmation.footer.text.split("\n")[0]));
assert("the novara mark is on the message", confirmation.html.includes("novara-logo.png"));
assert("the message sits in the card", confirmation.html.includes("data-novara-card"));

const defaults = mergeBusinessIdentity(null);
assert("starting address is the Lanham office", defaults.mailingAddress.line1 === "7404 Executive Place" && defaults.mailingAddress.city === "Lanham" && defaults.mailingAddress.postalCode === "20706");
assert("legal name is Novara Cleaning LLC", defaults.legalName === "Novara Cleaning LLC");
const cleared = mergeBusinessIdentity({
  legalName: "Novara Cleaning LLC",
  mailingAddress: { line1: "", line2: "", city: "", region: "", postalCode: "", country: "US" },
});
assert("a cleared address stays empty", !hasMailingAddress(cleared.mailingAddress));
const missingAddress = evaluateEmail({
  declaredType: "customer_service",
  templateKey: "booking_confirmation",
  subject: "Confirmed",
  html: "<p>Your cleaning is confirmed.</p>",
  identity: cleared,
  ...urls,
});
check("service still sends without a mailing address", missingAddress.decision, "send");

const offered = evaluateEmail({
  declaredType: "customer_service",
  templateKey: "booking_confirmation",
  subject: "Confirmed",
  html: "<p>Your cleaning is confirmed.</p><p>Complete your booking in the next 24 hours and get 5% off.</p>",
  identity: ready,
  ...urls,
});
check("a service email with an offer still sends after the offer is removed", offered.decision, "send");
assert("the offer is flagged", offered.promoRemoved === true || offered.warnings.some((line) => /promotional/i.test(line)));
assert("the sent service body no longer offers 5% off", !/5% off/i.test(offered.html));

const receipt = evaluateEmail({
  declaredType: "customer_service",
  templateKey: "booking_payment_receipt",
  subject: "Payment received",
  html: "<p>We received your payment.</p>",
  identity: ready,
  ...urls,
});
check("a receipt sends", receipt.decision, "send");
assert("a receipt is sent from billing@", receipt.from.includes("billing@novaracleaning.com"));
assert("a receipt replies to billing@", receipt.replyTo === "billing@novaracleaning.com");

const credit = evaluateEmail({
  declaredType: "customer_service",
  templateKey: "credit_allocated",
  subject: "A credit was added",
  html: "<p>A credit was added to your account.</p>",
  identity: ready,
  ...urls,
});
assert("a credit notice names the refunds inbox", credit.text.includes("refunds@novaracleaning.com"));
assert("a credit notice is kept on the account", credit.text.includes("kept in your account record"));

const partner = evaluateEmail({
  declaredType: "agreement_account",
  templateKey: "partner_agreement",
  subject: "Your agreement",
  html: "<p>Please review the agreement.</p>",
  identity: ready,
  ...urls,
});
assert("a partner agreement names the governing contract", partner.text.includes("Your agreement with Novara Cleaning LLC governs this account"));

console.log("\nMarketing:");
const promo = evaluateEmail({
  declaredType: "customer_marketing",
  templateKey: "abandoned_cart",
  subject: "Your booking is still open",
  html: "<p>Complete checkout for 5% off. New customers only, one per household, and this offer expires in 24 hours.</p>",
  identity: ready,
  claims: [{ ...offerClaim, phrase: "5% off", requiredWording: "one per household" }],
  consent: subscribed,
  category: "offers",
  ...urls,
});
check("promotional email sends when the rules pass", promo.decision, "send");
assert("marketing footer has unsubscribe", /Unsubscribe/.test(promo.footer.text));
assert("marketing footer has preferences", promo.footer.text.includes("Email preferences"));
assert("marketing footer has the address", promo.footer.text.includes("Alexandria"));
assert("marketing footer says it is promotional", /promotional email/i.test(promo.text));
assert("marketing footer names why", promo.text.includes("you booked with NovaraCleaning"));
assert("marketing footer says unsubscribe stops promotions only", promo.text.includes("Unsubscribing stops promotional emails only"));
assert("marketing footer carries the offer terms", promo.text.includes("Offer terms:") && promo.text.includes("one per household"));
assert("mail apps get a one-click header", promo.headers["List-Unsubscribe-Post"] === "List-Unsubscribe=One-Click");
assert("marketing uses the marketing stream", promo.stream === "marketing");
assert("unsubscribe link is not tiny", promo.footer.html.includes("font-size:13px") && promo.footer.html.includes("font-weight:700"));
assert("links sit under the footer sentences", promo.footer.html.indexOf("Unsubscribing stops") < promo.footer.html.indexOf(">Unsubscribe</a>"));
assert("footer links share one row", promo.footer.html.includes("novara-footer-links") && promo.footer.html.includes("·"));
assert("unsubscribe is the word, not the raw url", promo.footer.html.includes(">Unsubscribe</a>") && !/>Unsubscribe \(http/.test(promo.footer.html));

const noAddress = evaluateEmail({
  ...urls,
  declaredType: "customer_marketing",
  subject: "A note",
  html: "<p>5% off expires tomorrow. One per household.</p>",
  claims: [{ ...offerClaim, phrase: "5% off", requiredWording: "one per household" }],
  consent: subscribed,
  identity: mergeBusinessIdentity({
    legalName: "Novara Cleaning LLC",
    mailingAddress: { line1: "", line2: "", city: "", region: "", postalCode: "", country: "US" },
    marketing: ready.marketing,
  }),
});
check("marketing is blocked without a mailing address", noAddress.decision, "block");

const noClaim = evaluateEmail({
  declaredType: "customer_marketing",
  subject: "Hello",
  html: "<p>We are insured and background-checked.</p>",
  identity: ready,
  consent: subscribed,
  claims: [],
  ...urls,
});
check("an unapproved claim blocks marketing", noClaim.decision, "block");

const review = evaluateEmail({
  declaredType: "customer_service",
  templateKey: "job_feedback",
  subject: "How was your clean",
  html: "<p>Get 50% off your second cleaning. One per household. The code expires in 30 days.</p>",
  identity: ready,
  claims: [offerClaim],
  consent: subscribed,
  ...urls,
});
check("a review request with a discount is marketing", review.type, "customer_marketing");
check("that review request can send", review.decision, "send");
assert("the mismatch is visible", Boolean(review.mismatch));

const visitOnly = evaluateEmail({
  declaredType: "review_request",
  templateKey: "job_feedback",
  subject: "How was your Novara clean?",
  html: "<p>Three questions about your completed visit.</p>",
  identity: ready,
  ...urls,
});
check("a visit-only review request stays service", visitOnly.type, "customer_service");
assert("visit-only mail has no unsubscribe", !/Unsubscribe/.test(visitOnly.footer.text));

console.log("\nConsent:");
check("admin cannot resubscribe", applyConsentChange({
  actor: "admin",
  current: "unsubscribed",
  next: "subscribed",
  source: "manual",
}).ok, false);
check("the person can resubscribe", applyConsentChange({
  actor: "contact",
  current: "unsubscribed",
  next: "subscribed",
  source: "preference_page",
}).ok, true);
check("email consent does not touch text", applyConsentChange({
  actor: "contact",
  current: "subscribed",
  next: "unsubscribed",
  source: "unsubscribe_link",
}).smsUnchanged, true);
check("import without a note cannot be mailed", canReceiveMarketing({
  status: "not_asked",
  source: "import",
  sourceNote: "",
  consentBasis: "purchased list",
  categories: null,
  at: null,
}, null, false).ok, false);
const suppressed = evaluateEmail({
  declaredType: "customer_marketing",
  subject: "Hello",
  html: "<p>Tips for a cleaner home. This note expires next month. One per household.</p>",
  identity: ready,
  consent: subscribed,
  suppressed: true,
  suppressionReason: "unsubscribe",
  ...urls,
});
check("a suppressed address is not mailed", suppressed.decision, "block");

console.log("\nContractor and tax:");
const payout = evaluateEmail({
  declaredType: "contractor_operational",
  templateKey: "contractor_payout",
  subject: "Your payout was sent",
  html: "<p>Your payout was sent. Reference tr_1234567890abcd.</p>",
  identity: ready,
  contractorRelationship: "active",
});
check("payout sends", payout.decision, "send");
assert("payout is from NVC Operations", payout.from.includes("NVC Operations") && payout.from.includes("operations@novaracleaning.com"));
assert("payout has no unsubscribe", !/Unsubscribe/.test(payout.footer.text));
assert("payout reference is masked", !payout.html.includes("tr_1234567890abcd"));
assert("contractor footer names operations", payout.text.includes("NVC Operations, on behalf of Novara Cleaning LLC"));
assert("payout footer states no taxes were withheld", payout.text.includes("No taxes were withheld"));

const stub = evaluateEmail({
  declaredType: "contractor_operational",
  templateKey: "contractor_payout",
  subject: "Pay stub",
  html: "<p>Here is your pay stub.</p>",
  identity: ready,
});
check("pay stub wording is blocked", stub.decision, "block");

const taxBlocked = evaluateEmail({
  declaredType: "contractor_tax",
  templateKey: "contractor_tax",
  subject: "Your 1099-NEC",
  html: "<p>Your form is attached.</p>",
  identity: ready,
});
check("1099 email is blocked without electronic consent", taxBlocked.decision, "block");

const tax = evaluateEmail({
  declaredType: "contractor_tax",
  templateKey: "contractor_tax",
  subject: "Your 1099-NEC",
  html: "<p>Your form is attached. Taxpayer id 123-45-6789 stays out of this message.</p>",
  identity: ready,
  taxElectronicConsentAt: "2026-01-02T00:00:00.000Z",
  ...urls,
});
check("1099 email sends with consent", tax.decision, "send");
assert("paper-copy line is present", tax.text.includes(ready.paperCopyLine));
assert("full taxpayer id is not in the email", !tax.html.includes("123-45-6789") && !tax.text.includes("123-45-6789"));

const ended = evaluateEmail({
  declaredType: "contractor_operational",
  templateKey: "contractor_assignment",
  subject: "New job",
  html: "<p>A job is available.</p>",
  identity: ready,
  contractorRelationship: "offboarded",
});
check("offboarded contractors do not get new assignments", ended.decision, "block");

console.log("\nPreview, versions, and the dispute packet:");
const light = buildFooter(ready, "customer_marketing", urls);
const darkIdentity = mergeBusinessIdentity({ ...ready, mailingAddress: { ...address, line1: "200 Queen St" } });
const nextFooter = buildFooter(darkIdentity, "customer_marketing", urls);
assert("dark preview is a separate render", light.darkHtml.includes("#18181b"));
assert("plain text matches the footer lines", light.text.includes("promotional email"));
assert("a changed address creates a new footer version", light.versionKey !== nextFooter.versionKey);
const oldAgain = buildFooter(ready, "customer_marketing", urls);
check("the previous footer is still reproducible", oldAgain.versionKey, light.versionKey);

const record = toDeliveryRecord(promo, { to: "Guest@Example.com", templateKey: "abandoned_cart", sentAt: "2026-10-15T12:00:00.000Z" });
check("the log stores the address that was mailed", record.contactEmail, "guest@example.com");
assert("the log stores the rendered body", record.html.includes("NOVARA_FOOTER"));
assert("the log stores the footer version", record.footerVersion === promo.footer.versionKey);
const excerpt = asEvidenceExcerpt(record);
assert("the dispute packet can quote the sent text", Boolean(excerpt && excerpt.body.includes("100 King St")));
check("kept for 24 months by default", retentionCutoff("2026-10-15T00:00:00.000Z", mergeBusinessIdentity(null).retentionMonths).slice(0, 7), "2024-10");

console.log("\nEngine copies:");
const app = readFileSync("src/lib/email-compliance/engine.ts");
const edge = readFileSync("supabase/functions/_shared/email-compliance.ts");
check("edge engine matches the app engine", createHash("sha256").update(app).digest("hex"), createHash("sha256").update(edge).digest("hex"));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll email compliance checks passed.");
