// Offline verification of the public STR landing page.
//
//   • /str is public on try.novaracleaning.com — no login, no VSL gate
//   • the estimate uses Host Partnership Agreement Part Two, not a side table
//   • typical vs unusual: listing count, 5+ BR, unusual baths, flagged
//   • Claim mints the existing host onboarding session with properties priced
//   • unusual listings book a call instead of auto-onboarding
//   • the estimate is labeled non-final; payment stays last; confirmation
//     is a distinct page with Go to My Account
//
//   Run:  npm run str-landing:verify

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { computeTurnoverQuote, HOST_RATE_BANDS, HOST_QUOTE_LOCK_HOURS } from "../src/lib/host-onboarding/rates";
import {
  COMPANY_SETS_RATES,
  ESTIMATE_DISCLAIMER,
  MAX_TYPICAL_LISTINGS,
  STR_CAL_LINK,
  STR_PATH,
  expandStrListings,
  estimateStrLanding,
  formatListingRange,
  parseClaimEntity,
  strCtaFor,
} from "../src/lib/host-landing/landing";
import { deriveHostOnboardingProgress } from "../src/lib/host-onboarding/progress";
import {
  PAYMENT_OPTIONS,
  PERSONAL_GUARANTEE,
  requiresPersonalGuarantee,
  validateHostSignature,
} from "../src/lib/host-onboarding/agreement";

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

console.log("Host rate table (Agreement Part Two):");
check("four auto-price bands exist", HOST_RATE_BANDS.length, 4);
check("studio/1BR base is 110–150", [HOST_RATE_BANDS[0].baseMin, HOST_RATE_BANDS[0].baseMax], [110, 150]);
check("2BR base is 150–200", [HOST_RATE_BANDS[1].baseMin, HOST_RATE_BANDS[1].baseMax], [150, 200]);
check("3BR base is 200–260", [HOST_RATE_BANDS[2].baseMin, HOST_RATE_BANDS[2].baseMax], [200, 260]);
check("4BR base is 225–280", [HOST_RATE_BANDS[3].baseMin, HOST_RATE_BANDS[3].baseMax], [225, 280]);
check("quote lock is the standard 48-hour window", HOST_QUOTE_LOCK_HOURS, 48);

const twoBed = computeTurnoverQuote({ bedrooms: 2, linen: false, restock: false });
check("2BR no extras is 150–200", [twoBed.min, twoBed.max], [150, 200]);
check("2BR claimed midpoint is 175", twoBed.claimed, 175);

const twoBedFull = computeTurnoverQuote({ bedrooms: 2, linen: true, restock: true });
check("2BR + linen + restock is 205–280", [twoBedFull.min, twoBedFull.max], [205, 280]);
check("2BR + extras claimed is the midpoint 243", twoBedFull.claimed, Math.round((205 + 280) / 2));

const fiveBed = computeTurnoverQuote({ bedrooms: 5, linen: false, restock: false });
check("5BR is not auto-priced", fiveBed.ok, false);
check("5BR needs a quote", fiveBed.needsQuote, true);

console.log("\nTypical vs unusual CTA:");
const typical1 = expandStrListings({
  mode: "uniform",
  listingCount: 1,
  average: { bedrooms: 2, bathrooms: 1, linen: false, restock: false },
});
check("one 2BR expands to 1 row", typical1.length, 1);
check("one standard 2BR is Claim", strCtaFor(typical1).cta, "claim");
check(
  "4 similar listings are still typical",
  strCtaFor(
    expandStrListings({
      mode: "uniform",
      listingCount: MAX_TYPICAL_LISTINGS,
      average: { bedrooms: 2, bathrooms: 1, linen: true, restock: false },
    }),
  ).cta,
  "claim",
);
check(
  "5 listings are unusual — Book a Call",
  strCtaFor(
    expandStrListings({
      mode: "uniform",
      listingCount: 5,
      average: { bedrooms: 2, bathrooms: 1, linen: false, restock: false },
    }),
  ).cta,
  "book_call",
);
check(
  "5+ bedrooms is unusual — Book a Call",
  strCtaFor([{ label: "Estate", bedrooms: 5, bathrooms: 4, linen: false, restock: false }]).cta,
  "book_call",
);
check(
  "unusual bathroom count is Book a Call",
  strCtaFor([{ label: "Odd", bedrooms: 2, bathrooms: 6, linen: false, restock: false }]).cta,
  "book_call",
);
check(
  "flagged atypical is unusual even when sizes are ordinary",
  strCtaFor(typical1, { flaggedAtypical: true }).cta,
  "book_call",
);
check(
  "missing bedroom count is unusual",
  strCtaFor([{ label: "Unknown", bedrooms: null, bathrooms: 1, linen: false, restock: false }]).cta,
  "book_call",
);

console.log("\nEstimate uses computeTurnoverQuote, not a side table:");
const estimated = estimateStrLanding({
  mode: "uniform",
  listingCount: 1,
  average: { bedrooms: 2, bathrooms: 1, linen: true, restock: true },
});
check("1 × 2BR linen+restock is Claim", estimated.cta, "claim");
check("estimate is labeled an estimate", estimated.estimate, true);
check("disclaimer says it is not a final rate", estimated.disclaimer.includes("not a final per-turnover rate"), true);
check("claimed matches the rate table midpoint", estimated.claimed, twoBedFull.claimed);
check("min matches the rate table", estimated.min, twoBedFull.min);
check("max matches the rate table", estimated.max, twoBedFull.max);
check("lock hours travel with the estimate", estimated.lockHours, HOST_QUOTE_LOCK_HOURS);

const twoListings = estimateStrLanding({
  mode: "uniform",
  listingCount: 2,
  average: { bedrooms: 2, bathrooms: 1, linen: false, restock: false },
});
check("two identical 2BRs sum the claimed rates", twoListings.claimed, twoBed.claimed * 2);
check("range formatting uses an en-dash", formatListingRange(estimated).includes("–"), true);

const unusualEst = estimateStrLanding({
  mode: "uniform",
  listingCount: 1,
  average: { bedrooms: 5, bathrooms: 4, linen: false, restock: false },
});
check("5BR estimate routes to Book a Call", unusualEst.cta, "book_call");
check("5BR estimate is not claimable", unusualEst.ok, false);

const withAddress = expandStrListings({
  mode: "mixed",
  listings: [
    { label: "Harbor", address: "1200 Light Street, Baltimore, MD", bedrooms: 2, bathrooms: 1, linen: false, restock: false },
    { label: "Fells", address: "812 S Broadway, Baltimore, MD", bedrooms: 1, bathrooms: 1, linen: true, restock: false },
  ],
});
check("a host may enter more than one property", withAddress.length, 2);
check("each listing keeps its address", withAddress.map((l) => l.address), [
  "1200 Light Street, Baltimore, MD",
  "812 S Broadway, Baltimore, MD",
]);

console.log("\nClaim entity vs individual (Agreement §6.10):");
check("individual is accepted", parseClaimEntity({ entityType: "individual" }).ok, true);
check(
  "entity without a name is rejected",
  parseClaimEntity({ entityType: "entity" }).ok,
  false,
);
check(
  "entity with a name is accepted",
  parseClaimEntity({ entityType: "entity", entityName: "Harbor Stays LLC" }),
  { ok: true, entityType: "entity", entityName: "Harbor Stays LLC" },
);
check("the question cannot be skipped", parseClaimEntity({}).ok, false);
check("business entity requires the personal guarantee", requiresPersonalGuarantee("entity"), true);
check("individual does not require the personal guarantee", requiresPersonalGuarantee("individual"), false);

console.log("\nOnboarding order (payment last, then confirmation):");
const unsigned = deriveHostOnboardingProgress({
  signed: false,
  snapshotPropertyIds: ["p1"],
  decisions: [{ propertyId: "p1", decision: "confirmed" }],
  paymentOption: "full",
  paymentMethodOnFile: true,
  portalReady: true,
});
check("unsigned stays on legal even if later facts exist", unsigned.current_step, "legal");
const signedOnly = deriveHostOnboardingProgress({
  signed: true,
  snapshotPropertyIds: ["p1"],
  decisions: [],
  paymentOption: null,
  paymentMethodOnFile: false,
  portalReady: false,
});
check("signed with no rate decision is on Property & Rate Schedule", signedOnly.current_step, "rates");
const afterRates = deriveHostOnboardingProgress({
  signed: true,
  snapshotPropertyIds: ["p1"],
  decisions: [{ propertyId: "p1", decision: "confirmed" }],
  paymentOption: null,
  paymentMethodOnFile: false,
  portalReady: false,
});
check("rates confirmed before payment", afterRates.current_step, "payment");
const done = deriveHostOnboardingProgress({
  signed: true,
  snapshotPropertyIds: ["p1"],
  decisions: [{ propertyId: "p1", decision: "confirmed" }],
  paymentOption: "full",
  paymentMethodOnFile: true,
  portalReady: true,
});
check("payment + portal is the confirmation (done) step", done.current_step, "done");

console.log("\nCopy and wiring:");
const files: Record<string, string> = {
  middleware: readFileSync(join(ROOT, "src/middleware.ts"), "utf8"),
  page: readFileSync(join(ROOT, "src/app/str/page.tsx"), "utf8"),
  view: readFileSync(join(ROOT, "src/views/str/StrLanding.tsx"), "utf8"),
  vsl: readFileSync(join(ROOT, "src/components/str/StrVsl.tsx"), "utf8"),
  cal: readFileSync(join(ROOT, "src/components/str/StrCalEmbed.tsx"), "utf8"),
  estimateApi: readFileSync(join(ROOT, "src/app/api/str/estimate/route.ts"), "utf8"),
  claimApi: readFileSync(join(ROOT, "src/app/api/str/claim/route.ts"), "utf8"),
  callApi: readFileSync(join(ROOT, "src/app/api/str/call/route.ts"), "utf8"),
  landingServer: readFileSync(join(ROOT, "src/lib/host-landing/landing-server.ts"), "utf8"),
  landing: readFileSync(join(ROOT, "src/lib/host-landing/landing.ts"), "utf8"),
  rates: readFileSync(join(ROOT, "src/lib/host-onboarding/rates.ts"), "utf8"),
  sessionView: readFileSync(join(ROOT, "src/views/partner/HostOnboardingSession.tsx"), "utf8"),
  sessionRoute: readFileSync(join(ROOT, "src/app/api/partner/host-onboarding/[token]/route.ts"), "utf8"),
  progress: readFileSync(join(ROOT, "src/lib/host-onboarding/progress.ts"), "utf8"),
  portfolioView: readFileSync(join(ROOT, "src/views/portfolio/PortfolioLanding.tsx"), "utf8"),
  agreement: readFileSync(join(ROOT, "src/lib/host-onboarding/agreement.ts"), "utf8"),
  preview: readFileSync(join(ROOT, "src/lib/host-onboarding/preview.ts"), "utf8"),
  hostPortal: readFileSync(join(ROOT, "src/views/partner/HostPortalView.tsx"), "utf8"),
};

check("middleware owns /str on try.*", files.middleware.includes('["/str", "try"]'), true);
check("the page is public (no requireAdmin / no login gate)", !/requireAdmin|useAuth|Sign In required/.test(files.page + files.view), true);
check("VSL plays with no email gate", files.vsl.includes("no email gate") && files.vsl.includes("Playing immediately"), true);
check("estimate API uses estimateLandingStr", files.estimateApi.includes("estimateLandingStr"), true);
check("Claim calls startHostOnboardingSession", files.landingServer.includes("startHostOnboardingSession"), true);
check("Claim prices properties from the claimed midpoint", files.landingServer.includes("turnover_price: listing.quote.claimed"), true);
check("Claim captures name, email, phone, and entity vs individual", files.view.includes("Are you signing as an individual or a business entity?"), true);
check("Claim does not skip the entity question", files.landingServer.includes("parseClaimEntity") && !files.landingServer.includes('entity_type: "individual"'), true);
check("landing collects a property address", files.view.includes("Property address") && files.landing.includes("address:"), true);
check("rates are presented as Company-set (Section 5.2)", files.view.includes("COMPANY_SETS_RATES") || files.view.includes("Section 5.2"), true);
check("§5.2 copy does not invite the visitor to set the price", COMPANY_SETS_RATES.includes("you do not set, negotiate, or edit the number"), true);
check("§5.3 intro disclosure exists next to any intro rate", files.landing.includes("INTRO_RATE_DISCLOSURE") && files.view.includes("INTRO_RATE_ACTIVE"), true);
check("calculator does not show an intro rate without the disclosure", !files.view.includes("introductory rate") || files.view.includes("INTRO_RATE_DISCLOSURE"), true);
check("unusual path does not mint onboarding", files.callApi.includes("bookCallStr") && !files.callApi.includes("startHostOnboardingSession"), true);
check("the page labels the number as an estimate", files.view.includes("not a final per-turnover rate"), true);
check("Claim This Rate is the typical CTA", files.view.includes("Claim This Rate"), true);
check("footer restates Claim and Book a Call", files.view.includes("Typical listing? Claim the rate") && files.view.includes("Book a Call"), true);
check("backup coverage is in the hero", files.view.includes("even when a cleaner can") && files.view.includes("Backup coverage"), true);
check("Cal embed uses the existing 15-minute event", files.cal.includes(STR_CAL_LINK), true);
check("value stack includes backup coverage", files.view.includes("backup") && readFileSync(join(ROOT, "src/lib/host-landing/landing.ts"), "utf8").includes("Backup coverage if a cleaner can't make it"), true);
check(
  "the public page does not import the admin client",
  !files.view.includes("landing-server") && !files.view.includes("getAdminSupabase") && !files.page.includes("getAdminSupabase"),
  true,
);
check("STR page does not use rental-property / portfolio framing", !/Individual Owner|Portfolio Manager|standing rate per unit/i.test(files.view + files.page + files.vsl), true);
check("portfolio page does not use STR Claim This Rate framing", !files.portfolioView.includes("Claim This Rate"), true);
check("confirmation button is Go to My Account", files.sessionView.includes("Go to My Account"), true);
check("confirmation is a distinct done card", files.sessionView.includes("function DoneCard") && files.progress.includes('"done"'), true);
check("payment is the last data-entry step", files.progress.includes("Payment Setup") && files.progress.includes("current_step"), true);
check("quote lock hours live in the rate table module", files.rates.includes("HOST_QUOTE_LOCK_HOURS = 48"), true);
check("claim path has no admin review gate", !files.landingServer.includes("routedForReview") && files.landingServer.includes('actorName: "str-landing"'), true);
check("path is /str", STR_PATH, "/str");
check("onboarding session auto-provisions portal after payment", files.sessionRoute.includes("provisionPortalAfterPayment"), true);
check("signature uses the submission entity type, not the client body", files.sessionRoute.includes('entityType = sub?.entity_type === "entity" ? "entity" : "individual"'), true);
check("entity hosts must acknowledge the personal guarantee", files.sessionRoute.includes("requiresPersonalGuarantee: needsGuarantee"), true);
check("Legal UI has a Personal Guarantee block", files.sessionView.includes("PERSONAL_GUARANTEE") && files.sessionView.includes("needsGuarantee"), true);
check("Page 2 names the claimed submission as the pre-fill source", files.sessionView.includes("claimed_submission") && files.sessionView.includes("from the rate you claimed"), true);
check("Page 3 does not pre-select a payment option", files.sessionView.includes("PaymentOptionKey | null") && files.sessionView.includes("Select a payment option first"), true);
check("first-time Claim hosts are inserted with Pay After off", files.landingServer.includes("pay_after_enabled: false"), true);
check("Pay After is filtered unless Company enabled it", files.preview.includes('o.key !== "pay_after" || payAfter'), true);
check("confirmation lists registered properties", files.sessionView.includes("properties.map") && files.sessionView.includes("Go to My Account"), true);
check("confirmation mentions the guarantee when it applied", files.sessionView.includes("Section 6.10 personal guarantee"), true);
check("agreement includes Section 6.10", files.agreement.includes("6.10 Personal Guarantee"), true);
check("three named payment options exist", Object.keys(PAYMENT_OPTIONS).sort(), ["full", "pay_after", "split"]);
check("personal guarantee copy cites 6.10 and 15", PERSONAL_GUARANTEE.title.includes("6.10") && PERSONAL_GUARANTEE.title.includes("15"), true);
check("host portal view has no cleaner contact", /cleaner|crew member/i.test(files.hostPortal), false);
check("host portal has request-a-turnover", files.hostPortal.includes("Request a turnover") || files.hostPortal.includes("request a turnover") || files.hostPortal.toLowerCase().includes("turnover"), true);

const unsignedGuarantee = validateHostSignature({
  signerName: "Jordan Hale",
  agreedToTerms: true,
  acknowledgedNonCircumvention: true,
  acknowledgedChargebacks: true,
  acknowledgedArbitration: true,
  signatureDataUrl: "data:image/png;base64,aaa",
  requiresPersonalGuarantee: true,
  acknowledgedPersonalGuarantee: false,
  guarantorName: "Jordan Hale",
});
check("entity signature without the guarantee is rejected", unsignedGuarantee != null, true);
check(
  "individual signature does not ask for the guarantee",
  validateHostSignature({
    signerName: "Jordan Hale",
    agreedToTerms: true,
    acknowledgedNonCircumvention: true,
    acknowledgedChargebacks: true,
    acknowledgedArbitration: true,
    signatureDataUrl: "data:image/png;base64,aaa",
    requiresPersonalGuarantee: false,
  }),
  null,
);
check(
  "entity signature with the guarantee is accepted",
  validateHostSignature({
    signerName: "Jordan Hale",
    agreedToTerms: true,
    acknowledgedNonCircumvention: true,
    acknowledgedChargebacks: true,
    acknowledgedArbitration: true,
    signatureDataUrl: "data:image/png;base64,aaa",
    requiresPersonalGuarantee: true,
    acknowledgedPersonalGuarantee: true,
    guarantorName: "Jordan Hale",
  }),
  null,
);

console.log(
  failures === 0
    ? "\nAll str-landing checks passed."
    : `\n${failures} check${failures === 1 ? "" : "s"} failed.`,
);
process.exit(failures === 0 ? 0 : 1);
