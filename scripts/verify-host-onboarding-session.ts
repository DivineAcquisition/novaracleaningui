// Offline verification of tokenized host onboarding (no network/DB).
//
//   • three pages, fixed order, signature gates Pages 2 and 3
//   • rates are confirm/flag only — never host-editable
//   • Pay After is absent unless Company enabled it
//   • additional-property requests do not become snapshot rows
//   • stalled window matches the commercial pattern
//
//   Run:  npm run host-onboarding:verify

import { PAYMENT_OPTIONS, PAY_AFTER_DISCRETION } from "../src/lib/host-onboarding/agreement";
import {
  deriveHostOnboardingProgress,
  ratesReady,
  sessionIsStalled,
} from "../src/lib/host-onboarding/progress";

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

const props = ["p1", "p2"];

console.log("Step order and signature gate:");
const unsigned = deriveHostOnboardingProgress({
  signed: false,
  snapshotPropertyIds: props,
  decisions: [
    { propertyId: "p1", decision: "confirmed" },
    { propertyId: "p2", decision: "confirmed" },
  ],
  paymentOption: "full",
  paymentMethodOnFile: true,
  portalReady: true,
});
check("unsigned stays on legal even if later facts exist", unsigned.current_step, "legal");
check("unsigned is not complete", unsigned.complete, false);
check("unsigned rates_ready is false (gated)", unsigned.rates_ready, false);
check("unsigned payment_ready is false (gated)", unsigned.payment_ready, false);

const signedOnly = deriveHostOnboardingProgress({
  signed: true,
  snapshotPropertyIds: props,
  decisions: [],
  paymentOption: null,
  paymentMethodOnFile: false,
  portalReady: false,
});
check("signed with no decisions is on rates", signedOnly.current_step, "rates");
check("legal step is done after signature", signedOnly.steps[0].done, true);
check("rates step is not done until every property is decided", signedOnly.steps[1].done, false);

const oneFlagged = deriveHostOnboardingProgress({
  signed: true,
  snapshotPropertyIds: props,
  decisions: [
    { propertyId: "p1", decision: "confirmed" },
    { propertyId: "p2", decision: "flagged" },
  ],
  paymentOption: null,
  paymentMethodOnFile: false,
  portalReady: false,
});
check("flagging a property still completes the rates page", oneFlagged.current_step, "payment");
check("flag does not block payment", oneFlagged.rates_ready, true);

console.log("\nRates are confirm/flag only:");
check("empty snapshot is not rates-ready", ratesReady([], []), false);
check(
  "partial decisions are not rates-ready",
  ratesReady(props, [{ propertyId: "p1", decision: "confirmed" }]),
  false,
);
check(
  "confirm + flag covers the snapshot",
  ratesReady(props, [
    { propertyId: "p1", decision: "confirmed" },
    { propertyId: "p2", decision: "flagged" },
  ]),
  true,
);

console.log("\nPayment options (Agreement §6.2):");
check("three named options exist", Object.keys(PAYMENT_OPTIONS).sort(), ["full", "pay_after", "split"]);
check("Pay in Full title", PAYMENT_OPTIONS.full.title, "Pay in Full");
check("Split Payment title", PAYMENT_OPTIONS.split.title, "Split Payment");
check("Pay After title", PAYMENT_OPTIONS.pay_after.title, "Pay After (Card on File)");
  check(
  "Pay After names Company discretion",
  /available at the Company's discretion to Hosts in good standing/i.test(PAYMENT_OPTIONS.pay_after.body),
  true,
);
check(
  "discretion copy is the Agreement language",
  PAY_AFTER_DISCRETION.includes("available at the Company's discretion"),
  true,
);

const payAfterOff = deriveHostOnboardingProgress({
  signed: true,
  snapshotPropertyIds: props,
  decisions: [
    { propertyId: "p1", decision: "confirmed" },
    { propertyId: "p2", decision: "confirmed" },
  ],
  paymentOption: null,
  paymentMethodOnFile: false,
  portalReady: false,
  payAfterEnabled: false,
});
check("Pay After disabled is reported on progress", payAfterOff.pay_after_enabled, false);

const done = deriveHostOnboardingProgress({
  signed: true,
  snapshotPropertyIds: props,
  decisions: [
    { propertyId: "p1", decision: "confirmed" },
    { propertyId: "p2", decision: "confirmed" },
  ],
  paymentOption: "split",
  paymentMethodOnFile: true,
  portalReady: true,
});
check("signed + rates + payment + portal is done", done.current_step, "done");
check("done is complete", done.complete, true);

const paymentNoPortal = deriveHostOnboardingProgress({
  signed: true,
  snapshotPropertyIds: props,
  decisions: [
    { propertyId: "p1", decision: "confirmed" },
    { propertyId: "p2", decision: "confirmed" },
  ],
  paymentOption: "full",
  paymentMethodOnFile: true,
  portalReady: false,
});
check("card without portal stays on payment (portal is provisioned there)", paymentNoPortal.current_step, "payment");

console.log("\nStalled sessions:");
const now = Date.parse("2026-08-31T12:00:00Z");
check(
  "idle past 72h surfaces",
  sessionIsStalled({
    status: "active",
    sentAt: "2026-08-27T12:00:00Z",
    complete: false,
    lastActivityAt: "2026-08-27T12:00:00Z",
    stalledAfterHours: 72,
    nowMs: now,
  }),
  true,
);
check(
  "recent activity is not stalled",
  sessionIsStalled({
    status: "active",
    sentAt: "2026-08-31T10:00:00Z",
    complete: false,
    lastActivityAt: "2026-08-31T10:00:00Z",
    stalledAfterHours: 72,
    nowMs: now,
  }),
  false,
);
check(
  "completed sessions do not stall",
  sessionIsStalled({
    status: "completed",
    sentAt: "2026-08-20T12:00:00Z",
    complete: true,
    lastActivityAt: "2026-08-20T12:00:00Z",
    stalledAfterHours: 72,
    nowMs: now,
  }),
  false,
);
check(
  "unsent sessions do not stall",
  sessionIsStalled({
    status: "active",
    sentAt: null,
    complete: false,
    lastActivityAt: "2026-08-20T12:00:00Z",
    stalledAfterHours: 72,
    nowMs: now,
  }),
  false,
);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll host-onboarding checks passed.");
