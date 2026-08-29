// Offline checks on the checklist catalog and its crew-side mirror.
//
// The feedback loop only works if item ids are stable and unique, if the
// cumulative scopes are modeled as membership rather than copies, and if the
// Deno mirror the crew works from uses the same ids as the catalog the
// signals are counted against. All of that is checkable without a database.
//
// Run: npx tsx scripts/verify-checklist-catalog.ts

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CATALOG_ITEMS,
  CATALOG_ITEMS_BY_ID,
  CHECKLIST_CATALOG_KEYS,
  catalogItemsFor,
  catalogSectionsFor,
} from "../src/lib/checklist-catalog";
import {
  COMMERCIAL_COMPARISON,
  COMMERCIAL_DETAILED_EXTRAS,
  COMMERCIAL_STANDARD_EXTRAS,
  commercialChecklistSections,
  commercialChecklistSectionsForJob,
} from "../src/lib/commercial-checklists";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("\nCatalog identity");
{
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const item of CATALOG_ITEMS) {
    if (seen.has(item.id)) dupes.push(item.id);
    seen.add(item.id);
  }
  check("every item id is unique", dupes.length === 0, dupes.join(", "));
  check(
    "every item id is namespaced (family.area.task)",
    CATALOG_ITEMS.every((i) => i.id.split(".").length >= 3),
    CATALOG_ITEMS.filter((i) => i.id.split(".").length < 3).map((i) => i.id).join(", "),
  );
  check(
    "every item belongs to at least one checklist",
    CATALOG_ITEMS.every((i) => i.checklists.length > 0),
    CATALOG_ITEMS.filter((i) => i.checklists.length === 0).map((i) => i.id).join(", "),
  );
  check(
    "every item has an area for review-theme grouping",
    CATALOG_ITEMS.every((i) => i.area.trim().length > 0),
  );
  check("lookup map covers every item", Object.keys(CATALOG_ITEMS_BY_ID).length === CATALOG_ITEMS.length);
}

console.log("\nCumulative commercial scopes (Light ⊂ Standard ⊂ Detailed)");
{
  const light = catalogItemsFor("commercial_light").map((i) => i.id);
  const standard = catalogItemsFor("commercial_standard").map((i) => i.id);
  const detailed = catalogItemsFor("commercial_detailed").map((i) => i.id);

  check("Light is a subset of Standard", light.every((id) => standard.includes(id)));
  check("Standard is a subset of Detailed", standard.every((id) => detailed.includes(id)));
  check("Standard adds work beyond Light", standard.length > light.length);
  check("Detailed adds work beyond Standard", detailed.length > standard.length);

  // Membership, not duplication: the SAME id is shared, so a quality-miss on a
  // Detailed job counts once against one item.
  check(
    "shared items are one id, not copies per scope",
    light.every((id) => CATALOG_ITEMS_BY_ID[id].checklists.length >= 3),
  );

  check(
    "Standard upgrade prompt lists exactly what Light lacks",
    COMMERCIAL_STANDARD_EXTRAS.length === standard.length - light.length,
  );
  check(
    "Detailed upgrade prompt lists exactly what Standard lacks",
    COMMERCIAL_DETAILED_EXTRAS.length === detailed.length - standard.length,
  );
}

console.log("\nRendered checklists");
{
  for (const key of CHECKLIST_CATALOG_KEYS) {
    const sections = catalogSectionsFor(key);
    check(
      `${key} renders at least one section`,
      sections.length > 0,
    );
    check(
      `${key} sections carry no empty item lists`,
      sections.every((s) => s.items.length > 0),
    );
  }

  for (const kind of ["light", "standard", "detailed", "office"] as const) {
    const sections = commercialChecklistSections(kind);
    check(
      `${kind} section item ids are index-aligned with items`,
      sections.every((s) => s.itemIds.length === s.items.length),
    );
    check(
      `${kind} item ids all resolve back to the catalog`,
      sections.every((s) => s.itemIds.every((id) => Boolean(CATALOG_ITEMS_BY_ID[id]))),
    );
  }

  // An office site priced at Detailed must work Detailed depth, not Standard.
  const officeDetailed = commercialChecklistSectionsForJob("detailed", true)
    .flatMap((s) => s.itemIds);
  check(
    "office job at Detailed depth includes the Detailed-only work",
    officeDetailed.includes("commercial.detailed.grout"),
  );
  check(
    "office job still includes the office frequency rules",
    officeDetailed.includes("office.daily.restrooms"),
  );

  const officeLight = commercialChecklistSectionsForJob("light", true).flatMap((s) => s.itemIds);
  check(
    "office job at Light depth excludes Detailed-only work",
    !officeLight.includes("commercial.detailed.grout"),
  );
}

console.log("\nScope comparison table");
{
  const rows = COMMERCIAL_COMPARISON.flatMap((g) => g.rows);
  check("every comparison row references a real item", rows.every((r) => Boolean(CATALOG_ITEMS_BY_ID[r.itemId])));
  check(
    "no row claims to be in Light but not Detailed",
    rows.every((r) => !r.light || r.detailed),
  );
  check(
    "no row claims to be in Standard but not Detailed",
    rows.every((r) => !r.standard || r.detailed),
  );
}

console.log("\nCrew mirror (supabase/functions/_shared/contractor-checklists.ts)");
{
  const mirror = readFileSync(
    resolve(process.cwd(), "supabase/functions/_shared/contractor-checklists.ts"),
    "utf8",
  );
  const referenced = Array.from(mirror.matchAll(/"((?:commercial|office|str)\.[a-z0-9_.]+)"/g)).map(
    (m) => m[1],
  );
  const unknown = Array.from(new Set(referenced)).filter((id) => !CATALOG_ITEMS_BY_ID[id]);
  check(
    "every id the crew list references exists in the catalog",
    unknown.length === 0,
    unknown.join(", "),
  );
  check("the crew list references catalog ids at all", referenced.length > 0);
}

console.log(
  failures === 0
    ? "\nAll checklist catalog checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
