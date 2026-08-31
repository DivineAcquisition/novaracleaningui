// Offline verification of the three-page commercial onboarding session.
//
//   • Pricing → Agreement → Billing, portal is not a fourth page
//   • Request Changes pauses before anything binding
//   • Billing page stays current until billed AND portal-ready
//   • Invoice vs Stripe Pre-Auth only changes the billing label
//
//   Run:  npm run commercial-onboarding:verify

import {
  billingStepLabel,
  deriveCommercialOnboardingProgress,
} from "../src/lib/commercial-onboarding/progress";

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

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll commercial onboarding progress checks passed.");
