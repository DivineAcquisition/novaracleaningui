// Offline verification of the three-page commercial onboarding session.
//
//   • Pricing → Agreement → Billing, portal is not a fourth page
//   • Request Changes pauses before anything binding
//   • Billing page stays current until billed AND portal-ready
//   • Invoice vs Stripe Pre-Auth only changes the billing label
//
//   Run:  npm run commercial-onboarding:verify

import {
  applyCommercialOnboardingPreviewAction,
  commercialOnboardingPreviewMethod,
  commercialOnboardingPreviewPayload,
  isCommercialOnboardingPreviewToken,
  resetCommercialOnboardingPreview,
} from "../src/lib/commercial-onboarding/preview";
import {
  billingStepLabel,
  deriveCommercialOnboardingProgress,
} from "../src/lib/commercial-onboarding/progress";
import { buildCommercialValues, COMMERCIAL_AUTO_PAY_FIELD } from "../src/lib/docuseal";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

console.log("Page order and gates:");
const fresh = deriveCommercialOnboardingProgress({ billingMethod: "invoiced" });
check("opens on pricing", fresh.current_step, "pricing");
check("not complete", fresh.complete, false);
check("three pages", fresh.steps.map((s) => s.key), ["pricing", "agreement", "billing"]);
check("no page is done yet", fresh.steps.map((s) => s.done), [false, false, false]);

const paused = deriveCommercialOnboardingProgress({
  proposalStatus: "changes_requested",
  billingMethod: "invoiced",
});
check("request changes pauses", paused.current_step, "paused");
check("paused_for_changes is true", paused.paused_for_changes, true);
check("pause is not complete", paused.complete, false);

const accepted = deriveCommercialOnboardingProgress({
  proposalStatus: "accepted",
  hasAgreement: true,
  agreementStatus: "pending",
  billingMethod: "invoiced",
});
check("accepting pricing advances to agreement", accepted.current_step, "agreement");
check("pricing page is done", accepted.steps[0].done, true);
check("agreement page is not done", accepted.steps[1].done, false);

const signed = deriveCommercialOnboardingProgress({
  proposalStatus: "accepted",
  hasAgreement: true,
  agreementStatus: "signed",
  billingConfigured: false,
  portalReady: false,
  billingMethod: "auto_pay",
});
check("signing advances to billing", signed.current_step, "billing");
check("agreement page is done", signed.steps[1].done, true);
check("billing page is not done until billed AND portal", signed.steps[2].done, false);

const billedOnly = deriveCommercialOnboardingProgress({
  proposalStatus: "accepted",
  hasAgreement: true,
  agreementStatus: "signed",
  billingConfigured: true,
  portalReady: false,
  billingMethod: "invoiced",
});
check("billing without portal stays on billing (not a fourth page)", billedOnly.current_step, "billing");
check("billing_configured is true", billedOnly.billing_configured, true);
check("portal_ready is false", billedOnly.portal_ready, false);
check("complete requires portal", billedOnly.complete, false);

const done = deriveCommercialOnboardingProgress({
  proposalStatus: "accepted",
  hasAgreement: true,
  agreementStatus: "signed",
  billingConfigured: true,
  portalReady: true,
  billingMethod: "invoiced",
});
check("portal on billing page completes the session", done.current_step, "done");
check("complete", done.complete, true);
check("billing page done only when billed and portal ready", done.steps[2].done, true);

console.log("\nAdmin-selected billing method labels:");
check(
  "Stripe Pre-Auth label",
  billingStepLabel("auto_pay"),
  "Billing setup (Stripe Pre-Auth) and portal access",
);
check(
  "Invoice label",
  billingStepLabel("invoiced"),
  "Billing setup (Invoice) and portal access",
);
check(
  "auto_pay session still uses three pages",
  deriveCommercialOnboardingProgress({ billingMethod: "auto_pay" }).steps.length,
  3,
);

console.log("\nLocalhost preview tokens:");
check("auto_pay token", isCommercialOnboardingPreviewToken("preview-commercial"), true);
check("invoiced token", isCommercialOnboardingPreviewToken("preview-commercial-invoiced"), true);
check("production-looking token is not preview", isCommercialOnboardingPreviewToken("a".repeat(64)), false);
check(
  "invoiced token selects invoice method",
  commercialOnboardingPreviewMethod("preview-commercial-invoiced"),
  "invoiced",
);
check(
  "billing=invoiced overrides auto_pay token",
  commercialOnboardingPreviewMethod("preview-commercial", "invoiced"),
  "invoiced",
);

resetCommercialOnboardingPreview();
const refuseSign = applyCommercialOnboardingPreviewAction("preview-commercial", "sign", {
  signerName: "Nadia Okonkwo",
  agreedToTerms: true,
});
check("sign is refused before pricing is accepted", refuseSign.status, 409);

const accept = applyCommercialOnboardingPreviewAction("preview-commercial", "accept_pricing", {
  name: "Nadia Okonkwo",
});
check("accept pricing succeeds", accept.ok, true);
const afterAccept = commercialOnboardingPreviewPayload("preview-commercial");
check("accept advances to agreement", afterAccept.progress.current_step, "agreement");
check("three pages after accept", afterAccept.progress.steps.map((s) => s.key), [
  "pricing",
  "agreement",
  "billing",
]);

const sign = applyCommercialOnboardingPreviewAction("preview-commercial", "sign", {
  signerName: "Nadia Okonkwo",
  agreedToTerms: true,
});
check("sign succeeds after accept", sign.ok, true);
const afterSign = commercialOnboardingPreviewPayload("preview-commercial");
check("sign advances to billing", afterSign.progress.current_step, "billing");
check("auto_pay billing copy mentions Stripe Pre-Auth", afterSign.progress.steps[2].label.includes("Stripe Pre-Auth"), true);
check("auto_pay page has no invoice contact yet", afterSign.session.billingMethod, "auto_pay");

const extra = applyCommercialOnboardingPreviewAction("preview-commercial", "submit_info", {
  kind: "site_request",
  siteAddress: "200 E Pratt Street, Baltimore, MD",
});
check("additional site is accepted", extra.ok, true);
const afterExtra = commercialOnboardingPreviewPayload("preview-commercial");
check("additional site does not complete billing", afterExtra.progress.complete, false);
check("additional site does not mark billing done", afterExtra.progress.steps[2].done, false);
check("still on billing after extra site", afterExtra.progress.current_step, "billing");

const billed = applyCommercialOnboardingPreviewAction("preview-commercial", "setup_billing", {});
check("preview auto_pay setup does not redirect to Stripe", Boolean(billed.url), false);
check("billing setup completes the preview session", billed.ok, true);
const afterBill = commercialOnboardingPreviewPayload("preview-commercial");
check("portal is the conclusion of billing", afterBill.progress.current_step, "done");
check("handoff goes to commercial portal preview", afterBill.handoffUrl, "/partner/enter/preview-commercial");

resetCommercialOnboardingPreview();
const invoicedPage = commercialOnboardingPreviewPayload("preview-commercial-invoiced", "billing");
check("invoiced jump lands on billing", invoicedPage.progress.current_step, "billing");
check("invoiced label", invoicedPage.progress.steps[2].label.includes("Invoice"), true);
check("invoiced session method", invoicedPage.session.billingMethod, "invoiced");
const badInvoice = applyCommercialOnboardingPreviewAction("preview-commercial-invoiced", "setup_billing", {});
check("invoiced billing refuses without email", badInvoice.status, 400);
const goodInvoice = applyCommercialOnboardingPreviewAction("preview-commercial-invoiced", "setup_billing", {
  billingContactEmail: "ap@harboreast.example",
});
check("invoiced billing accepts a contact", goodInvoice.ok, true);
const invoicedDone = commercialOnboardingPreviewPayload("preview-commercial-invoiced");
check(
  "invoiced handoff opens invoiced portal preview",
  invoicedDone.handoffUrl,
  "/partner?preview=commercial&billing=invoiced",
);

resetCommercialOnboardingPreview();
const pausedJump = commercialOnboardingPreviewPayload("preview-commercial", "paused");
check("paused jump shows the pause card", pausedJump.progress.current_step, "paused");
check("paused is not complete", pausedJump.progress.complete, false);

console.log("\nDocuSeal commercial field map:");
const commercialFields = buildCommercialValues({
  businessName: "Harbor East Holdings",
  contactName: "Nadia Okonkwo",
  email: "nadia@harboreast.example",
  phone: "410-555-0142",
  address: "1000 S Caroline St, Baltimore, MD",
  accountType: "commercial",
  billingMethod: "invoiced",
  invoiceCycle: "monthly",
  netTerms: "net_15",
  sites: [
    {
      nickname: "Canton suite",
      address: "3600 Boston St",
      sqft: 1100,
      facilityType: "office",
      scopeLevel: "light",
      crewSize: 2,
      firmPriceCents: 10000,
      cadence: "weekly",
      serviceWindowStart: "18:00",
      serviceWindowEnd: "21:00",
      walkthroughCompleted: true,
    },
  ],
});
check("Client is the business name", commercialFields.Client, "Harbor East Holdings");
check("invoiced cycle is monthly", commercialFields["Billing Cycle"], "monthly");
check("net 15 maps to 15", commercialFields["Net Days"], 15);
check("auto-pay checkbox is off for invoiced", commercialFields[COMMERCIAL_AUTO_PAY_FIELD], false);
check("Site 1 rate is dollars not cents", commercialFields["Site1 Rate"], 100);
check("unused Site 2 is N/A", commercialFields["Site2 Nickname"], "N/A");
check("walkthrough is Yes when a site was walked", commercialFields["Walkthrough Completed"], "Yes");
check("auto-pay field uses the non-breaking hyphen", COMMERCIAL_AUTO_PAY_FIELD.includes("\u2011"), true);

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll commercial onboarding progress checks passed.");
