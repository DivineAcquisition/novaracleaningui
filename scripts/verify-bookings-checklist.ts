// Offline lock: bookings checklist send, completed-service customer gate,
// and contractor checklist quality nudge after before photos.
//
//   Run:  npm run bookings-checklist:verify

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  buildContractorChecklistNudgeEmail,
  buildContractorChecklistNudgeSms,
  shouldSendContractorChecklistNudge,
} from "../supabase/functions/_shared/contractor-checklist-nudge.ts";
import { customerRowFromCompletedBooking } from "../supabase/functions/_shared/customer-from-completed-service.ts";

let failures = 0;
function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.error(`  ✗ ${name}\n      expected: ${e}\n      actual:   ${a}`);
  }
}

function fileContains(rel: string, needle: string | RegExp, name: string) {
  const text = readFileSync(resolve(rel), "utf8");
  const ok = typeof needle === "string" ? text.includes(needle) : needle.test(text);
  check(name, ok, true);
}

function fileLacks(rel: string, needle: string | RegExp, name: string) {
  const text = readFileSync(resolve(rel), "utf8");
  const hit = typeof needle === "string" ? text.includes(needle) : needle.test(text);
  check(name, hit, false);
}

console.log("Contractor checklist quality nudge:");
const sms = buildContractorChecklistNudgeSms({
  cleanerFirstName: "Janelle",
  customerName: "Laure Veissiere",
  checklistUrl: "https://contractor.novaracleaning.com/cleaner/job-checklist/abc",
});
check("SMS names Novara", sms.startsWith("Novara:"), true);
check("SMS names the contractor", sms.includes("Janelle"), true);
check("SMS names the customer", sms.includes("Laure Veissiere"), true);
check("SMS says before photos are in", sms.toLowerCase().includes("before photos"), true);
check("SMS says front to end", sms.includes("front to end"), true);
check("SMS says great quality", sms.includes("great quality"), true);
check("SMS includes checklist URL", sms.includes("job-checklist/abc"), true);
check("SMS stays short", sms.length <= 480, true);

const email = buildContractorChecklistNudgeEmail({
  cleanerFirstName: "Janelle",
  customerName: "Laure Veissiere",
  checklistUrl: "https://contractor.novaracleaning.com/cleaner/job-checklist/abc",
  serviceDate: "Wed, Sep 16",
});
check("email subject mentions checklist", /checklist/i.test(email.subject), true);
check("email says front to end", email.html.includes("front to end"), true);
check("email says great quality", email.html.includes("great quality"), true);
check("email has checklist button URL", email.html.includes("job-checklist/abc"), true);
check("email escapes HTML in names", email.html.includes("&lt;") || !email.html.includes("<script>"), true);

const xss = buildContractorChecklistNudgeEmail({
  cleanerFirstName: "<script>x</script>",
  customerName: "A & B",
  checklistUrl: "https://contractor.novaracleaning.com/cleaner/job-checklist/abc",
});
check("email escapes script tags", xss.html.includes("&lt;script&gt;"), true);
check("email escapes ampersand", xss.html.includes("A &amp; B"), true);

check(
  "save mode never sends",
  shouldSendContractorChecklistNudge({ isSave: true, submittedBeforeCount: 3, alreadySent: false, phase: "before" }),
  false,
);
check(
  "already sent never sends",
  shouldSendContractorChecklistNudge({ isSave: false, submittedBeforeCount: 3, alreadySent: true, phase: "before" }),
  false,
);
check(
  "after-phase submit never sends",
  shouldSendContractorChecklistNudge({ isSave: false, submittedBeforeCount: 3, alreadySent: false, phase: "after" }),
  false,
);
check(
  "before-phase submit sends",
  shouldSendContractorChecklistNudge({ isSave: false, submittedBeforeCount: 2, alreadySent: false, phase: "before" }),
  true,
);
check(
  "combined submit with before photos sends",
  shouldSendContractorChecklistNudge({ isSave: false, submittedBeforeCount: 1, alreadySent: false, phase: null }),
  true,
);
check(
  "submit with no before photos does not send",
  shouldSendContractorChecklistNudge({ isSave: false, submittedBeforeCount: 0, alreadySent: false, phase: "before" }),
  false,
);

console.log("\nCustomer row only after a completed service:");
const row = customerRowFromCompletedBooking({
  email: "  Laure@Example.com ",
  first_name: "Laure",
  last_name: "Veissiere",
  phone: "+13015260223",
  address: "116 Lee Ave",
  city: "Takoma Park",
  state: "MD",
  zip_code: "20912",
});
check("lowercases email", row.email, "laure@example.com");
check("maps zip_code to zip", row.zip, "20912");
check("keeps name", row.first_name, "Laure");
check("empty email is empty", customerRowFromCompletedBooking({}).email, "");

console.log("\nWiring:");
fileContains(
  "src/views/admin/Bookings.tsx",
  "BookingCustomerChecklistSend",
  "Bookings tab has customer checklist send",
);
fileContains(
  "src/views/admin/Bookings.tsx",
  "Email + SMS",
  "Bookings tab can email and text the checklist",
);
fileContains(
  "src/lib/membership-admin.ts",
  "send-cleaning-checklist",
  "checklist send uses send-cleaning-checklist",
);
fileContains(
  "supabase/functions/complete-booking/index.ts",
  "ensureCustomerFromCompletedBooking",
  "complete-booking creates the customer record",
);
fileContains(
  "supabase/functions/submit-cleaner-photos/index.ts",
  "notifyContractorsChecklistAfterBeforePhotos",
  "before-photo submit notifies the contractor",
);
fileContains(
  "supabase/functions/send-cleaner-email/index.ts",
  "checklist_quality_nudge",
  "cleaner email has the quality-nudge template",
);
fileContains(
  "src/views/cleaner/JobPhotos.tsx",
  "phase: livePhase || undefined",
  "photo form passes before/after phase",
);
fileLacks(
  "src/views/AuthCallback.tsx",
  '.from("customers")',
  "auth callback does not create customers",
);
fileLacks(
  "src/views/admin/Customers.tsx",
  "CreateCustomerDialog",
  "admin Customers has no create-customer dialog",
);
fileContains(
  "src/views/admin/Customers.tsx",
  "only people who have completed a service",
  "Customers tab copy says completed-service only",
);
fileContains(
  "supabase/functions/stripe-webhook/index.ts",
  "Skipping customers insert until service is completed",
  "paid booking webhook does not insert customers",
);
fileContains(
  "supabase/functions/book-as-va/index.ts",
  "will be created after completed service",
  "VA booking does not insert customers",
);
fileLacks(
  "supabase/functions/admin-grant-credit/index.ts",
  '.from("customers")\n          .insert',
  "credit grant does not mint a customers row",
);
fileContains(
  "supabase/migrations/20260916160000_contractor_checklist_nudge.sql",
  "contractor_checklist_nudge_sent_at",
  "migration adds the one-time nudge stamp",
);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll checks passed.");
