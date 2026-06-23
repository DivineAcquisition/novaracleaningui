// ─── Offline verification of the Airtable mapping math (no network/PAT) ───────
//
// Exercises the pure pieces of the integration so the Section 6 checklist can be
// validated without touching the live base:
//   • locked pay: Foundation $239 → $83.65 pool → $41.83 per cleaner (2 cleaners)
//   • pay period = Monday of the week of date_completed
//   • mappers are deterministic (re-running produces identical fields → upsert
//     never duplicates)
//   • select vocab is the exact option-name strings we write
//
//   Run:  npm run airtable:verify

import { computeJobPay, payPeriodMonday, payPeriodSunday } from "../src/lib/airtable/pay";
import { JOB_SERVICE_TYPE, PAYMENT_STATUS } from "../src/lib/airtable/schema";
import { bookingToJobInput } from "../src/lib/airtable/sources/supabase";

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

console.log("Pay math:");
const foundation = computeJobPay(23_900, 35, 2);
check("Foundation $239 → pool $83.65", foundation.poolDollars, 83.65);
check("two cleaners → $41.83 each", foundation.perCleanerDollars, 41.83);
check("locked tier %", foundation.tierPct, 35);

const single = computeJobPay(23_900, 35, 1);
check("one cleaner → $83.65", single.perCleanerDollars, 83.65);

const elite = computeJobPay(20_000, 45, 1);
check("Elite 45% of $200 → $90.00", elite.poolDollars, 90);

console.log("\nPay period (Mon–Sun):");
// 2026-06-23 is a Tuesday → Monday is 2026-06-22, Sunday 2026-06-28.
check("Monday of week", payPeriodMonday("2026-06-23"), "2026-06-22");
check("Sunday of week", payPeriodSunday("2026-06-22"), "2026-06-28");

console.log("\nMapper determinism (idempotency):");
const booking = {
  id: "b1",
  booking_number: 142,
  status: "completed",
  service_type: "deep",
  service_date: "2026-06-23",
  completed_at: "2026-06-23T18:00:00Z",
  email: "host@example.com",
  final_charge_cents: 23_900,
  num_cleaners_assigned: 2,
  booking_channel: "partner_portal",
};
const cleaners = [
  { first_name: "Ava", last_name: "Cleaner", pay_percentage: 35 },
  { first_name: "Ben", last_name: "Cleaner", pay_percentage: 35 },
];
const first = bookingToJobInput(booking, cleaners);
const second = bookingToJobInput(booking, cleaners);
check("same input → identical mapper output", first, second);
check("jobId is the unique booking id", first.jobId, "b1");
check("service type mapped", first.serviceType, JOB_SERVICE_TYPE.deep);
check("payment status mapped", first.paymentStatus, PAYMENT_STATUS.paid);
check("tier % from cleaners", first.tierPct, 35);
check("customerPaidCents", first.customerPaidCents, 23_900);

console.log("\nSelect vocab (exact option strings):");
check("Deep option", JOB_SERVICE_TYPE.deep, "Deep");
check("STR Turnover option", JOB_SERVICE_TYPE.strTurnover, "STR Turnover");
check("Pending status", PAYMENT_STATUS.pending, "Pending");

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll checks passed.");
