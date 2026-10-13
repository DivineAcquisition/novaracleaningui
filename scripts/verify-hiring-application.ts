// ─── Offline checks for the public hiring application gates ───────────────
//
// Locks the Airtable choice strings and the hard stops: car, photo ID,
// work authorization, the three consents, and willingness to get supplies.
//
//   Run:  npm run hiring:verify

import {
  EXPERIENCE_SOMEWHAT,
  TRANSPORTATION_CAR,
  TRANSPORTATION_NONE,
  issuesForStep,
  validateHiringApplication,
  visibleSteps,
  type HiringApplicationDraft,
} from "../src/lib/hiring/application";
import { parseIndeedApplicant, splitPersonName, stateFromIndeedJob } from "../src/lib/hiring/indeed";
import { hiringApplyUrl, isHiringToken, sanitizeAnswers } from "../src/lib/hiring/session";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

const id = { name: "license.jpg", type: "image/jpeg", size: 120_000 };

function draft(overrides: Partial<HiringApplicationDraft> = {}): HiringApplicationDraft {
  return {
    role: "Field Cleaner (Contractor)",
    firstName: "Jordan",
    lastName: "Lee",
    email: "jordan@example.com",
    phone: "(301) 555-0123",
    address: "2805 Mayfield Ave",
    zipCode: "21213",
    state: "Maryland",
    contractorType: "Individual",
    transportation: TRANSPORTATION_CAR,
    authorizedToWork: "Yes",
    experience: "Yes 1yr+",
    availability: "Anytime When Need",
    preferredDays: ["Fri", "Mon"],
    consent1099: true,
    backgroundCheckConsent: true,
    payConsent: true,
    willingToGetSupplies: "Yes",
    suppliesOnHand: "Vacuum and all-purpose cleaner",
    reliabilityNote: "I show up when I say I will",
    reasonNote: "I want steady houses near me",
    idConfirmed: true,
    idFile: id,
    hiringRole: "field-tech",
    ...overrides,
  };
}

console.log("hiring application");
check("Somewhat choice keeps Airtable's trailing space", EXPERIENCE_SOMEWHAT.length, 9);

const good = validateHiringApplication(draft());
check("valid application passes", good.ok, true);
if (good.ok) {
  check("phone stored as E.164", good.value.phone, "+13015550123");
  check("days stay in week order", good.value.preferredDays, ["Mon", "Fri"]);
  check("department is service delivery", good.value.department, "Service Delivery");
  check("supplies follow-up is kept", good.value.suppliesOnHand, "Vacuum and all-purpose cleaner");
  check("experience value is unchanged", good.value.experience, "Yes 1yr+");
}

const somewhat = validateHiringApplication(draft({ experience: EXPERIENCE_SOMEWHAT }));
check("Somewhat experience is accepted", somewhat.ok, true);
if (somewhat.ok) check("Somewhat is not trimmed", somewhat.value.experience, EXPERIENCE_SOMEWHAT);

check(
  "no car is a hard stop",
  validateHiringApplication(draft({ transportation: TRANSPORTATION_NONE })),
  { ok: false, status: 422, error: validateHiringApplication(draft({ transportation: TRANSPORTATION_NONE })).ok ? "" : (validateHiringApplication(draft({ transportation: TRANSPORTATION_NONE })) as { error: string }).error, code: "no_car", gate: true },
);

function codeOf(overrides: Partial<HiringApplicationDraft>) {
  const result = validateHiringApplication(draft(overrides));
  return result.ok ? "ok" : result.code;
}

check("no car code", codeOf({ transportation: TRANSPORTATION_NONE }), "no_car");
check("not authorized code", codeOf({ authorizedToWork: "No" }), "not_authorized");
check("declined 1099 code", codeOf({ consent1099: false }), "missing_consent");
check("declined background check code", codeOf({ backgroundCheckConsent: false }), "missing_consent");
check("declined pay code", codeOf({ payConsent: false }), "missing_consent");
check("unwilling supplies code", codeOf({ willingToGetSupplies: "No" }), "not_willing_supplies");
check("yes supplies without a list", codeOf({ suppliesOnHand: " " }), "missing_supplies_list");
check("none yet is an acceptable supply list", codeOf({ suppliesOnHand: "none yet" }), "ok");
check("missing photo ID", codeOf({ idFile: null }), "missing_id");
check("ID not confirmed", codeOf({ idConfirmed: false }), "missing_id");
check("ID over 4MB", codeOf({ idFile: { name: "big.jpg", type: "image/jpeg", size: 4_000_001 } }), "invalid_id");
check("text file rejected", codeOf({ idFile: { name: "notes.txt", type: "text/plain", size: 100 } }), "invalid_id");
check("pdf accepted", codeOf({ idFile: { name: "passport.pdf", type: "application/pdf", size: 80_000 } }), "ok");
check("heic accepted by extension", codeOf({ idFile: { name: "id.heic", type: "", size: 80_000 } }), "ok");
check("bad state", codeOf({ state: "MD" }), "invalid_state");
check("role outside Airtable choices", codeOf({ role: "Field Tech" }), "invalid_role");

const withList = visibleSteps("Yes");
const withoutList = visibleSteps("No");
check("yes to supplies adds the follow-up", withList.includes("suppliesOnHand"), true);
check("no does not ask what they have", withoutList.includes("suppliesOnHand"), false);
check(
  "follow-up sits after the willingness question",
  withList[withList.indexOf("supplies") + 1],
  "suppliesOnHand",
);
check("car step rejects no vehicle before the ID", issuesForStep("car", draft({ transportation: TRANSPORTATION_NONE }))?.code, "no_car");
check("California is an allowed state", codeOf({ state: "California" }), "ok");

const indeed = parseIndeedApplicant({
  sender: "Conversation-CassaundraWoodward-5gfay@indeedemail.com",
  subject: "[Action required] New application for House Cleaners Needed, Los Angeles, CA",
  snippet: "Cassaundra Woodward applied",
  messageId: "m1",
  threadId: "t1",
  date: "2026-10-13T16:59:44Z",
});
check("indeed relay email is kept", indeed?.email, "conversation-cassaundrawoodward-5gfay@indeedemail.com");
check("indeed name is parsed", indeed?.fullName, "Cassaundra Woodward");
check("indeed message is not an application when the subject is billing", parseIndeedApplicant({
  sender: "usbilling-no_reply@indeed.com",
  subject: "Payment declined",
  snippet: "Update billing",
  messageId: "m",
  threadId: "t",
}), null);
check("split name", splitPersonName("María Perez"), { firstName: "María", lastName: "Perez" });
check(
  "Baltimore posting is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV), Baltimore, MD"),
  "Maryland",
);
check(
  "Lanham posting is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (Maryland), Lanham, MD"),
  "Maryland",
);
check(
  "Hyattsville posting is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV), Hyattsville, MD"),
  "Maryland",
);
check(
  "Beaver Creek posting is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV), Beaver Creek, MD"),
  "Maryland",
);
check(
  "DMV posting with no other state is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV)"),
  "Maryland",
);
check(
  "DMV posting across 3 locations is Maryland",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV), 3 locations"),
  "Maryland",
);
check(
  "Arlington posting stays Virginia",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (DMV), Arlington, VA"),
  "Virginia",
);
check(
  "Dallas posting stays Texas",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (Dallas), Dallas, TX"),
  "Texas",
);
check(
  "Los Angeles posting stays California",
  stateFromIndeedJob("House Cleaners Needed – Flexible Schedule (LA), Los Angeles, CA"),
  "California",
);
check("session token shape", isHiringToken("a".repeat(48)), true);
check("apply url uses the hiring host", hiringApplyUrl("abc"), "https://hiring.novaracleaning.com/hiring/apply/abc");
check("saved answers drop the uploaded file", sanitizeAnswers({ firstName: "Ada", idFile: { name: "x" } }), { firstName: "Ada" });

if (failures > 0) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\nall hiring application checks passed");
