// Offline checks for zone-based proof of completion.
//
// Named maps come from the walkthrough (or an admin edit). Booking time
// never invents "Zone 1". The close gate requires a status on every name.
//
// Run: npx tsx scripts/verify-site-zones.ts

import {
  addZone,
  assessedZoneRecleanCents,
  customerZoneIncompleteMessage,
  incompleteZoneCompletions,
  labeledZonePhotos,
  matchNamedZones,
  mergeZones,
  parseSiteZones,
  photosForZone,
  renameZone,
  siteRequiresZones,
  siteZoneNames,
  splitZone,
  zoneCompletionGate,
  zoneThresholdSqft,
} from "../src/lib/site-zones";
import {
  DEFAULT_COMMERCIAL_SETTINGS,
  photoZonesForSite,
  siteRequiresZones as pricingRequiresZones,
  type CommercialPricingConfig,
} from "../src/lib/commercial-pricing";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("\nParse string arrays and objects");
{
  const fromStrings = parseSiteZones(["Loading Dock", "Office Area", "Loading Dock"]);
  check("dedupes string names", fromStrings.length === 2 && fromStrings[0].name === "Loading Dock");
  const fromObjects = parseSiteZones([
    { id: "a", name: "Main Warehouse Floor", description: "Racking aisles" },
    { name: "Restroom Block A" },
  ]);
  check("keeps object ids and descriptions", fromObjects[0].id === "a" && fromObjects[0].description === "Racking aisles");
  check("siteZoneNames reads both shapes", siteZoneNames(["Dock", { name: "Office" }]).join("|") === "Dock|Office");
}

console.log("\nThreshold — independent of walkthrough, same default");
{
  check("defaults to 5000", zoneThresholdSqft({}) === 5000);
  check("walkthrough fallback", zoneThresholdSqft({ walkthrough_threshold_sqft: 8000 }) === 8000);
  check("photo_zone_threshold wins over walkthrough", zoneThresholdSqft({
    walkthrough_threshold_sqft: 8000,
    photo_zone_threshold_sqft: 6000,
  }) === 6000);
  check("zone_threshold_sqft is independently adjustable", zoneThresholdSqft({
    walkthrough_threshold_sqft: 8000,
    photo_zone_threshold_sqft: 6000,
    zone_threshold_sqft: 4500,
  }) === 4500);
  check("small office is not zone-eligible", siteRequiresZones(4200, { photo_zone_threshold_sqft: 5000 }) === false);
  check("warehouse at threshold is eligible", siteRequiresZones(5000, { photo_zone_threshold_sqft: 5000 }) === true);
  const pricingConfig = { settings: { ...DEFAULT_COMMERCIAL_SETTINGS, photo_zone_threshold_sqft: 5000 } } as CommercialPricingConfig;
  check("pricing helper agrees", pricingRequiresZones(pricingConfig, 18000) === true);
}

console.log("\nNamed maps only — never invent Zone 1");
{
  const config = { settings: { ...DEFAULT_COMMERCIAL_SETTINGS, max_photo_zones: 8 } } as CommercialPricingConfig;
  check("unmapped large site returns []", photoZonesForSite(config, 30000, null).length === 0);
  check("empty array is not a map", photoZonesForSite(config, 30000, []).length === 0);
  check("named map is reused", photoZonesForSite(config, 18000, ["Loading Dock", "Office"]).join("|") === "Loading Dock|Office");
  check("object map is reused", photoZonesForSite(config, 18000, [{ name: "Restroom Block A" }])[0] === "Restroom Block A");
}

console.log("\nAdmin edit without a re-walkthrough");
{
  let zones = parseSiteZones(["Loading Dock", "Office Area"]);
  zones = addZone(zones, "Restroom Block A", "Two stalls");
  check("add", zones.length === 3 && zones[2].description === "Two stalls");
  zones = renameZone(zones, zones[0].id, "Receiving Dock");
  check("rename", zones[0].name === "Receiving Dock");
  zones = splitZone(zones, zones[1].id, "Front Office", "Back Office");
  check("split", zones.some((z) => z.name === "Front Office") && zones.some((z) => z.name === "Back Office"));
  const keep = zones.find((z) => z.name === "Front Office")!;
  const drop = zones.find((z) => z.name === "Back Office")!;
  zones = mergeZones(zones, keep.id, drop.id);
  check("merge drops the sibling", !zones.some((z) => z.name === "Back Office") && zones.some((z) => z.name === "Front Office"));
}

console.log("\nCrew Lead close gate");
{
  const names = ["Loading Dock", "Office Area"];
  check("blank is not ok", zoneCompletionGate(names, []).ok === false);
  check("partial still counts as marked", zoneCompletionGate(names, [
    { zoneId: "1", name: "Loading Dock", status: "complete", note: "" },
    { zoneId: "2", name: "Office Area", status: "partial", note: "ran out of time" },
  ]).ok === true);
  check("missing one name fails", zoneCompletionGate(names, [
    { zoneId: "1", name: "Loading Dock", status: "complete", note: "" },
  ]).ok === false);
  const incomplete = incompleteZoneCompletions([
    { zoneId: "1", name: "Loading Dock", status: "not_done", note: "locked" },
    { zoneId: "2", name: "Office Area", status: "complete", note: "" },
  ]);
  check("incomplete list is the unfinished names", incomplete.map((z) => z.name).join("|") === "Loading Dock");
  const msg = customerZoneIncompleteMessage("Alex", [
    { zoneId: "1", name: "Loading Dock", status: "not_done", note: "locked" },
  ]);
  check("customer message names the zone", msg.includes("Loading Dock") && msg.includes("Alex"));
}

console.log("\nPer-zone photos and reclean scope");
{
  const sections = [{ zoneName: "Loading Dock" }, { zoneName: "Office Area" }];
  const meta = {
    "0": { before: ["b1"], after: ["a1"] },
    "1": { before: ["b2"], after: [] },
  };
  check("photosForZone reads the matching section", photosForZone(meta, sections, "Loading Dock").after[0] === "a1");
  const labeled = labeledZonePhotos(meta, sections, ["Loading Dock"]);
  check("labeled sequence is zone-specific", labeled.length === 2 && labeled.every((p) => p.zoneName === "Loading Dock"));
  check("matchNamedZones never invents", matchNamedZones(["Zone 1", "loading dock"], ["Loading Dock", "Office Area"]).join("|") === "Loading Dock");
  check("targeted reclean is a fraction of the original charge", assessedZoneRecleanCents(40000, 1, 4) === 10000);
  check("unpaid reclean is prohibited even with $0 original", assessedZoneRecleanCents(0, 1, 2) > 0);
}

if (failures) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log("\nAll zone proof-of-completion checks passed.");
