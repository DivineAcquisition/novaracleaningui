// ─── verify-scope-billing ───────────────────────────────────────────────────
//
// Scope extras live on final_charge_cents and must be billed when the job is
// marked complete (or immediately if the job is already complete). Run with:
//   npx tsx scripts/verify-scope-billing.ts

import {
  billedTotalCents,
  capturedTowardJobCents,
  remainingDueAtCompletionCents,
  scopeAdjustmentChargeNowCents,
} from "../src/lib/booking-balance";
import {
  draftJustificationMessage,
  formatScopeReasonPrice,
  scopeReasonPricePreview,
  type ScopeReason,
} from "../src/lib/scope-adjustment";

let failures = 0;
let passes = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    passes++;
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(
      `  ✗ ${name}\n      expected ${JSON.stringify(expected)}\n      got      ${JSON.stringify(actual)}`,
    );
  }
}

const mold: ScopeReason = {
  code: "mold_minor",
  label: "Mold — Minor (surface)",
  customer_phrase: "minor surface mold that was treated during the visit",
  internal_hint: null,
  customer_facing: true,
  suggests_service_type: null,
  service_label_override: null,
  sort_order: 73,
  active: true,
};

const heavy: ScopeReason = {
  code: "heavy_condition",
  label: "Heavy / Excessive Condition",
  customer_phrase: "the home was in significantly heavier condition than a standard clean covers",
  internal_hint: null,
  customer_facing: true,
  suggests_service_type: "deep",
  service_label_override: null,
  sort_order: 10,
  active: true,
};

const occupied: ScopeReason = {
  code: "occupied_premises",
  label: "Occupied / In-Use Premises",
  customer_phrase: "occupants actively using the spaces being cleaned",
  internal_hint: null,
  customer_facing: false,
  suggests_service_type: null,
  service_label_override: null,
  sort_order: 60,
  active: true,
};

const engineInput = {
  homeSizeId: "1000_1500",
  addOns: [] as string[],
  membershipPlan: "none",
  usesCredit: false,
  originalServiceType: "standard",
  originalPriceCents: 16150,
};

console.log("remainingDueAtCompletionCents");
check(
  "deposit job, no adjustment",
  remainingDueAtCompletionCents({
    total_estimate_cents: 20000,
    deposit_cents: 10000,
    payment_option: "deposit",
  }),
  10000,
);
check(
  "deposit job after +$65 scope extra (total_estimate left alone)",
  remainingDueAtCompletionCents({
    total_estimate_cents: 20000,
    deposit_cents: 10000,
    final_charge_cents: 26500,
    payment_option: "deposit",
  }),
  16500,
);
check(
  "paid in full at booking, deposit_cents 0 — do not re-bill the job",
  remainingDueAtCompletionCents({
    total_estimate_cents: 20000,
    deposit_cents: 0,
    payment_option: "full",
  }),
  0,
);
check(
  "paid in full + scope extra — only the extra is due",
  remainingDueAtCompletionCents({
    total_estimate_cents: 20000,
    deposit_cents: 0,
    final_charge_cents: 26500,
    payment_option: "full",
  }),
  6500,
);
check(
  "paid in full with deposit stamped as the full amount + extra",
  remainingDueAtCompletionCents({
    total_estimate_cents: 20000,
    deposit_cents: 20000,
    final_charge_cents: 26500,
    payment_option: "full",
  }),
  6500,
);
check(
  "membership credit visit — original rate is covered",
  remainingDueAtCompletionCents({
    total_estimate_cents: 12900,
    deposit_cents: 0,
    payment_option: "credit",
    uses_credit: true,
  }),
  0,
);
check(
  "membership credit visit + mold extra",
  remainingDueAtCompletionCents({
    total_estimate_cents: 12900,
    deposit_cents: 0,
    final_charge_cents: 19400,
    payment_option: "credit",
    uses_credit: true,
  }),
  6500,
);
check(
  "credit visit with $0 stamped total + extra",
  remainingDueAtCompletionCents({
    total_estimate_cents: 0,
    deposit_cents: 0,
    final_charge_cents: 6500,
    payment_option: "credit",
    uses_credit: true,
  }),
  6500,
);
check(
  "recurring billed at completion — whole visit",
  remainingDueAtCompletionCents({
    total_estimate_cents: 12900,
    deposit_cents: 0,
    payment_option: "balance_on_completion",
  }),
  12900,
);
check(
  "recurring billed at completion + extra",
  remainingDueAtCompletionCents({
    total_estimate_cents: 12900,
    deposit_cents: 0,
    final_charge_cents: 19400,
    payment_option: "balance_on_completion",
  }),
  19400,
);
check(
  "immediately billed add-on is not charged again at completion",
  remainingDueAtCompletionCents({
    total_estimate_cents: 37300,
    deposit_cents: 16900,
    final_charge_cents: 52300,
    payment_option: "preauth",
  }, 3500),
  31900,
);
check(
  "paid-in-full add-on sits inside the quote so it is not deducted again",
  remainingDueAtCompletionCents({
    total_estimate_cents: 20000,
    deposit_cents: 20000,
    final_charge_cents: 26500,
    payment_option: "full",
    payment_received_at: "2026-08-16T12:00:00Z",
  }, 3500),
  6500,
);
check(
  "already-captured completion is not billed again",
  remainingDueAtCompletionCents({
    total_estimate_cents: 20000,
    deposit_cents: 10000,
    final_charge_cents: 26500,
    payment_option: "deposit",
    balance_amount_cents: 16500,
  }),
  0,
);

console.log("Jessie NVC-0065 replica");
const jessie = {
  total_estimate_cents: 37300,
  final_charge_cents: 52300,
  deposit_cents: 16900,
  payment_option: "preauth",
  payment_received_at: "2026-08-15T14:48:09Z",
  status: "completed",
  balance_amount_cents: 20400,
  completion_hold_status: "captured",
  completion_hold_amount_cents: 16900,
  completion_hold_captured_amount: 16900,
  completion_hold_captured_at: "2026-08-16T18:04:30Z",
};
check("job total is $523", billedTotalCents(jessie), 52300);
check(
  "remaining $115 after deposit, hold+overage, paid pet-hair add-on",
  remainingDueAtCompletionCents(jessie, 3500),
  11500,
);
check("captured $408 so far", capturedTowardJobCents(jessie, 3500), 40800);
check(
  "unrecorded hold would look like $319 still due",
  remainingDueAtCompletionCents({
    ...jessie,
    balance_amount_cents: null,
    completion_hold_status: "authorized",
    completion_hold_captured_amount: null,
    completion_hold_captured_at: null,
  }, 3500),
  31900,
);

console.log("scopeAdjustmentChargeNowCents");
check(
  "in-progress job defers the extra until complete-booking",
  scopeAdjustmentChargeNowCents(
    {
      status: "in_progress",
      total_estimate_cents: 20000,
      deposit_cents: 10000,
      payment_option: "deposit",
    },
    26500,
  ),
  0,
);
check(
  "already complete, deposit remaining already charged — only extra now",
  scopeAdjustmentChargeNowCents(
    {
      status: "completed",
      total_estimate_cents: 20000,
      deposit_cents: 10000,
      payment_option: "deposit",
      balance_charged_at: "2026-08-16T12:00:00Z",
      balance_amount_cents: 10000,
      balance_payment_intent_id: "pi_test",
    },
    26500,
  ),
  6500,
);
check(
  "already complete, paid in full, no completion PI — extra now",
  scopeAdjustmentChargeNowCents(
    {
      status: "completed",
      total_estimate_cents: 20000,
      deposit_cents: 0,
      payment_option: "full",
    },
    26500,
  ),
  6500,
);
check(
  "already complete, completion charge failed — collect remaining including extra",
  scopeAdjustmentChargeNowCents(
    {
      status: "completed",
      total_estimate_cents: 20000,
      deposit_cents: 10000,
      payment_option: "deposit",
    },
    26500,
  ),
  16500,
);

console.log("scopeReasonPricePreview");
check(
  "mold reason shows catalog $65",
  formatScopeReasonPrice(scopeReasonPricePreview(mold, engineInput)),
  "$65",
);
const heavyPreview = scopeReasonPricePreview(heavy, engineInput);
check("heavy condition is a positive engine delta", (heavyPreview.cents || 0) > 0, true);
check(
  "heavy condition formats with a plus",
  formatScopeReasonPrice(heavyPreview).startsWith("+$"),
  true,
);
check(
  "occupancy has no fixed price",
  formatScopeReasonPrice(scopeReasonPricePreview(occupied, engineInput)),
  "set below",
);

console.log("draftJustificationMessage");
const drafted = draftJustificationMessage({
  firstName: "Alex",
  reasons: [mold],
  selectedCodes: ["mold_minor"],
  adjustedServiceType: "standard",
  originalPriceCents: 16150,
  adjustedPriceCents: 22650,
  hasPhotoEvidence: true,
  chargeAt: "completion",
});
check(
  "customer copy names the extra and says it bills at completion",
  drafted.includes("additional $65.00") &&
    drafted.includes("when this clean is completed") &&
    drafted.includes("card on file"),
  true,
);

if (failures > 0) {
  console.error(`\n${failures} failed, ${passes} passed`);
  process.exit(1);
}
console.log(`\n${passes} passed`);
