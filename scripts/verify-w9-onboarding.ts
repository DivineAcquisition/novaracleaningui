// Onboarding W-9: full state names become real postal codes, and the
// certify control is a sibling of its label so a phone tap stays checked.
import { readFileSync } from "node:fs";

import { formatState } from "../src/lib/address-formatter.ts";
import { validateRecipient } from "../src/lib/nec-1099.ts";
import { postalStateCode } from "../src/lib/us-states.ts";
import { w9FieldErrors } from "../src/lib/w9-onboarding.ts";

let failed = 0;
function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed++;
    console.error("FAIL:", msg);
  } else {
    console.log("ok  ", msg);
  }
}

assert(postalStateCode("Maryland") === "MD", "Maryland maps to MD");
assert(postalStateCode("Virginia") === "VA", "Virginia maps to VA");
assert(postalStateCode("District of Columbia") === "DC", "District of Columbia maps to DC");
assert(postalStateCode("Washington, D.C.") === "DC", "Washington, D.C. maps to DC");
assert(postalStateCode("D.C.") === "DC", "D.C. maps to DC");
assert(postalStateCode("dc") === "DC", "dc maps to DC");
assert(postalStateCode("MD") === "MD", "MD stays MD");
assert(postalStateCode("North Carolina") === "NC", "North Carolina maps to NC");
assert(postalStateCode("Maryland") !== "MA", "Maryland is not shortened to MA");
assert(postalStateCode("Not a state") === "", "an unknown name is left blank");
assert(formatState("Maryland") === "MD", "address formatting uses the postal code");
assert(formatState("VA") === "VA", "a 2-letter code still formats");

const missing = w9FieldErrors({
  legalName: "",
  tinType: "ssn",
  tin: "123",
  street: "",
  city: "Rockville",
  state: "Maryland",
  zip: "abc",
});
assert(missing.some((line) => line.includes("name on your tax return")), "missing name is named");
assert(missing.some((line) => line.includes("9-digit")), "a short TIN is named");
assert(missing.some((line) => line.includes("street")), "a missing street is named");
assert(!missing.some((line) => line.toLowerCase().includes("state")), "Maryland is a valid state");
assert(missing.some((line) => line.includes("ZIP")), "a bad ZIP is named");
assert(!missing.some((line) => line.includes("retyped")), "contractors do not see the admin 1099 sentence");

const blankState = w9FieldErrors({
  legalName: "Ada Lovelace",
  tinType: "ssn",
  tin: "123-45-6789",
  street: "1 Main St",
  city: "Rockville",
  state: "",
  zip: "20814",
});
assert(
  blankState.length === 1 && blankState[0].includes("2-letter state"),
  "a blank state asks for a 2-letter code",
);

const ready = validateRecipient({
  name: "Ada Lovelace",
  tinType: "ssn",
  tin: "123456789",
  street: "1 Main St",
  city: "Rockville",
  state: postalStateCode("Maryland"),
  zip: "20814",
});
assert(ready.ok === true && ready.ok && ready.recipient.state === "MD", "a mapped Maryland address validates");

const form = readFileSync("src/components/cleaner/W9OnboardingForm.tsx", "utf8");
const guides = readFileSync("src/components/cleaner/JobDayGuides.tsx", "utf8");
const agreement = readFileSync("src/components/cleaner/PortalAgreementForm.tsx", "utf8");
assert(!form.includes("blockerMessage"), "the W-9 form does not use the admin blocker copy");
assert(!/<label[^>]*>\s*<Checkbox/.test(form), "the W-9 certify box is not nested in a label");
assert(form.includes('htmlFor="w9-certify"') && form.includes('id="w9-certify"'), "the W-9 certify box has its own label");
assert(form.includes('type="button"'), "Submit W-9 is a button");
assert(!/<label[^>]*>\s*<Checkbox/.test(guides), "the dress-code box is not nested in a label");
assert(guides.includes("guide-agree-"), "the dress-code box has its own label");
assert(!/<label[^>]*>\s*<Checkbox/.test(agreement), "the agreement box is not nested in a label");
assert(agreement.includes('htmlFor="portal-agreement-agree"'), "the agreement box has its own label");
assert(form.includes("postalStateCode(stateDefault)"), "a stored state name is converted before the field renders");
assert(form.includes("{entry.value} — {entry.label}"), "the state menu shows the postal code and the name");

if (failed) {
  console.error(`\n${failed} check(s) failed`);
  process.exit(1);
}
console.log("\nW-9 onboarding checks passed");
