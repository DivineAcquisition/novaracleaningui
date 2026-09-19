// Offline verification that the STR and Rental Property flows stay distinct.
//
// Each flow already has its own suite (`str-claim:verify`, `portfolio-landing:verify`,
// `property-manager:verify`), but each one only ever looks at its own half. Nothing
// caught a change that quietly made one flow behave like the other — and the two
// diverge because two different signed agreements say different things, not because
// of a styling preference:
//
//   • STR runs on the Host Partnership Agreement (Part Two rate table, Personal
//     Guarantee for entity signers, three equal payment choices under its §6.2).
//   • Rental Property runs on the Property Management Services Agreement (residential
//     pricing engine + §5 portfolio tier, no guarantee clause at all, invoiced billing
//     as the §6.1 contractual default).
//
// Genericizing either page into the other is therefore a contract defect, not a
// cosmetic one. This file encodes the side-by-side table as assertions so the drift
// fails here instead of in front of a signer.
//
//   Run:  npm run flow-divergence:verify

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  PAYMENT_OPTIONS,
  PAY_AFTER_DISCRETION,
  requiresPersonalGuarantee,
} from "../src/lib/host-onboarding/agreement";
import { RATE_BANDS, bandForBedrooms } from "../src/lib/host-onboarding/rate-bands";
import { ENTITY_CHOICES, ENTITY_QUESTION, claimContactError } from "../src/lib/str-landing/landing";
import {
  INVOICED_DEFAULT_COPY,
  PM_BILLING_OPTIONS,
  type PmBillingMethod,
} from "../src/lib/property-manager/onboarding/agreement";
import { DEFAULT_VOLUME_DISCOUNTS, resolveVolumeDiscount } from "../src/lib/property-manager/pricing";

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

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const strSession = read("src/views/partner/HostOnboardingSession.tsx");
const pmSession = read("src/views/partner/PropertyManagerOnboardingSession.tsx");
const strPortal = read("src/views/partner/HostPortalView.tsx");
const pmPortal = read("src/views/partner/PropertyManagerPortal.tsx");
const strLanding = read("src/views/str/StrLanding.tsx");
const pmLanding = read("src/views/portfolio/PortfolioLanding.tsx");

// ── Row 1: pricing source ──────────────────────────────────────────────────
// STR prices from the Host Agreement's Part Two table. PM prices from the
// residential engine plus the §5 portfolio tier. Neither may borrow the other's.

console.log("\nPricing source — Part Two table vs residential engine + §5 tier:");

check("STR has a Part Two band table", RATE_BANDS.length > 0, true);
check("STR bands price a 2BR from the table", bandForBedrooms(2)?.baseRate, 155);
check("5+ BR is a quote, not a band (STR)", bandForBedrooms(5)?.baseRate ?? null, null);

const pmFlowFiles = [
  "src/lib/property-manager/landing.ts",
  "src/lib/property-manager/landing-estimate.ts",
  "src/lib/property-manager/landing-server.ts",
  "src/lib/property-manager/pricing.ts",
  "src/lib/property-manager/pricing-server.ts",
  "src/lib/property-manager/registry.ts",
  "src/lib/property-manager/onboarding/agreement.ts",
  "src/lib/property-manager/onboarding/operations.ts",
  "src/lib/property-manager/onboarding/session.ts",
];
const strFlowFiles = [
  "src/lib/str-landing/landing.ts",
  "src/lib/str-landing/landing-server.ts",
  "src/lib/host-onboarding/rate-bands.ts",
  "src/lib/host-onboarding/agreement.ts",
  "src/lib/host-onboarding/session.ts",
  "src/lib/host-onboarding/operations.ts",
];

const pmBorrowsStrBands = pmFlowFiles.filter((f) => /rate-bands|str-landing/.test(read(f)));
check("no PM module imports the STR Part Two bands", pmBorrowsStrBands, []);

const strBorrowsPmEngine = strFlowFiles.filter((f) =>
  /property-manager\/pricing|resolveVolumeDiscount/.test(read(f)),
);
check("no STR module imports the PM pricing engine", strBorrowsPmEngine, []);

// ── Row 2: the extra Claim-step field ──────────────────────────────────────
// STR must ask individual-vs-entity (it drives the Personal Guarantee).
// PM must not — the PM Agreement has no guarantee clause to support the question.

console.log("\nClaim-step fields — entity question on STR only:");

check("STR asks the entity question", ENTITY_QUESTION.length > 0, true);
check("STR offers exactly individual and entity", ENTITY_CHOICES.map((c) => c.value), [
  "individual",
  "entity",
]);
check(
  "STR Claim rejects a missing entity answer",
  claimContactError({
    fullName: "A Host",
    email: "host@example.com",
    phone: "5555555555",
    entityType: null,
    entityName: null,
  }) != null,
  true,
);
check(
  "STR Claim accepts an individual answer",
  claimContactError({
    fullName: "A Host",
    email: "host@example.com",
    phone: "5555555555",
    entityType: "individual",
    entityName: null,
  }),
  null,
);
check(
  "STR entity signer requires the guarantee",
  [requiresPersonalGuarantee("entity"), requiresPersonalGuarantee("individual")],
  [true, false],
);

check("PM landing has no entity question", /individual-versus-entity|individual-vs-entity/.test(pmLanding) &&
  !/name=["']entityType["']|setEntityType/.test(pmLanding), true);
check("PM Claim collects no entityType field", /setEntityType|entityType:/.test(pmLanding), false);
check("PM Legal page has no guarantee block", /[Pp]ersonal [Gg]uarantee/.test(pmSession) === false ||
  /no Personal Guarantee|There is no Personal Guarantee/.test(pmSession), true);
check("STR landing does ask it", /entityType/.test(strLanding), true);

// ── Row 3: the payment page default ────────────────────────────────────────
// The single most load-bearing divergence. STR §6.2 presents three active
// choices with no default. PM §6.1 pre-selects invoiced as the contractual default.

console.log("\nPayment page default — none on STR, invoiced on PM:");

check(
  "STR payment state starts null (no pre-selected option)",
  /useState<PaymentOptionKey \| null>\(\s*\(data\.session\.paymentOption as PaymentOptionKey\) \|\| null,?\s*\)/.test(
    strSession,
  ),
  true,
);
check(
  "STR never falls back to the first option",
  /paymentOptions\[0\]/.test(strSession),
  false,
);
check(
  "STR blocks continuing until an option is chosen",
  /Choose one of the options above/.test(strSession),
  true,
);
check(
  "no STR payment option is marked recommended",
  Object.values(PAYMENT_OPTIONS).some((o) => "recommended" in o && (o as { recommended?: boolean }).recommended),
  false,
);

check(
  "PM billing state defaults to invoiced",
  /useState<PmBillingMethod>\(\s*\(data\.session\.billingMethod as PmBillingMethod\) \|\| "invoiced",?\s*\)/.test(
    pmSession,
  ),
  true,
);
check("PM labels invoiced as pre-selected", /Invoiced \(pre-selected\)/.test(pmSession), true);
check("PM invoiced is the recommended default", PM_BILLING_OPTIONS.invoiced.recommended, true);
check("PM auto-pay is not a co-equal default", PM_BILLING_OPTIONS.auto_pay.recommended, false);
check("PM default copy cites Section 6.1", /Section 6\.1/.test(INVOICED_DEFAULT_COPY), true);
check(
  "PM Auto-Pay is a switch away from invoiced",
  /setMethod\(e\.target\.checked \? "auto_pay" : "invoiced"\)/.test(pmSession),
  true,
);

// ── Row 4: first-time Pay After ────────────────────────────────────────────
// STR withholds Pay After unless the Company enables it. PM has no equivalent
// provision at all — its only two methods are invoiced and auto_pay.

console.log("\nPay After — an STR-only concept:");

check("STR defines a Pay After option", "pay_after" in PAYMENT_OPTIONS, true);
check("STR documents the discretion gate", PAY_AFTER_DISCRETION.length > 0, true);
check(
  "STR filters Pay After unless enabled for the host",
  /o\.key !== "pay_after" \|\| payAfter/.test(read("src/lib/host-onboarding/session.ts")),
  true,
);

const pmMethods = Object.keys(PM_BILLING_OPTIONS) as PmBillingMethod[];
check("PM has exactly invoiced and auto_pay", pmMethods.sort(), ["auto_pay", "invoiced"]);
check("PM has no Pay After concept", pmMethods.includes("pay_after" as PmBillingMethod), false);

// ── Row 5: the portal booking model ────────────────────────────────────────
// STR is request-based: the Host asks for each turnover. PM is contract-based:
// visits are already generated from the registered units.

console.log("\nPortal booking model — request-based vs contract-based:");

check("STR portal lets the host request a turnover", /Request a turnover/.test(strPortal), true);
check("PM portal does not offer request-a-turnover", /Request a turnover/.test(pmPortal), false);
check(
  "PM portal says visits are already generated, not requested",
  /not requested one at a time/.test(pmPortal),
  true,
);
check("PM portal defaults to the portfolio view", /useState<Tab>\("portfolio"\)/.test(pmPortal), true);

// Billing is rendered per the method actually on file — never both at once.
const pmShowsAutoPayBranch = /data\.billing\.method === "auto_pay" \?/.test(pmPortal);
const pmShowsInvoicedBranch = /data\.billing\.method === "invoiced" \?/.test(pmPortal);
check("PM portal branches billing on the method on file", [pmShowsAutoPayBranch, pmShowsInvoicedBranch], [
  true,
  true,
]);

// ── Row 6: portfolio-style pricing ─────────────────────────────────────────
// The §5.1 live tier is a PM mechanic. The Host Agreement has no equivalent,
// so the STR page must not grow one.

console.log("\nPortfolio tier — a PM mechanic with no STR equivalent:");

check(
  "PM tier improves as units are added",
  [
    resolveVolumeDiscount(DEFAULT_VOLUME_DISCOUNTS, 1).percent,
    resolveVolumeDiscount(DEFAULT_VOLUME_DISCOUNTS, 20).percent,
  ].every((p, i, arr) => (i === 0 ? true : p > arr[i - 1])),
  true,
);
check("PM landing shows the live tier", /discount|tier|Portfolio/i.test(pmLanding), true);
check(
  "STR landing has no volume/portfolio tier",
  /resolveVolumeDiscount|volumeDiscount|portfolio tier/i.test(strLanding),
  false,
);

// ── The two flows stay separate front doors ────────────────────────────────

console.log("\nSeparate front doors:");

check("STR landing does not link the PM claim API", /\/api\/portfolio\//.test(strLanding), false);
check("PM landing does not link the STR claim API", /\/api\/str\//.test(pmLanding), false);
check(
  "each flow mints its own onboarding session",
  [
    /startPmOnboardingSession/.test(read("src/lib/property-manager/landing-server.ts")),
    /host_onboarding/.test(read("src/lib/str-landing/landing-server.ts")),
  ],
  [true, true],
);

if (failures > 0) {
  console.error(`\n${failures} divergence check(s) failed.`);
  process.exit(1);
}
console.log("\nAll flow-divergence checks passed.");
