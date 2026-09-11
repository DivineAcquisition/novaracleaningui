// Offline verification of the Contractor Standards & Conduct Addendum (no network/DB).
//
//   • the version in TypeScript matches the mirror in app_settings
//   • acknowledging an older version is "outdated", not "signed" — the whole
//     re-acknowledgment path hangs off this one comparison
//   • section ids are stable and unique (they're anchors and record keys)
//   • the document still says the things it was written to say
//
//   Run:  npm run standards:verify

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import {
  CONTRACTOR_STANDARDS_ACKNOWLEDGMENT,
  CONTRACTOR_STANDARDS_EDITION,
  CONTRACTOR_STANDARDS_SECTIONS,
  CONTRACTOR_STANDARDS_VERSION,
  needsStandardsAcknowledgment,
  standardsAskCopy,
  standardsLink,
  standardsRuleCount,
  standardsStanding,
} from "../src/lib/contractor-standards";

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

// ─── The version mirror ──────────────────────────────────────────────────────
//
// The edge function that sends links and the SQL status view read the current
// version from app_settings; the app reads it from TypeScript. If those drift,
// the roster is either never asked to re-acknowledge or asked forever, and both
// failures are silent. This check is the reason the mirror is safe to have.

console.log("Version mirror (TypeScript ↔ app_settings):");

const migrationsDir = join(__dirname, "..", "supabase", "migrations");
const seededVersions = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .flatMap((file) => {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    if (!sql.includes("'contractor_standards'")) return [];
    // Matches the jsonb_build_object('version', '…') seed.
    const match = sql.match(/'version',\s*'([^']+)'/);
    return match ? [{ file, version: match[1] }] : [];
  });

check("at least one migration seeds app_settings.contractor_standards", seededVersions.length > 0, true);

const latestSeed = seededVersions[seededVersions.length - 1];
check(
  `latest migration (${latestSeed?.file || "none"}) seeds the version TypeScript publishes`,
  latestSeed?.version,
  CONTRACTOR_STANDARDS_VERSION,
);
check(
  "the edition label carries the same date as the version",
  CONTRACTOR_STANDARDS_EDITION.includes(
    new Date(`${CONTRACTOR_STANDARDS_VERSION}T00:00:00Z`).toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    }),
  ),
  true,
);

// ─── Standing ────────────────────────────────────────────────────────────────

console.log("\nAcknowledgment standing:");
check("no record at all is 'never'", standardsStanding(null), "never");
check("an empty version string is 'never'", standardsStanding({ conduct_standards_version: "" }), "never");
check(
  "the current version is 'current'",
  standardsStanding({ conduct_standards_version: CONTRACTOR_STANDARDS_VERSION }),
  "current",
);
check(
  "an earlier version is 'outdated', not 'current'",
  standardsStanding({ conduct_standards_version: "2020-01-01" }),
  "outdated",
);
check(
  "an unrecognised version fails toward asking again",
  standardsStanding({ conduct_standards_version: "not-a-version" }),
  "outdated",
);
check(
  "only the current version clears the ask",
  [null, { conduct_standards_version: "2020-01-01" }, { conduct_standards_version: CONTRACTOR_STANDARDS_VERSION }].map(
    needsStandardsAcknowledgment,
  ),
  [true, true, false],
);

console.log("\nThe ask:");
check(
  "somebody on an older version is told it changed, not that they never did it",
  standardsAskCopy("outdated").title,
  "We've updated the contractor standards",
);
check(
  "a first-time ask does not claim an update",
  standardsAskCopy("never").title.includes("updated"),
  false,
);
check(
  "the link points at the acknowledgment page",
  standardsLink("abc123"),
  "https://contractor.novaracleaning.com/cleaner/standards/abc123",
);

// ─── The document ────────────────────────────────────────────────────────────

console.log("\nDocument structure:");
const ids = CONTRACTOR_STANDARDS_SECTIONS.map((s) => s.id);
check("section ids are unique", new Set(ids).size, ids.length);
check(
  "section ids are slugs (they're URL anchors and record keys)",
  ids.filter((id) => !/^[a-z][a-z0-9-]*$/.test(id)),
  [],
);
check(
  "every section has a heading and at least one rule",
  CONTRACTOR_STANDARDS_SECTIONS.filter(
    (s) => !s.heading.trim() || s.lists.reduce((n, l) => n + l.items.length, 0) === 0,
  ).map((s) => s.id),
  [],
);
check(
  "no empty list items",
  CONTRACTOR_STANDARDS_SECTIONS.flatMap((s) => s.lists).flatMap((l) => l.items).filter((i) => !i.trim()),
  [],
);
check("the eight standards areas are all present", ids, [
  "appearance",
  "phone",
  "checklist",
  "property",
  "pets",
  "punctuality",
  "chemicals",
  "incidents",
]);
check("the rule count the wizard advertises is non-zero", standardsRuleCount() > 0, true);

console.log("\nSubstance:");
const fullText = CONTRACTOR_STANDARDS_SECTIONS.map((s) =>
  [s.heading, s.lede || "", ...s.lists.flatMap((l) => l.items), ...(s.emphasis || [])].join(" "),
).join(" ");

// Each of these is a rule the addendum exists to make enforceable. Losing one
// in an edit should fail loudly rather than quietly narrow what was agreed to.
for (const [label, needle] of [
  ["pets may never be struck or handled roughly", "Never strike, kick, swing at, chase"],
  ["asking the client to move a pet is the correct response", "ask the client to move the animal"],
  ["discomfort around animals is accommodated", "not held against you"],
  ["closed-toe non-slip shoes", "Closed-toe, non-slip shoes"],
  ["phone reachable within 5 minutes", "within 5 minutes"],
  ["falsifying checklist completion", "Falsifying checklist completion"],
  ["furniture is put back", "must be put back"],
  ["late notice comes before the start time", "before your scheduled start time"],
  ["chemicals are matched to the surface", "appropriate to the surface"],
  ["self-report before leaving the property", "before you leave the property"],
] as Array<[string, string]>) {
  check(label, fullText.includes(needle), true);
}

check(
  "the acknowledgment names the consequences it can lead to",
  ["coaching", "strike", "suspension", "removal"].every((word) =>
    CONTRACTOR_STANDARDS_ACKNOWLEDGMENT.includes(word),
  ),
  true,
);
check(
  "the acknowledgment frames these as clarifying the ICA, not replacing it",
  CONTRACTOR_STANDARDS_ACKNOWLEDGMENT.includes("Independent Contractor Agreement"),
  true,
);

if (failures) {
  console.error(`\n${failures} contractor-standards check(s) failed.`);
  process.exit(1);
}
console.log("\nAll contractor-standards checks passed.");
