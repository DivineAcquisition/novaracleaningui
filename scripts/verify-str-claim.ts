// Offline verification of the STR Claim-to-Account flow.
//
//   • every rate traces to the Part Two reference bands (base + linen + restock)
//   • the individual-vs-entity question at Claim is mandatory
//   • entity ⇒ Personal Guarantee block; individual ⇒ absent (both directions)
//   • Page 3 offers Pay in Full + Split for a new self-serve Host, Pay After
//     withheld unless explicitly enabled, and nothing pre-selected
//   • a 5+ BR property, or an unusually large property count, routes to
//     Book a Call instead of Claim This Rate
//   • the claimed submission is what Page 2 pre-fills from
//
//   Run:  npm run str-claim:verify

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  MAX_SELF_SERVE_PROPERTIES,
  RATE_BANDS,
  bandForBedrooms,
  introDisclosure,
  quoteProperty,
} from "../src/lib/host-onboarding/rate-bands";
import {
  ENTITY_CHOICES,
  claimContactError,
  estimateStr,
  parseClaimContact,
  parseStrProperties,
  requiresPersonalGuarantee,
} from "../src/lib/str-landing/landing";
import { PAYMENT_OPTIONS } from "../src/lib/host-onboarding/agreement";

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
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

// ─── 1. Rates trace to the Part Two bands ──────────────────────────────────
console.log("\nPart Two reference bands");

const band2 = RATE_BANDS.find((b) => b.key === "2br")!;
check("2 BR maps to the 2 BR band", bandForBedrooms(2)?.key, "2br");
check("0 BR (studio) maps to the studio/1BR band", bandForBedrooms(0)?.key, "studio_1br");
check("1 BR maps to the studio/1BR band", bandForBedrooms(1)?.key, "studio_1br");
check("7 BR maps to the open-ended 5+ band", bandForBedrooms(7)?.key, "5plus");

const plain = quoteProperty({ bedrooms: 2, bathrooms: 2 });
check("2 BR, no extras = band base", plain.standardRate, band2.baseRate);

const withBoth = quoteProperty({ bedrooms: 2, bathrooms: 2, linen: true, restock: true });
check(
  "2 BR + linen + restock = base + linen + restock",
  withBoth.standardRate,
  (band2.baseRate || 0) + band2.linenAdd + band2.restockAdd,
);

const linenOnly = quoteProperty({ bedrooms: 3, bathrooms: 2, linen: true });
const band3 = RATE_BANDS.find((b) => b.key === "3br")!;
check("3 BR + linen only excludes the restock add", linenOnly.standardRate, (band3.baseRate || 0) + band3.linenAdd);
check("restock add is not silently applied", linenOnly.restockAdd, 0);

// No band may be priced anywhere but this table.
for (const b of RATE_BANDS) {
  if (b.baseRate == null) continue;
  const q = quoteProperty({ bedrooms: b.minBedrooms, bathrooms: 1, linen: true, restock: true });
  check(
    `${b.label} quote = its own band arithmetic`,
    q.standardRate,
    b.baseRate + b.linenAdd + b.restockAdd,
  );
}

check("no introductory rate is running by default", introDisclosure(), null);
check(
  "an introductory rate discloses that the standard rate resumes",
  /standard rate shown applies automatically after/.test(
    introDisclosure({ percentOff: 20, periodLabel: "your first 3 turnovers" }) || "",
  ),
  true,
);

// ─── 2. Typical vs unusual split ───────────────────────────────────────────
console.log("\nTypical vs unusual (Claim vs Book a Call)");

const typical = estimateStr(
  parseStrProperties([{ address: "1 Main St", bedrooms: 2, bathrooms: 2, linen: true }]),
);
check("a typical 2 BR claims", typical.cta, "claim");
check("a typical 2 BR is ok", typical.ok, true);

const fivePlus = estimateStr(parseStrProperties([{ address: "1 Main St", bedrooms: 5, bathrooms: 3 }]));
check("a 5+ BR property books a call", fivePlus.cta, "book_call");
check("a 5+ BR property is not quotable", fivePlus.properties[0].quote.quotable, false);
check("a 5+ BR property has no rate", fivePlus.properties[0].quote.standardRate, null);
check("the 5+ reason is Part Two's own 'quote' designation", fivePlus.properties[0].quote.reason, "five_plus");

const mixed = estimateStr(
  parseStrProperties([
    { address: "1 Main St", bedrooms: 2, bathrooms: 2 },
    { address: "2 Main St", bedrooms: 6, bathrooms: 4 },
  ]),
);
check("one 5+ BR among typical properties still books a call", mixed.cta, "book_call");

const tooMany = estimateStr(
  parseStrProperties(
    Array.from({ length: MAX_SELF_SERVE_PROPERTIES + 1 }, (_, i) => ({
      address: `${i + 1} Main St`,
      bedrooms: 2,
      bathrooms: 2,
    })),
  ),
);
check("an unusually large property count books a call", tooMany.cta, "book_call");
check(
  "the too-many reason is reported",
  tooMany.reasons.some((r) => r.reason === "too_many_properties"),
  true,
);

const atCap = estimateStr(
  parseStrProperties(
    Array.from({ length: MAX_SELF_SERVE_PROPERTIES }, (_, i) => ({
      address: `${i + 1} Main St`,
      bedrooms: 2,
      bathrooms: 2,
    })),
  ),
);
check("exactly at the cap still claims", atCap.cta, "claim");

// A half-typed entry is "not ready", never a Book a Call verdict.
const halfTyped = estimateStr(
  parseStrProperties([
    { address: "1 Main St", bedrooms: 2, bathrooms: 2 },
    { address: "2 Main St", bedrooms: null, bathrooms: null },
  ]),
);
check("a partially-typed property reads as incomplete, not book_call", halfTyped.cta, "incomplete");
check("an incomplete estimate is not claimable", halfTyped.ok, false);
check("an incomplete estimate shows no total", halfTyped.totalPerTurnover, null);

const halfTypedUnusual = estimateStr(
  parseStrProperties([
    { address: "1 Main St", bedrooms: 6, bathrooms: 3 },
    { address: "2 Main St", bedrooms: null, bathrooms: null },
  ]),
);
check("an unusual property still wins over an unfinished row", halfTypedUnusual.cta, "book_call");

const flagged = estimateStr(
  parseStrProperties([{ address: "1 Main St", bedrooms: 2, bathrooms: 2, flaggedNonStandard: true }]),
);
check("a host-flagged non-standard property books a call", flagged.cta, "book_call");

const manyBaths = estimateStr(parseStrProperties([{ address: "1 Main St", bedrooms: 2, bathrooms: 6 }]));
check("a property outside the standard bathroom range books a call", manyBaths.cta, "book_call");

const multi = estimateStr(
  parseStrProperties([
    { address: "1 Main St", bedrooms: 1, bathrooms: 1 },
    { address: "2 Main St", bedrooms: 3, bathrooms: 2 },
  ]),
);
check("a host may claim more than one property", multi.cta, "claim");
check("multi-property total sums the per-property rates", multi.totalPerTurnover,
  (multi.properties[0].quote.standardRate || 0) + (multi.properties[1].quote.standardRate || 0));

// ─── 3. The entity question is mandatory ───────────────────────────────────
console.log("\nIndividual vs entity at Claim");

const base = { fullName: "Jordan Hale", email: "jordan@example.com", phone: "4105550123" };

check(
  "omitting the entity question is rejected",
  claimContactError(parseClaimContact({ ...base })),
  "Select whether you're signing as an individual or a business entity — this determines what you're asked to sign.",
);
check(
  "an unrecognized entity value is rejected",
  claimContactError(parseClaimContact({ ...base, entityType: "maybe" })) !== null,
  true,
);
check(
  "individual is accepted",
  claimContactError(parseClaimContact({ ...base, entityType: "individual" })),
  null,
);
check(
  "entity without a legal name is rejected",
  claimContactError(parseClaimContact({ ...base, entityType: "entity" })),
  "Enter the business entity's legal name.",
);
check(
  "entity with a legal name is accepted",
  claimContactError(parseClaimContact({ ...base, entityType: "entity", entityName: "Hale LLC" })),
  null,
);
check("the page offers exactly the two choices", ENTITY_CHOICES.map((c) => c.value), ["individual", "entity"]);

// ─── 4. Personal Guarantee, both directions ────────────────────────────────
console.log("\nPersonal Guarantee branch");

check("entity ⇒ guarantee required", requiresPersonalGuarantee("entity"), true);
check("individual ⇒ guarantee absent", requiresPersonalGuarantee("individual"), false);
check("unknown ⇒ guarantee absent", requiresPersonalGuarantee(null), false);

const sessionSrc = read("src/lib/host-onboarding/session.ts");
check(
  "the session payload carries requiresPersonalGuarantee",
  /requiresPersonalGuarantee: requiresPersonalGuarantee\(entityType\)/.test(sessionSrc),
  true,
);

const viewSrc = read("src/views/partner/HostOnboardingSession.tsx");
check(
  "Page 1 renders the guarantee only when required",
  /\{needsGuarantee && \(/.test(viewSrc),
  true,
);
check(
  "the guarantee gates the sign button",
  /guaranteeReady &&/.test(viewSrc),
  true,
);

const opsSrc = read("src/lib/host-onboarding/operations.ts");
check(
  "the server refuses an entity signature without the guarantee",
  /A business entity Host must accept the Personal Guarantee to sign\./.test(opsSrc),
  true,
);
check(
  "the server refuses a guarantee from an individual signer",
  /A Personal Guarantee does not apply to an individual Host\./.test(opsSrc),
  true,
);
check(
  "entity type is resolved server-side, not from the request body",
  /export async function resolveEntityType/.test(opsSrc),
  true,
);
const routeSrc = read("src/app/api/partner/host-onboarding/[token]/route.ts");
check(
  "the sign route uses the server-resolved entity type",
  /const entityType = await resolveEntityType\(supabase, session\)/.test(routeSrc),
  true,
);
check(
  "the sign route no longer trusts body.entityType",
  /entityType: clip\(body\.entityType/.test(routeSrc),
  false,
);

// ─── 5. Payment page: three options, no default, Pay After withheld ────────
console.log("\nPage 3 payment options (§6.2)");

check("the Agreement defines exactly three options", Object.keys(PAYMENT_OPTIONS).sort(), [
  "full",
  "pay_after",
  "split",
]);

// The session payload filters pay_after unless the Host is enabled for it.
const offeredForNewHost = Object.values(PAYMENT_OPTIONS)
  .filter((o) => o.key !== "pay_after" || false)
  .map((o) => o.key);
check("a brand-new self-serve Host sees Pay in Full and Split only", offeredForNewHost, ["full", "split"]);

const offeredWithOverride = Object.values(PAYMENT_OPTIONS)
  .filter((o) => o.key !== "pay_after" || true)
  .map((o) => o.key);
check("an explicitly enabled Host also sees Pay After", offeredWithOverride, ["full", "split", "pay_after"]);

check(
  "Pay After states it is at Company discretion",
  /discretion/i.test(PAYMENT_OPTIONS.pay_after.body),
  true,
);
check(
  "no option is pre-selected on Page 3",
  /useState<PaymentOptionKey \| null>\(\s*\(data\.session\.paymentOption as PaymentOptionKey\) \|\| null,/.test(viewSrc),
  true,
);
check(
  "the page no longer falls back to the first option",
  /data\.paymentOptions\[0\]\?\.key \|\| "full"/.test(viewSrc),
  false,
);
check(
  "continuing is blocked until an option is chosen",
  /disabled=\{busy \|\| !option\}/.test(viewSrc),
  true,
);

// ─── 6. Claim wiring: reuse, not a parallel system ─────────────────────────
console.log("\nClaim wiring");

const serverSrc = read("src/lib/str-landing/landing-server.ts");
check(
  "Claim mints the EXISTING tokenized host onboarding session",
  /startHostOnboardingSession\(supabase, \{/.test(serverSrc),
  true,
);
check(
  "Claim sends the same link by SMS and email",
  /sendHostOnboardingLink\(supabase, \{/.test(serverSrc),
  true,
);
check(
  "Claim writes the entity answer onto the submission",
  /entity_type: input\.entityType/.test(serverSrc),
  true,
);
check(
  "the claimed submission is the Page 2 pre-fill source",
  /pre-fills from on the\s+\/\/ self-serve path/.test(serverSrc),
  true,
);
check(
  "properties are written at their band rate",
  /turnover_price: rate/.test(serverSrc),
  true,
);
check(
  "Book a Call never mints an onboarding session",
  /startHostOnboardingSession/.test(serverSrc.split("export async function bookStrCall")[1] || ""),
  false,
);

const landingSrc = read("src/lib/str-landing/landing.ts");
check(
  "the landing imports rates from the Part Two module, not its own table",
  /from "@\/lib\/host-onboarding\/rate-bands"/.test(landingSrc),
  true,
);

const viewLanding = read("src/views/str/StrLanding.tsx");
check(
  "the landing page asks the server for every rate",
  /fetch\("\/api\/str\/estimate"/.test(viewLanding),
  true,
);

// ─── 7. Portal: no cleaner contact information ─────────────────────────────
console.log("\nHost portal standing rule");

const hostPortal = read("src/lib/partner-portal/host.ts");
check(
  "the host portal selects no cleaner phone or email",
  /cleaner_phone|cleaner_email|crew_phone/.test(hostPortal),
  false,
);

// ─── Result ────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log("\nAll STR claim-to-account checks passed.\n");
