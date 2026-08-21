// Offline + optional live verification of the 1099-NEC prep report.
//
//   npm run tax1099:verify
//
// Covers:
//   • tax-year parsing / calendar bounds
//   • $600 NEC threshold
//   • crew breakdown attribution on Custom Payouts
//   • Connect + Custom de-dupe for the same booking+cleaner
//   • failed / pending rows excluded
//   • extra-pay reimbursements peeled off; surge/OT/job-value counted
//   • received tips counted even without paid_out_at
//   • CSV export columns
//   • unauthenticated API shape (route module exports GET/POST)
//   • live DB totals (when SUPABASE_URL + SERVICE_ROLE_KEY are present)

import {
  NEC_THRESHOLD_CENTS,
  aggregate1099,
  parseTaxYear,
  reportToCsv,
  yearBounds,
  type Aggregate1099Input,
  type CleanerRowInput,
} from "../src/lib/payroll-1099";

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

const cleaner = (id: string, last: string, extra: Partial<CleanerRowInput> = {}): CleanerRowInput => ({
  id,
  first_name: "Test",
  last_name: last,
  email: `${id}@novara.test`,
  phone: null,
  status: "active",
  stripe_account_id: extra.stripe_account_id ?? `acct_${id}`,
  payouts_enabled: extra.payouts_enabled ?? true,
  ...extra,
});

const base = (over: Partial<Aggregate1099Input> = {}): Aggregate1099Input => ({
  taxYear: 2026,
  generatedAt: "2026-08-21T00:00:00.000Z",
  cleaners: [cleaner("cat", "Peoples"), cleaner("issac", "Bell")],
  payouts: [],
  manualPayouts: [],
  payrollRuns: [],
  extraPay: [],
  tips: [],
  ...over,
});

console.log("Tax year helpers:");
check("default year is UTC current", parseTaxYear(undefined, new Date("2026-08-21T00:00:00Z")), 2026);
check("string year parses", parseTaxYear("2025"), 2025);
check("out of range falls back", parseTaxYear(1999, new Date("2026-01-01Z")), 2026);
check("2026 bounds", yearBounds(2026), {
  startIso: "2026-01-01T00:00:00.000Z",
  endIso: "2027-01-01T00:00:00.000Z",
});
check("federal NEC threshold is $600", NEC_THRESHOLD_CENTS, 60_000);

console.log("\nAggregation:");

{
  const report = aggregate1099(
    base({
      payouts: [
        {
          cleaner_id: "cat",
          booking_id: "job-1",
          cleaner_payout_cents: 7700,
          status: "completed",
          processed_at: "2026-07-17T19:46:24.000Z",
          created_at: "2026-07-17T19:46:24.000Z",
          stripe_transfer_id: "tr_cat77",
        },
        {
          cleaner_id: "cat",
          booking_id: "job-failed",
          cleaner_payout_cents: 50000,
          status: "failed",
          processed_at: "2026-07-01T00:00:00.000Z",
          created_at: "2026-07-01T00:00:00.000Z",
          stripe_transfer_id: null,
        },
      ],
      manualPayouts: [
        {
          cleaner_id: "cat",
          booking_id: "job-1",
          amount_cents: 7700,
          status: "paid",
          paid_at: "2026-07-17T19:46:24.000Z",
          created_at: "2026-07-17T19:46:24.000Z",
          cleaner_breakdown: [{ cleanerId: "cat", amountCents: 7700 }],
          transfer_ids: [],
        },
      ],
    }),
  );
  const cat = report.cleaners.find((c) => c.cleanerId === "cat");
  check("Connect+Custom same job is not double-counted", cat?.reportableCents, 7700);
  check("that amount is Stripe-tracked", cat?.stripeTrackedCents, 7700);
  check("manual remainder after de-dupe is 0", cat?.sources.manual_payouts, 0);
  check("failed Connect payouts are excluded", cat?.sources.connect_payouts, 7700);
}

{
  const report = aggregate1099(
    base({
      manualPayouts: [
        {
          cleaner_id: null,
          booking_id: "crew-job",
          amount_cents: 13000,
          status: "paid",
          paid_at: "2026-07-22T23:24:19.000Z",
          created_at: "2026-07-22T23:24:19.000Z",
          cleaner_breakdown: [
            { cleanerId: "cat", amountCents: 7000 },
            { cleanerId: "issac", amountCents: 6000 },
          ],
          transfer_ids: [],
        },
      ],
    }),
  );
  check("crew breakdown credits Cat", report.cleaners.find((c) => c.cleanerId === "cat")?.reportableCents, 7000);
  check("crew breakdown credits Issac", report.cleaners.find((c) => c.cleanerId === "issac")?.reportableCents, 6000);
  check("off-Connect because no transfer_ids", report.totals.offConnectCents, 13000);
}

{
  const report = aggregate1099(
    base({
      extraPay: [
        {
          cleaner_id: "issac",
          total_cents: 9000,
          supply_cents: 2000,
          mileage_cents: 1500,
          surge_cents: 2000,
          overtime_cents: 3000,
          job_value_cents: 500,
          status: "paid",
          paid_at: "2026-07-26T23:40:51.000Z",
          created_at: "2026-07-26T23:40:51.000Z",
          stripe_transfer_id: null,
        },
        {
          cleaner_id: "issac",
          total_cents: 4000,
          supply_cents: 0,
          mileage_cents: 0,
          surge_cents: 4000,
          overtime_cents: 0,
          job_value_cents: 0,
          status: "pending",
          paid_at: null,
          created_at: "2026-08-01T00:00:00.000Z",
          stripe_transfer_id: null,
        },
      ],
    }),
  );
  const issac = report.cleaners.find((c) => c.cleanerId === "issac");
  check("extra pay counts surge+OT+job value", issac?.sources.extra_pay, 5500);
  check("mileage+supplies are reimbursements", issac?.reimbursementCents, 3500);
  check("pending extra pay is excluded", report.totals.bySource.extra_pay, 5500);
}

{
  const report = aggregate1099(
    base({
      tips: [
        {
          cleaner_id: "cat",
          amount_cents: 1334,
          status: "received",
          paid_out_at: null,
          created_at: "2026-08-01T17:37:49.000Z",
        },
      ],
    }),
  );
  check("received tips count without paid_out_at", report.totals.bySource.tips, 1334);
}

{
  const report = aggregate1099(
    base({
      cleaners: [cleaner("elite", "Over", { payouts_enabled: true })],
      manualPayouts: [
        {
          cleaner_id: "elite",
          booking_id: "big",
          amount_cents: 60_000,
          status: "paid",
          paid_at: "2026-06-01T00:00:00.000Z",
          created_at: "2026-06-01T00:00:00.000Z",
          cleaner_breakdown: [{ cleanerId: "elite", amountCents: 60_000 }],
          transfer_ids: [],
        },
      ],
    }),
  );
  check("$600 flags File NEC", report.cleaners[0]?.meetsNecThreshold, true);
  check("one cleaner meets threshold", report.totals.meetsNecThreshold, 1);
}

{
  const prior = aggregate1099(
    base({
      taxYear: 2025,
      manualPayouts: [
        {
          cleaner_id: "cat",
          booking_id: "y26",
          amount_cents: 5000,
          status: "paid",
          paid_at: "2026-03-01T00:00:00.000Z",
          created_at: "2026-03-01T00:00:00.000Z",
          cleaner_breakdown: [],
          transfer_ids: [],
        },
      ],
    }),
  );
  check("other tax years stay empty", prior.totals.reportableCents, 0);
}

{
  const report = aggregate1099(
    base({
      payrollRuns: [
        {
          cleaner_id: "issac",
          net_cents: 10000,
          sent_amount_cents: 10000,
          clawed_back_cents: 2500,
          reimbursement_cents: 1500,
          status: "sent",
          sent_at: "2026-05-01T00:00:00.000Z",
          executed_at: "2026-05-01T00:00:00.000Z",
          created_at: "2026-05-01T00:00:00.000Z",
          stripe_transfer_id: "tr_run",
        },
      ],
    }),
  );
  const issac = report.cleaners.find((c) => c.cleanerId === "issac");
  check("payroll run peels clawback + reimbursement", issac?.sources.payroll_runs, 6000);
  check("run reimbursement tracked separately", issac?.reimbursementCents, 1500);
  check("run with transfer id is Stripe-tracked", issac?.stripeTrackedCents, 6000);
}

{
  const csv = reportToCsv(
    aggregate1099(
      base({
        tips: [
          {
            cleaner_id: "cat",
            amount_cents: 100,
            status: "received",
            paid_out_at: null,
            created_at: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
    ),
  );
  const header = csv.split("\n")[0];
  check(
    "CSV has tax_year and reportable columns",
    header?.includes("tax_year") && header?.includes("reportable_cents") && header?.includes("meets_nec_threshold"),
    true,
  );
  check("CSV has a Cat row", csv.includes("cat@novara.test"), true);
}

console.log("\nRoute module:");

async function asyncChecks(): Promise<void> {
  const route = await import("../src/app/api/payroll/1099/route");
  check("exports GET", typeof route.GET, "function");
  check("exports POST", typeof route.POST, "function");
  const unauth = await route.GET(new Request("http://localhost/api/payroll/1099"));
  check("unauthenticated GET is 401", unauth.status, 401);
  const body = await unauth.json();
  check("unauthenticated message", body.error, "Not signed in.");

  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key) {
    console.log("\nLive database:");
    const { createClient } = await import("@supabase/supabase-js");
    const { build1099Report } = await import("../src/lib/payroll-1099");
    const supabase = createClient(url, key, { auth: { persistSession: false } });
    const report = await build1099Report(supabase, 2026);
    check("live 2026 report builds", report.taxYear, 2026);
    check("live reportable is positive", report.totals.reportableCents > 0, true);
    check("Connect $77 is present", report.totals.bySource.connect_payouts, 7700);
    check("tips include received $40", report.totals.bySource.tips, 4000);
    check(
      "manual rail excludes the duplicated $77 Connect job",
      report.totals.bySource.manual_payouts,
      267554 - 7700,
    );
    check("paid extra $50 is counted (surge+OT, no reimb)", report.totals.bySource.extra_pay, 5000);
    check("two cleaners currently meet the $600 NEC threshold", report.totals.meetsNecThreshold, 2);
    console.log(
      `  → ${report.totals.cleanersPaid} cleaners, ${report.totals.meetsNecThreshold} at/over $600, reportable $${(report.totals.reportableCents / 100).toFixed(2)}`,
    );
  } else {
    console.log("\nLive database: skipped (no SUPABASE_SERVICE_ROLE_KEY)");
  }
}

void asyncChecks()
  .catch((err) => {
    failures++;
    console.error("  ✗ async checks threw", err);
  })
  .then(() => {
    if (failures) {
      console.error(`\n${failures} check(s) failed`);
      process.exit(1);
    }
    console.log("\nAll 1099 checks passed.");
  });
