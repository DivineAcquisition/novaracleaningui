// The onboarding invite emails the cleaner, and only claims success when
// Resend accepts it. SMS stays a separate channel.
//
//   Run:  npx tsx scripts/verify-onboarding-invite-email.ts

import { readFileSync } from "node:fs";

import {
  buildOnboardingInviteEmail,
  usableInviteEmail,
} from "../src/lib/talent/onboarding-invite";

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

const url = "https://contractor.novaracleaning.com/cleaner/auth?invite=abc123";
const mail = buildOnboardingInviteEmail({ firstName: "Ava <script>", onboardingUrl: url });

console.log("Onboarding invite email:");
check("subject names onboarding", mail.subject.includes("onboarding"), true);
check("html includes the invite link", mail.html.includes(url), true);
check("html escapes the name", mail.html.includes("Ava &lt;script&gt;"), true);
check("html does not inject the raw name", mail.html.includes("<script>"), false);
check("button is present", mail.html.includes("Start onboarding"), true);

check("real email is usable", usableInviteEmail(" Ava@Example.com "), "ava@example.com");
check("blank email is not usable", usableInviteEmail("  "), null);
check("placeholder email is not usable", usableInviteEmail("a@pending.novara"), null);
check("phone-looking value is not an email", usableInviteEmail("3015550100"), null);

console.log("\nLaunch and resend send that email and still text:");
const route = readFileSync("src/app/api/talent/actions/route.ts", "utf8");
check("route sends the invite email", route.includes("sendOnboardingInviteEmail"), true);
check("route still texts through GHL", route.includes('invoke("send-ghl-sms"'), true);
check("route does not treat the edge invite as the email", route.includes('type: "invitation"'), false);

console.log("\nCleaner email function does not report a provider error as sent:");
const sender = readFileSync("supabase/functions/send-cleaner-email/index.ts", "utf8");
check("invitation template includes the link", sender.includes("onboardingUrl"), true);
check("Resend error fails the send", sender.includes("emailResponse.error"), true);

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll onboarding invite email checks passed.");
