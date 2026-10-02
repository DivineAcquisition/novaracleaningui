// ─── Offline verification of the keyless address lookup (no network) ────────
//
// Locks the Photon / Census parsing behind /api/address/suggest and
// /api/address/geocode — the fallback that keeps every address dropdown
// working when Google refuses the key.
//
//   Run:  npm run address-lookup:verify

import assert from "node:assert/strict";
import {
  censusGeocodeUrl,
  censusQueries,
  matchesTypedStreet,
  mergeSuggestions,
  parseCensusMatch,
  parseCensusMatches,
  parsePhotonSuggestions,
  photonSuggestUrl,
  SERVICE_AREA_BBOX,
  streetPart,
  typedHouseNumber,
} from "../src/lib/address-lookup";

let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${name}`);
}

const photonFixture = {
  type: "FeatureCollection",
  features: [
    {
      properties: {
        osm_type: "N", osm_id: 1, type: "house", name: "Georgia Ave-Petworth Station",
        street: "Georgia Avenue Northwest", city: "Washington", state: "District of Columbia",
        postcode: "20012", countrycode: "US",
      },
      geometry: { coordinates: [-77.02, 38.93] },
    },
    {
      properties: {
        osm_type: "W", osm_id: 2, type: "street", name: "Georgia Avenue",
        city: "Silver Spring", state: "Maryland", postcode: "20910", countrycode: "US",
      },
      geometry: { coordinates: [-77.03, 38.99] },
    },
    {
      properties: {
        osm_type: "W", osm_id: 3, type: "house", housenumber: "8201", street: "Georgia Avenue",
        city: "Silver Spring", state: "Maryland", postcode: "20910-1234", countrycode: "US",
      },
      geometry: { coordinates: [-77.0265, 38.9916] },
    },
    {
      properties: {
        osm_type: "W", osm_id: 4, type: "house", housenumber: "8201", street: "Georgia Avenue",
        city: "Toronto", state: "Ontario", postcode: "M1M", countrycode: "CA",
      },
      geometry: { coordinates: [-79.3, 43.7] },
    },
  ],
};

const censusFixture = {
  result: {
    addressMatches: [
      {
        coordinates: { x: -77.026499987595, y: 38.991651824494 },
        addressComponents: { zip: "20910", city: "SILVER SPRING", state: "MD" },
        matchedAddress: "8201 GEORGIA AVE, SILVER SPRING, MD, 20910",
      },
    ],
  },
};

console.log("address lookup");

check("typed house number", () => {
  assert.equal(typedHouseNumber("8201 Georgia Ave"), "8201");
  assert.equal(typedHouseNumber("12A Main St"), "12A");
  assert.equal(typedHouseNumber("Georgia Ave"), "");
  assert.equal(typedHouseNumber("8201"), "");
});

check("street part drops the house number", () => {
  assert.equal(streetPart("8201 Georgia Ave"), "Georgia Ave");
  assert.equal(streetPart("Georgia Ave"), "Georgia Ave");
});

check("census is asked once per service state until a state or ZIP is typed", () => {
  assert.deepEqual(censusQueries("8201 Georgia Ave"), [
    "8201 Georgia Ave, MD",
    "8201 Georgia Ave, DC",
    "8201 Georgia Ave, VA",
  ]);
  assert.deepEqual(censusQueries("8201 Georgia Ave, Silver Spring, MD"), ["8201 Georgia Ave, Silver Spring, MD"]);
  assert.deepEqual(censusQueries("8201 Georgia Ave 20910"), ["8201 Georgia Ave 20910"]);
  assert.deepEqual(censusQueries("Georgia Ave"), [], "no house number → no exact lookup");
  assert.deepEqual(censusQueries("8201 Ge"), [], "street too short");
});

check("photon URL is biased to the service area and asks for houses + streets", () => {
  const url = new URL(photonSuggestUrl("8201 Georgia", { bbox: SERVICE_AREA_BBOX }));
  assert.equal(url.hostname, "photon.komoot.io");
  assert.equal(url.searchParams.get("q"), "8201 Georgia");
  assert.equal(url.searchParams.get("bbox"), SERVICE_AREA_BBOX);
  assert.deepEqual(url.searchParams.getAll("layer"), ["house", "street"]);
});

check("photon: drops POIs without a number and non-US, keeps typed number on streets", () => {
  const out = parsePhotonSuggestions(photonFixture, "8201 Georgia Ave");
  assert.equal(out.length, 1, JSON.stringify(out, null, 2));
  const [only] = out;
  assert.equal(only.street, "8201 Georgia Avenue");
  assert.equal(only.city, "Silver Spring");
  assert.equal(only.state, "MD");
  assert.equal(only.zipCode, "20910");
  assert.equal(only.secondary, "Silver Spring, MD 20910");
  assert.equal(only.label, "8201 Georgia Avenue, Silver Spring, MD 20910");
  assert.equal(only.lat, 38.99);
  assert.equal(only.lng, -77.03);
});

check("photon: DC state name maps to DC", () => {
  const out = parsePhotonSuggestions(
    { features: [{ properties: { type: "house", housenumber: "1600", street: "Pennsylvania Avenue Northwest", city: "Washington", state: "District of Columbia", postcode: "20500", countrycode: "US" }, geometry: { coordinates: [-77.03, 38.89] } }] },
    "1600 Penn",
  );
  assert.equal(out[0].state, "DC");
});

check("photon: garbage in, empty out", () => {
  assert.deepEqual(parsePhotonSuggestions(null, "x"), []);
  assert.deepEqual(parsePhotonSuggestions({ features: "nope" }, "x"), []);
});

check("census URL", () => {
  const url = new URL(censusGeocodeUrl("8201 Georgia Ave, Silver Spring, MD"));
  assert.equal(url.hostname, "geocoding.geo.census.gov");
  assert.equal(url.searchParams.get("benchmark"), "Public_AR_Current");
  assert.equal(url.searchParams.get("format"), "json");
});

check("census: first match parsed and title-cased", () => {
  const m = parseCensusMatch(censusFixture);
  assert.ok(m);
  assert.equal(m.street, "8201 Georgia Ave");
  assert.equal(m.city, "Silver Spring");
  assert.equal(m.state, "MD");
  assert.equal(m.zipCode, "20910");
  assert.ok(Math.abs((m.lat ?? 0) - 38.9916) < 0.001);
  assert.ok(Math.abs((m.lng ?? 0) + 77.0265) < 0.001);
  assert.equal(parseCensusMatch({ result: { addressMatches: [] } }), null);
});

check("census: every match kept", () => {
  const two = {
    result: {
      addressMatches: [
        ...censusFixture.result.addressMatches,
        {
          coordinates: { x: -77.1, y: 38.8 },
          addressComponents: { zip: "22301", city: "ALEXANDRIA", state: "VA" },
          matchedAddress: "8201 GEORGIA AVE, ALEXANDRIA, VA, 22301",
        },
      ],
    },
  };
  assert.deepEqual(parseCensusMatches(two).map((m) => m.state), ["MD", "VA"]);
});

check("merge: Census first, Photon repeat of the same address dropped", () => {
  const census = parseCensusMatches(censusFixture);
  const photon = parsePhotonSuggestions(photonFixture, "8201 Georgia Ave");
  const merged = mergeSuggestions([census, photon], 6);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].source, "census");
  assert.equal(merged[0].label, "8201 Georgia Ave, Silver Spring, MD 20910");
});

check("typed-street guard rejects a different street", () => {
  const [m] = parsePhotonSuggestions(photonFixture, "8201 Georgia Ave");
  assert.equal(matchesTypedStreet("8201 Georgia Ave Silver Spring", m), true);
  assert.equal(matchesTypedStreet("8201 Colesville Rd", m), false);
  assert.equal(matchesTypedStreet("Georgia Ave", m), false);
});

console.log(`\n${passed} checks passed`);
