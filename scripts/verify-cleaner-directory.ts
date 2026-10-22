// The contractor directory hides terminated people until the termination view.

import { cleanerMatchesDirectory, isTerminatedCleaner, terminationOnlyView } from "../src/lib/cleaners/directory-view";

let failures = 0;
function check(name: string, ok: boolean) {
  if (ok) console.log(`  ✓ ${name}`);
  else {
    failures++;
    console.error(`  ✗ ${name}`);
  }
}

const active = { status: "active", first_name: "Ada", engagement_end_action: null };
const pending = { status: "pending", first_name: "Grace" };
const ended = { status: "terminated", first_name: "Robin", engagement_end_action: "terminated", termination_basis: "for_cause" };
const endedByAction = { status: "inactive", first_name: "Shane", engagement_end_action: "terminated", termination_basis: "no_cause" };
const resigned = { status: "resigned", first_name: "Pat", engagement_end_action: "resigned" };

check("a terminated status is terminated", isTerminatedCleaner(ended));
check("an ended engagement is terminated", isTerminatedCleaner(endedByAction));
check("an active contractor is not terminated", !isTerminatedCleaner(active));
check("the main list is not the termination view", !terminationOnlyView("all", "all"));
check("the termination chip is the termination view", terminationOnlyView("terminated", "all"));
check("a termination basis filter is the termination view", terminationOnlyView("all", "for_cause"));

const main = { statusFilter: "all", endFilter: "all", search: "" };
check("the main list keeps an active contractor", cleanerMatchesDirectory(active, main));
check("the main list keeps a pending contractor", cleanerMatchesDirectory(pending, main));
check("the main list keeps a resignation", cleanerMatchesDirectory(resigned, main));
check("the main list hides a terminated contractor", !cleanerMatchesDirectory(ended, main));
check("the main list hides an engagement ended as terminated", !cleanerMatchesDirectory(endedByAction, main));
check("a name search on the main list still hides a terminated contractor", !cleanerMatchesDirectory(ended, { ...main, search: "robin" }));

const only = { statusFilter: "terminated", endFilter: "all", search: "" };
check("termination only shows a terminated contractor", cleanerMatchesDirectory(ended, only));
check("termination only shows an engagement ended as terminated", cleanerMatchesDirectory(endedByAction, only));
check("termination only hides an active contractor", !cleanerMatchesDirectory(active, only));
check("termination only hides a resignation", !cleanerMatchesDirectory(resigned, only));
check("a name search inside termination only finds that contractor", cleanerMatchesDirectory(ended, { ...only, search: "robin" }));
check("a for-cause filter stays inside termination only", cleanerMatchesDirectory(ended, { statusFilter: "all", endFilter: "for_cause", search: "" }));
check("a for-cause filter hides a no-cause ending", !cleanerMatchesDirectory(endedByAction, { statusFilter: "all", endFilter: "for_cause", search: "" }));

if (failures > 0) {
  console.error(`\n${failures} failed`);
  process.exit(1);
}
console.log("\ncleaner directory checks passed");
