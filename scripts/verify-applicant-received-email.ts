// The new-applicant email says a phone screen is by call or text, and only if
// selected. Intake must send it on create and must not send it on an update.
//
//   Run:  node --experimental-strip-types --no-warnings scripts/verify-applicant-received-email.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { applicantReceivedEmail } from "../src/lib/talent/received-email-copy.ts";

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

function includes(name: string, haystack: string, needle: string) {
  check(name, haystack.includes(needle), true);
}

const content = applicantReceivedEmail({ firstName: "Avery" });
check("subject", content.subject, "We received your Novara Cleaning application");
includes("greets by first name", content.html, "Hi Avery,");
includes("call", content.html, "phone call");
includes("text", content.html, "text");
includes("phone screen", content.html, "phone screen");
includes("only if selected", content.html, "If you are selected");
includes("selection is not guaranteed", content.html, "Selection is not guaranteed");
check("does not promise a screen", /you will (get|have) a phone screen/i.test(content.html), false);

const fallback = applicantReceivedEmail({ fullName: "Jordan Lee" });
includes("falls back to the first word of the full name", fallback.html, "Hi Jordan,");

const root = resolve(import.meta.dirname, "..");
const hiring = readFileSync(resolve(root, "src/app/api/hiring/apply/route.ts"), "utf8");
const manual = readFileSync(resolve(root, "src/app/api/talent/create/route.ts"), "utf8");
const sync = readFileSync(resolve(root, "src/app/api/talent/sync/route.ts"), "utf8");

includes("hiring create sends the email", hiring, "await sendApplicantReceivedEmail");
includes("manual create sends the email", manual, "await sendApplicantReceivedEmail");
includes("sync sends the email", sync, "await sendApplicantReceivedEmail");

const hiringUpdate = hiring.indexOf("updated: true");
const hiringSend = hiring.indexOf("await sendApplicantReceivedEmail");
check("a re-apply does not send another email", hiringUpdate >= 0 && hiringSend > hiringUpdate, true);

const syncGate = sync.indexOf('if (stage !== "applicant") continue;');
const syncSend = sync.indexOf("await sendApplicantReceivedEmail");
check("sync only emails fresh applicant-stage imports", syncGate >= 0 && syncSend > syncGate, true);
includes("sync skips old backfill", sync, "NOTIFY_WINDOW_MS");

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\napplicant received email ok");
