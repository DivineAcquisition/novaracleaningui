// Offline verification of the type-aware partner portal.
//
//   npm run partner-portal:verify

import { computeCancelFee, serviceInstantMs } from "../src/lib/partner-portal/cancel-fee";
import { kindsOf } from "../src/lib/partner-portal/identity";
import { publicStatusLabel, publicTurnoverStatus, stripCrewContact } from "../src/lib/partner-portal/sanitize";
import { DEFAULT_PORTAL_SETTINGS } from "../src/lib/partner-portal/settings";
import { previewKindFromToken, previewMe } from "../src/lib/partner-portal/preview";
import { requestMagicLink } from "../src/lib/partner-portal/magic-link";

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

const noon = (ymd: string) => new Date(`${ymd}T12:00:00`).getTime();

console.log("Section 9 cancellation tiers:");
const far = computeCancelFee({ requestedDate: "2026-09-10", windowStart: "11:00", priceCents: 20000, nowMs: noon("2026-09-01") });
check("48+ hours is credit-eligible", far.tier, "credit_eligible");
check("48+ hours fee is $0", far.feeCents, 0);
check("48+ hours credit is full rate", far.creditCents, 20000);

const mid = computeCancelFee({ requestedDate: "2026-09-03", windowStart: "11:00", priceCents: 20000, nowMs: noon("2026-09-01") });
check("24–48 hours is 50%", mid.tier, "fifty_percent");
check("24–48 hours fee is half", mid.feeCents, 10000);

const close = computeCancelFee({ requestedDate: "2026-09-02", windowStart: "18:00", priceCents: 20000, nowMs: noon("2026-09-02") });
check("under 24 hours is 100%", close.tier, "full");
check("under 24 hours fee is full rate", close.feeCents, 20000);

check("service instant uses window start", serviceInstantMs("2026-09-02", "18:30") > serviceInstantMs("2026-09-02", "11:00"), true);

console.log("\nSession defaults:");
check("default persistence is 30 days", DEFAULT_PORTAL_SETTINGS.sessionDays, 30);

console.log("\nMixed accounts stay distinct:");
check(
  "both kinds listed separately",
  kindsOf({
    hosts: [{ id: "h1" } as never],
    accounts: [{ id: "a1" } as never],
  }),
  ["host", "commercial"],
);
check("host-only", kindsOf({ hosts: [{ id: "h1" } as never], accounts: [] }), ["host"]);
check("commercial-only", kindsOf({ hosts: [], accounts: [{ id: "a1" } as never] }), ["commercial"]);

console.log("\nNo cleaner/crew contact in portal payloads:");
const scrubbed = stripCrewContact({
  status: "assigned",
  assigned_cleaner_id: "clr_1",
  cleaner_name: "Alex",
  cleaner_phone: "555-0100",
  price: 165,
  crew: [{ firstName: "Alex", phone: "555-0100" }],
});
check("cleaner id stripped", "assigned_cleaner_id" in scrubbed, false);
check("cleaner name stripped", "cleaner_name" in scrubbed, false);
check("cleaner phone stripped", "cleaner_phone" in scrubbed, false);
check("crew array stripped", "crew" in scrubbed, false);
check("price kept", scrubbed.price, 165);
check("cleaner_confirmed becomes confirmed", publicTurnoverStatus("cleaner_confirmed"), "confirmed");
check("unassigned_alert becomes assigning", publicTurnoverStatus("unassigned_alert"), "assigning");
check("status label has no cleaner word", publicStatusLabel("cleaner_confirmed").toLowerCase().includes("cleaner"), false);

console.log("\nLocalhost preview tokens:");
check("preview-host", previewKindFromToken("preview-host"), "host");
check("preview-mixed", previewKindFromToken("preview-mixed"), "mixed");
check("mixed preview lists both kinds", previewMe("mixed").kinds, ["host", "commercial"]);
check("host preview has no commercial account", previewMe("host").accounts.length, 0);

void requestMagicLink("not-an-email")
  .then((empty) => {
    console.log("\nMagic-link request never enumerates:");
    check("invalid email still returns ok", empty.ok, true);
    if (failures) {
      console.error(`\n${failures} check(s) failed.`);
      process.exit(1);
    }
    console.log("\nAll partner portal checks passed.");
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
