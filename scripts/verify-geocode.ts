// ─── Offline verification of geocode query shaping (no network/DB) ───────────
//
// Locks the ZIP-only vs street-address split that was putting 400–1,600
// "miles" into SMS. Nominatim freeform `q=20735, ,  20735` matches random
// US/PR street numbers; postal-code APIs must be used instead.
//
//   Run:  npm run geocode:verify

import { readFileSync } from "node:fs";
import { haversineMiles } from "../src/lib/dispatch-scoring";
import {
  buildGeocodeQuery,
  geocodeCacheZipKey,
  googleAddressGeocodeUrl,
  googleZipGeocodeUrl,
  isValidLatLng,
  isZipOnlyGeocodeInput,
  looksLikeBareZip,
  nominatimAddressGeocodeUrl,
  nominatimZipGeocodeUrl,
  normalizeUSZip,
  requestedZip,
  zipMatchesResult,
  zippopotamUrl,
} from "../src/lib/geocode";
import {
  buildGeocodeQuery as denoBuildGeocodeQuery,
  isZipOnlyGeocodeInput as denoIsZipOnly,
  nominatimZipGeocodeUrl as denoNominatimZip,
} from "../supabase/functions/_shared/geocode.ts";

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

console.log("ZIP detection:");
check("plain ZIP", looksLikeBareZip("20735"), true);
check("ZIP+4", looksLikeBareZip("22314-1234"), true);
check("empty is zip-shaped (caller supplies zip field)", looksLikeBareZip(""), true);
check("old comma query", looksLikeBareZip("20735, ,  20735"), true);
check("street is not a ZIP", looksLikeBareZip("123 Main St"), false);
check("normalize strips ZIP+4", normalizeUSZip("22314-9999"), "22314");
check("excel-ish ZIP", normalizeUSZip("20,735.0"), "20735");
check("requested zip from zip field", requestedZip({ zip: "22191" }), "22191");
check("requested zip from address=zip", requestedZip({ address: "20032" }), "20032");

console.log("\nZIP-only vs street:");
check("enroll-cleaner { zip }", isZipOnlyGeocodeInput({ zip: "20735" }), true);
check("urgent-hire old { zip, address: zip }", isZipOnlyGeocodeInput({ zip: "22304", address: "22304" }), true);
check("onboarding { zip }", isZipOnlyGeocodeInput({ zip: "20748" }), true);
check("street + zip is not zip-only", isZipOnlyGeocodeInput({ address: "301 Warren Avenue", zip: "21230" }), false);
check("city+state+zip is not zip-only", isZipOnlyGeocodeInput({ city: "Baltimore", state: "MD", zip: "21230" }), false);

console.log("\nQuery builder never emits empty-comma ZIP streets:");
check("zip only", buildGeocodeQuery({ zip: "20735" }), "20735");
check("does not duplicate address=zip", buildGeocodeQuery({ zip: "20735", address: "20735" }), "20735");
check("street + city + state + zip", buildGeocodeQuery({
  address: "301 Warren Avenue",
  city: "Baltimore",
  state: "MD",
  zip: "21230",
}), "301 Warren Avenue, Baltimore, MD, 21230");
check("blank fields omitted", buildGeocodeQuery({ address: "", city: "", state: "", zip: "22191" }), "22191");

console.log("\nPostal-code URLs (never freeform q= for ZIPs):");
check(
  "Nominatim zip uses postalcode=",
  nominatimZipGeocodeUrl("20735").includes("postalcode=20735") &&
    !nominatimZipGeocodeUrl("20735").includes("q="),
  true,
);
check(
  "Google zip uses components=postal_code",
  googleZipGeocodeUrl("20735", "k").includes("postal_code") &&
    !googleZipGeocodeUrl("20735", "k").includes("address="),
  true,
);
check("Zippopotam path", zippopotamUrl("22191"), "https://api.zippopotam.us/us/22191");
check(
  "street Nominatim still uses q=",
  nominatimAddressGeocodeUrl("301 Warren Avenue, Baltimore, MD").includes("q="),
  true,
);
check(
  "street Google still uses address=",
  googleAddressGeocodeUrl("301 Warren Avenue", "k").includes("address="),
  true,
);

console.log("\nResult ZIP matching + coords:");
check("matching zips", zipMatchesResult("20735", "20735"), true);
check("PR school postcode is a mismatch", zipMatchesResult("20735", "00725"), false);
check("missing result zip is not a hard fail", zipMatchesResult("20735", ""), true);
check("Baltimore coords valid", isValidLatLng(39.2789, -76.609672), true);
check("lat above 90 is invalid", isValidLatLng(138.7, -76.6), false);
check("lng beyond 180 is invalid", isValidLatLng(39.2, -200), false);
check("cache key", geocodeCacheZipKey("20735"), "zip:20735");

console.log("\nHaversine (SMS miles) for known DMV pair:");
const baltimore = { lat: 39.2789, lng: -76.609672 };
const clintonMd = { lat: 38.7551555, lng: -76.8995125 }; // Nominatim postalcode=20735
const miles = Math.round(haversineMiles(clintonMd.lat, clintonMd.lng, baltimore.lat, baltimore.lng) * 10) / 10;
check("Clinton MD 20735 → Baltimore 21230 is ~39 mi, not 1586", miles > 30 && miles < 50, true);
check("rounded miles", miles, 39.4);

console.log("\nDeno copy stays in lock-step:");
const src = readFileSync("src/lib/geocode.ts", "utf8").replace(
  "Keep this file in lock-step with supabase/functions/_shared/geocode.ts.",
  "LOCKSTEP",
);
const deno = readFileSync("supabase/functions/_shared/geocode.ts", "utf8").replace(
  "Keep this file in lock-step with src/lib/geocode.ts.",
  "LOCKSTEP",
);
check("src/lib/geocode.ts matches supabase/_shared/geocode.ts", src, deno);
check("Deno zip-only agrees", denoIsZipOnly({ zip: "20735" }), true);
check("Deno query agrees", denoBuildGeocodeQuery({ zip: "20735" }), "20735");
check("Deno nominatim zip URL agrees", denoNominatimZip("20735"), nominatimZipGeocodeUrl("20735"));

if (failures) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll geocode checks passed.");
