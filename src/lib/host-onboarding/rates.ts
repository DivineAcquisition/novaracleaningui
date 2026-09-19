// ─── Host per-turnover rate table (Agreement Part Two) ─────────────────────
//
// Canonical STR pricing: base + linen/laundry + restock by bedroom band.
// Copied from the Host Partnership Agreement Property & Rate Schedule
// ("How Rates Are Determined"). The /str calculator, Claim, and verify
// script all call this — never a second hardcoded list.
//
// 5+ bedrooms is "quote" on the schedule → Book a Call, not auto-claim.
// Ranges are estimates. The confirmed rate is the number frozen onto the
// onboarding snapshot (midpoint of the band, labeled non-final until the
// host confirms the schedule).

export const HOST_QUOTE_LOCK_HOURS = 48;

export interface HostRateBand {
  id: string;
  label: string;
  minBedrooms: number;
  maxBedrooms: number;
  baseMin: number;
  baseMax: number;
  linenMin: number;
  linenMax: number;
  restockMin: number;
  restockMax: number;
}

/** Agreement Part Two reference bands. 5+ BR is not auto-priced. */
export const HOST_RATE_BANDS: HostRateBand[] = [
  {
    id: "studio_1br",
    label: "Studio / 1 bed",
    minBedrooms: 0,
    maxBedrooms: 1,
    baseMin: 110,
    baseMax: 150,
    linenMin: 30,
    linenMax: 45,
    restockMin: 15,
    restockMax: 25,
  },
  {
    id: "2br",
    label: "2 bed",
    minBedrooms: 2,
    maxBedrooms: 2,
    baseMin: 150,
    baseMax: 200,
    linenMin: 40,
    linenMax: 55,
    restockMin: 15,
    restockMax: 25,
  },
  {
    id: "3br",
    label: "3 bed",
    minBedrooms: 3,
    maxBedrooms: 3,
    baseMin: 200,
    baseMax: 260,
    linenMin: 50,
    linenMax: 70,
    restockMin: 20,
    restockMax: 30,
  },
  {
    id: "4br",
    label: "4 bed",
    minBedrooms: 4,
    maxBedrooms: 4,
    baseMin: 225,
    baseMax: 280,
    linenMin: 55,
    linenMax: 75,
    restockMin: 20,
    restockMax: 30,
  },
];

export function bandForBedrooms(bedrooms: number | null | undefined): HostRateBand | null {
  if (bedrooms == null || bedrooms === ("" as unknown)) return null;
  const n = Number(bedrooms);
  if (!Number.isFinite(n) || n < 0) return null;
  return HOST_RATE_BANDS.find((b) => n >= b.minBedrooms && n <= b.maxBedrooms) || null;
}

export interface HostTurnoverQuote {
  ok: boolean;
  needsQuote: boolean;
  band: HostRateBand | null;
  bedrooms: number | null;
  linen: boolean;
  restock: boolean;
  baseMin: number;
  baseMax: number;
  linenMin: number;
  linenMax: number;
  restockMin: number;
  restockMax: number;
  min: number;
  max: number;
  /** Midpoint of the band, whole dollars — the number Claim freezes. */
  claimed: number;
}

export function computeTurnoverQuote(input: {
  bedrooms?: number | null;
  linen?: boolean;
  restock?: boolean;
}): HostTurnoverQuote {
  const bedrooms =
    input.bedrooms == null || input.bedrooms === ("" as unknown) ? null : Number(input.bedrooms);
  const linen = input.linen === true;
  const restock = input.restock === true;
  const band = bandForBedrooms(bedrooms);
  const empty = {
    ok: false,
    needsQuote: bedrooms != null && Number.isFinite(bedrooms) && bedrooms >= 5,
    band: null as HostRateBand | null,
    bedrooms,
    linen,
    restock,
    baseMin: 0,
    baseMax: 0,
    linenMin: 0,
    linenMax: 0,
    restockMin: 0,
    restockMax: 0,
    min: 0,
    max: 0,
    claimed: 0,
  };
  if (!band) return empty;

  const linenMin = linen ? band.linenMin : 0;
  const linenMax = linen ? band.linenMax : 0;
  const restockMin = restock ? band.restockMin : 0;
  const restockMax = restock ? band.restockMax : 0;
  const min = band.baseMin + linenMin + restockMin;
  const max = band.baseMax + linenMax + restockMax;
  return {
    ok: true,
    needsQuote: false,
    band,
    bedrooms,
    linen,
    restock,
    baseMin: band.baseMin,
    baseMax: band.baseMax,
    linenMin,
    linenMax,
    restockMin,
    restockMax,
    min,
    max,
    claimed: Math.round((min + max) / 2),
  };
}

export function formatDollarRange(min: number, max: number): string {
  if (!min && !max) return "—";
  const fmt = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
  if (min === max) return fmt(min);
  return `${fmt(min)}–${fmt(max)}`;
}
