// Offline verification of P&L rollups (no network/DB).
//
//   Run:  npx tsx scripts/verify-pnl.ts

import {
  addDaysYmd,
  bookingRef,
  bookingRevenueCents,
  buildPnl,
  formatRoas,
  monthKey,
  monthsInclusive,
  sumMonths,
  type PnlBooking,
} from "../src/lib/pnl";

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

const kimberly: PnlBooking = {
  id: "k1",
  booking_number: 101,
  first_name: "Kimberly",
  last_name: "Harper",
  business_name: null,
  service_date: "2026-09-08",
  service_type: "deep",
  status: "confirmed",
  final_charge_cents: null,
  total_estimate_cents: 33060,
  cleaner_payout_cents: 7438,
};
const nikkia: PnlBooking = {
  id: "n1",
  booking_number: 96,
  first_name: "Nikkia",
  last_name: "Franks",
  business_name: null,
  service_date: "2026-09-09",
  service_type: "deep",
  status: "assigned",
  final_charge_cents: null,
  total_estimate_cents: 16875,
  cleaner_payout_cents: 6918,
};
const done: PnlBooking = {
  id: "c1",
  booking_number: 80,
  first_name: "Done",
  last_name: "Job",
  business_name: null,
  service_date: "2026-09-02",
  service_type: "standard",
  status: "completed",
  final_charge_cents: 31070,
  total_estimate_cents: 30000,
  cleaner_payout_cents: 10000,
};
const reclean: PnlBooking = {
  id: "r1",
  booking_number: 81,
  first_name: "Re",
  last_name: "Clean",
  business_name: null,
  service_date: "2026-09-02",
  service_type: "standard",
  status: "completed",
  final_charge_cents: 20000,
  total_estimate_cents: 20000,
  cleaner_payout_cents: 0,
  is_reclean: true,
};
const cancelled: PnlBooking = {
  id: "x1",
  booking_number: 1,
  first_name: "Nope",
  last_name: "X",
  business_name: null,
  service_date: "2026-09-03",
  service_type: "standard",
  status: "cancelled",
  final_charge_cents: null,
  total_estimate_cents: 99999,
  cleaner_payout_cents: 0,
};

console.log("Helpers:");
check("NVC ref pads to 4", bookingRef(kimberly), "NVC-0101");
check("revenue prefers final charge", bookingRevenueCents(done), 31070);
check("re-clean is $0", bookingRevenueCents(reclean), 0);
check("addDaysYmd crosses months", addDaysYmd("2026-08-31", 1), "2026-09-01");
check("monthsInclusive May–Sep", monthsInclusive("2026-05-01", "2026-09-04"), [
  "2026-05",
  "2026-06",
  "2026-07",
  "2026-08",
  "2026-09",
]);

const pnl = buildPnl({
  todayYmd: "2026-09-04",
  since: "2026-09-01",
  bookings: [kimberly, nikkia, done, reclean, cancelled],
  payouts: [{ booking_id: "c1", amount_cents: 11000, status: "completed" }],
  extras: [{ booking_id: "c1", total_cents: 1500, status: "paid" }],
  adSpend: [
    {
      date: "2026-09-01",
      platform: "Facebook",
      spend_cents: 49500,
      leads_calls: 11,
      booked_jobs: 2,
      campaign_notes: "Kimberly + Nikkia",
    },
  ],
  expenses: [
    {
      date: "2026-09-04",
      type: "Reimbursement",
      who: "Dana",
      description: "mop heads",
      amount_cents: 1200,
      status: "Paid",
    },
    {
      date: "2026-09-04",
      type: "Promised",
      who: "Luis",
      description: "gas",
      amount_cents: 4000,
      status: "Promised",
    },
  ],
});

const sep = pnl.months.find((m) => m.month === "2026-09")!;
console.log("September rollup:");
check("collected is the completed job only", sep.collectedCents, 31070);
check("pipeline is Kimberly + Nikkia", sep.pipelineCents, 33060 + 16875);
check("cancelled is ignored", sep.pipelineJobs, 2);
check("re-clean does not add revenue", sep.completedJobs, 1);
check("cleaner pay uses payouts ledger", sep.cleanerPayCents, 11000);
check("extra pay is a job cost", sep.extraPayCents, 1500);
check("job profit", sep.jobProfitCents, 31070 - 11000 - 1500);
check("paid expense hits contribution", sep.paidExpenseCents, 1200);
check("promised expense stays off profit", sep.promisedExpenseCents, 4000);
check("Facebook spend", sep.adSpendCents, 49500);
check(
  "contribution = profit - ads - paid expenses",
  sep.contributionCents,
  31070 - 11000 - 1500 - 49500 - 1200,
);
check("booked ROAS uses collected + pipeline", sep.bookedRoas, Math.round(((31070 + 33060 + 16875) / 49500) * 100) / 100);
check("monthKey of ad date", monthKey("2026-09-01"), "2026-09");
check("formatRoas", formatRoas(sep.bookedRoas), "1.64x");
check("Kimberly is pipeline", pnl.jobs.find((j) => j.ref === "NVC-0101")?.pipeline, true);
check("cancelled is not a job row", pnl.jobs.some((j) => j.ref === "NVC-0001"), false);

const all = sumMonths(pnl.months);
check("all-time collected matches September", all.collectedCents, sep.collectedCents);
check("all-time pipeline matches September", all.pipelineCents, sep.pipelineCents);

if (failures) {
  console.error(`\n${failures} failure(s).`);
  process.exit(1);
}
console.log("\nAll P&L checks passed.");
