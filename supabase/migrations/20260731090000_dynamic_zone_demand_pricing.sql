-- ─── Dynamic zone & demand-reactive pricing (internal booking) ──────────────
--
-- Adds the two new pricing layers to the internal (VA/admin) booking flow:
--
--   BASE (band table, DB-config)  ×  CONDITION  ×  ZONE  ×  DEMAND
--     +  SURCHARGES (same-day, add-ons)  →  clamped to floor/ceiling
--
-- Design rules enforced by this schema:
--   • Every layer of every quote is stored separately (price_quote_audit
--     .breakdown) together with the config version in effect, so any
--     historical price is reconstructable exactly.
--   • All tunable values (band prices, condition multipliers, focused-clean
--     rates, membership rates, add-ons, same-day fee, demand weights/bounds,
--     floors, ceiling, override band, lock window) live in a VERSIONED config
--     row — dynamic-pricing code hardcodes none of them.
--   • Config versions are immutable: changing configuration INSERTS a new row
--     and flips is_active. Old quotes keep pointing at the version they used.
--   • Two conflicting base tables are on file (Training Guide vs the later
--     sqft model). The Training Guide is seeded as authoritative per current
--     staff guidance, but base_tables.reconciled=false keeps the discrepancy
--     banner up in the admin pricing view until an admin confirms.
--
-- ═════════════════════════════════════════════════════════════════════════
-- 1. Zones
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.pricing_zones (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,               -- 'A' | 'B' | 'C' | admin-defined
  name text NOT NULL,
  description text,
  -- Fixed, market-based multiplier. Deliberately independent from the demand
  -- layer: zone reflects geography/market, demand reflects capacity/timing.
  multiplier numeric(6,4) NOT NULL DEFAULT 1.0,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'surcharge_only', 'not_served')),
  min_job_value_cents integer,             -- optional per-zone minimum
  travel_minutes integer,                  -- informational; used in dispatch ranking
  -- Exactly one default zone: any served-but-unmapped zip lands here so a new
  -- zip never breaks a quote.
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pricing_zones_multiplier_chk CHECK (multiplier > 0 AND multiplier < 10)
);

CREATE UNIQUE INDEX IF NOT EXISTS pricing_zones_single_default
  ON public.pricing_zones ((true)) WHERE is_default;

-- A zip belongs to exactly one zone (zip is the PK).
CREATE TABLE IF NOT EXISTS public.pricing_zone_zips (
  zip text PRIMARY KEY CHECK (zip ~ '^[0-9]{5}$'),
  zone_id uuid NOT NULL REFERENCES public.pricing_zones(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pricing_zone_zips_zone ON public.pricing_zone_zips(zone_id);

-- ═════════════════════════════════════════════════════════════════════════
-- 2. Versioned dynamic-pricing configuration
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.dynamic_pricing_config_versions (
  version integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  config jsonb NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  note text,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dynamic_pricing_single_active
  ON public.dynamic_pricing_config_versions ((true)) WHERE is_active;

-- ═════════════════════════════════════════════════════════════════════════
-- 3. Price audit log — every computed quote, fully reconstructable
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.price_quote_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  quote_id uuid,                            -- va_quotes.id when locked/saved
  booking_id uuid,                          -- stamped when a booking charges it
  zip text,
  zone_code text,
  service_type text,
  home_size_id text,
  condition text,
  service_date date,
  membership_plan text,
  -- Full layered breakdown: base, condition, zone, demand, add-ons,
  -- surcharges, clamps — each line with its own amount and reason.
  breakdown jsonb NOT NULL,
  config_version integer,
  -- 'off' | 'shadow' | 'live' | 'exempt_member' | 'exempt_service'
  demand_mode text,
  demand_multiplier numeric(6,4),           -- what was APPLIED
  shadow_demand_multiplier numeric(6,4),    -- what reactive WOULD have applied
  floor_clamped boolean NOT NULL DEFAULT false,
  ceiling_clamped boolean NOT NULL DEFAULT false,
  final_cents integer,
  charged_cents integer,                    -- set when a booking actually charges
  quoted_by text
);

CREATE INDEX IF NOT EXISTS idx_price_quote_audit_created ON public.price_quote_audit(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_quote_audit_booking ON public.price_quote_audit(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_price_quote_audit_quote ON public.price_quote_audit(quote_id) WHERE quote_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_price_quote_audit_clamps ON public.price_quote_audit(created_at DESC)
  WHERE floor_clamped OR ceiling_clamped;

-- ═════════════════════════════════════════════════════════════════════════
-- 4. Price overrides — bounded, reasoned, logged, reportable per VA
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.price_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  quote_id uuid REFERENCES public.va_quotes(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  va_name text NOT NULL,
  original_cents integer NOT NULL,
  override_cents integer NOT NULL,
  delta_percent numeric(7,2) NOT NULL,
  direction text NOT NULL CHECK (direction IN ('up', 'down')),
  reason_code text NOT NULL,
  note text,
  -- applied           — within the configured band, took effect immediately
  -- pending_approval  — beyond the band; quote holds until admin decides
  -- approved/rejected — admin decision (approver + timestamp below)
  status text NOT NULL DEFAULT 'applied'
    CHECK (status IN ('applied', 'pending_approval', 'approved', 'rejected')),
  decided_by text,
  decided_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_price_overrides_va ON public.price_overrides(va_name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_overrides_status ON public.price_overrides(status) WHERE status = 'pending_approval';

-- ═════════════════════════════════════════════════════════════════════════
-- 5. Demand rate-limit state — movement is gradual per (zone, date)
-- ═════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.demand_rate_state (
  zone_id uuid NOT NULL REFERENCES public.pricing_zones(id) ON DELETE CASCADE,
  service_date date NOT NULL,
  multiplier numeric(6,4) NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (zone_id, service_date)
);

-- ═════════════════════════════════════════════════════════════════════════
-- 6. Quote lock + breakdown columns on va_quotes / bookings
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE public.va_quotes
  ADD COLUMN IF NOT EXISTS zone_code text,
  ADD COLUMN IF NOT EXISTS condition text,
  ADD COLUMN IF NOT EXISTS focused_areas jsonb,           -- {areas, bedrooms} for focused cleans
  ADD COLUMN IF NOT EXISTS price_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS pricing_config_version integer,
  ADD COLUMN IF NOT EXISTS quoted_price_cents integer,    -- the LOCKED price
  ADD COLUMN IF NOT EXISTS locked_until timestamptz,      -- quote-lock window end
  ADD COLUMN IF NOT EXISTS demand_multiplier numeric(6,4),
  ADD COLUMN IF NOT EXISTS shadow_demand_multiplier numeric(6,4);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS zone_code text,
  ADD COLUMN IF NOT EXISTS price_condition text,
  ADD COLUMN IF NOT EXISTS price_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS pricing_config_version integer,
  ADD COLUMN IF NOT EXISTS va_quote_id uuid REFERENCES public.va_quotes(id) ON DELETE SET NULL;

-- ═════════════════════════════════════════════════════════════════════════
-- 7. RLS — admin/VA read, admin-only writes (edge functions use service role)
-- ═════════════════════════════════════════════════════════════════════════

ALTER TABLE public.pricing_zones ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_zone_zips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dynamic_pricing_config_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_quote_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.price_overrides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.demand_rate_state ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pricing_zones', 'pricing_zone_zips', 'dynamic_pricing_config_versions',
    'price_quote_audit', 'price_overrides', 'demand_rate_state'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "service_role_all" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "service_role_all" ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
    EXECUTE format('DROP POLICY IF EXISTS "admin_va_read" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "admin_va_read" ON public.%I FOR SELECT TO authenticated USING (public.is_admin_or_va(auth.uid()))', t);
  END LOOP;
END $$;

-- Full admins may manage zones + config + override decisions from the client.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'pricing_zones', 'pricing_zone_zips', 'dynamic_pricing_config_versions', 'price_overrides'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "admin_write" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "admin_write" ON public.%I FOR ALL TO authenticated USING (public.has_role(auth.uid(), ''admin'')) WITH CHECK (public.has_role(auth.uid(), ''admin''))', t);
  END LOOP;
END $$;

-- ═════════════════════════════════════════════════════════════════════════
-- 8. Seed zones + zip mapping (Training Guide zones; unmapped → default B)
-- ═════════════════════════════════════════════════════════════════════════

INSERT INTO public.pricing_zones (code, name, description, multiplier, status, travel_minutes, is_default)
VALUES
  ('A', 'Zone A — Premium', 'Bethesda, Potomac, Chevy Chase, Rockville, Silver Spring', 1.15, 'active', 20, false),
  ('B', 'Zone B — Standard', 'Rest of Montgomery County, Prince George''s County, Columbia, Ellicott City, Laurel, Bowie, College Park', 1.00, 'active', 35, true),
  ('C', 'Zone C — Outer', 'Frederick, Hagerstown, Annapolis, Glen Burnie, Severna Park, Pasadena, Baltimore suburbs, Towson, Catonsville, Dundalk', 0.90, 'active', 55, false)
ON CONFLICT (code) DO NOTHING;

-- Zone A: 20814–20817, 20850–20854, 20815, 20901–20910
INSERT INTO public.pricing_zone_zips (zip, zone_id)
SELECT z, (SELECT id FROM public.pricing_zones WHERE code = 'A')
FROM unnest(ARRAY[
  '20814','20815','20816','20817',
  '20850','20851','20852','20853','20854'
]) AS z
UNION ALL
SELECT lpad(n::text, 5, '0'), (SELECT id FROM public.pricing_zones WHERE code = 'A')
FROM generate_series(20901, 20910) AS n
ON CONFLICT (zip) DO NOTHING;

-- Zone B explicit seeds: Columbia/Ellicott City 21042–21046, Laurel 20707–20708,
-- Bowie 20715–20721, College Park 20740–20742. (The remaining served 207xx/208xx
-- MoCo/PG zips fall to Zone B via the default-zone rule — no need to enumerate.)
INSERT INTO public.pricing_zone_zips (zip, zone_id)
SELECT lpad(n::text, 5, '0'), (SELECT id FROM public.pricing_zones WHERE code = 'B')
FROM generate_series(21042, 21046) AS n
UNION ALL
SELECT lpad(n::text, 5, '0'), (SELECT id FROM public.pricing_zones WHERE code = 'B')
FROM generate_series(20707, 20708) AS n
UNION ALL
SELECT lpad(n::text, 5, '0'), (SELECT id FROM public.pricing_zones WHERE code = 'B')
FROM generate_series(20715, 20721) AS n
UNION ALL
SELECT lpad(n::text, 5, '0'), (SELECT id FROM public.pricing_zones WHERE code = 'B')
FROM generate_series(20740, 20742) AS n
ON CONFLICT (zip) DO NOTHING;

-- Zone C: Frederick 21701–21703, Hagerstown 21740–21742, Annapolis 21401–21409,
-- Glen Burnie 21060–21061, Severna Park 21146, Pasadena 21122,
-- Baltimore area 212xx incl. Towson 21204, Catonsville 21228, Dundalk 21222.
INSERT INTO public.pricing_zone_zips (zip, zone_id)
SELECT lpad(n::text, 5, '0'), (SELECT id FROM public.pricing_zones WHERE code = 'C')
FROM generate_series(21701, 21703) AS n
UNION ALL
SELECT lpad(n::text, 5, '0'), (SELECT id FROM public.pricing_zones WHERE code = 'C')
FROM generate_series(21740, 21742) AS n
UNION ALL
SELECT lpad(n::text, 5, '0'), (SELECT id FROM public.pricing_zones WHERE code = 'C')
FROM generate_series(21401, 21409) AS n
UNION ALL
SELECT lpad(n::text, 5, '0'), (SELECT id FROM public.pricing_zones WHERE code = 'C')
FROM generate_series(21060, 21061) AS n
UNION ALL
SELECT z, (SELECT id FROM public.pricing_zones WHERE code = 'C')
FROM unnest(ARRAY['21146','21122']) AS z
UNION ALL
SELECT lpad(n::text, 5, '0'), (SELECT id FROM public.pricing_zones WHERE code = 'C')
FROM generate_series(21201, 21237) AS n
ON CONFLICT (zip) DO NOTHING;

-- ═════════════════════════════════════════════════════════════════════════
-- 9. Seed config version 1
-- ═════════════════════════════════════════════════════════════════════════
--
-- Prices are cents. The Training Guide table is authoritative
-- (base_tables.authoritative) but reconciled=false keeps the two-tables
-- discrepancy surfaced in the admin pricing view until admin confirms.
-- Demand launches DISABLED with shadow mode ON, per the rollout rule:
-- observe what reactive pricing would have done before it touches a price.

INSERT INTO public.dynamic_pricing_config_versions (config, is_active, note, created_by)
SELECT
$json$
{
  "base_tables": {
    "authoritative": "training_guide",
    "reconciled": false,
    "training_guide": {
      "0_999":     { "standard": 15000, "deep": 22500, "moveInOut": 30000 },
      "1000_1500": { "standard": 18900, "deep": 28400, "moveInOut": 37800 },
      "1501_2000": { "standard": 23900, "deep": 35900, "moveInOut": 47800 },
      "2001_2500": { "standard": 27900, "deep": 41900, "moveInOut": 55800 },
      "2501_3000": { "standard": 33900, "deep": 50900, "moveInOut": 67800 },
      "3001_3500": { "standard": 37900, "deep": 56900, "moveInOut": 75800 },
      "3501_4000": { "standard": 43900, "deep": 65900, "moveInOut": 87800 },
      "4001_4500": { "standard": 48900, "deep": 73400, "moveInOut": 97800 },
      "4501_5000": { "standard": 53900, "deep": 80900, "moveInOut": 107800 },
      "5000_plus": { "standard": 0, "deep": 0, "moveInOut": 0 }
    },
    "later_sqft_model": {
      "0_999":     { "standard": 13500, "deep": 20500 },
      "1000_1500": { "standard": 17000, "deep": 27500 },
      "1501_2000": { "standard": 20500, "deep": 32500 },
      "2001_2500": { "standard": 24000, "deep": 37500 },
      "2501_3000": { "standard": 29000, "deep": 44500 },
      "3001_3500": { "standard": 34500, "deep": 51500 }
    }
  },
  "bands": {
    "0_999":     { "label": "0 – 999 sq ft",       "hours": 2.0, "crew_size": 1 },
    "1000_1500": { "label": "1,000 – 1,500 sq ft", "hours": 2.5, "crew_size": 1 },
    "1501_2000": { "label": "1,501 – 2,000 sq ft", "hours": 3.0, "crew_size": 1 },
    "2001_2500": { "label": "2,001 – 2,500 sq ft", "hours": 3.5, "crew_size": 1 },
    "2501_3000": { "label": "2,501 – 3,000 sq ft", "hours": 4.0, "crew_size": 2 },
    "3001_3500": { "label": "3,001 – 3,500 sq ft", "hours": 4.5, "crew_size": 2 },
    "3501_4000": { "label": "3,501 – 4,000 sq ft", "hours": 5.0, "crew_size": 2 },
    "4001_4500": { "label": "4,001 – 4,500 sq ft", "hours": 5.5, "crew_size": 2 },
    "4501_5000": { "label": "4,501 – 5,000 sq ft", "hours": 6.0, "crew_size": 2 },
    "5000_plus": { "label": "5,000+ sq ft",        "hours": 0,   "crew_size": 2 }
  },
  "condition_multipliers": { "light": 1.0, "standard": 1.25, "heavy": 1.6 },
  "focused_clean": {
    "area_cents": 6500,
    "bedroom_cents": 5000,
    "minimum_cents": 6500,
    "demand_enabled": false
  },
  "add_ons_cents": {
    "fridge": 3000, "oven": 3000, "windows": 4000, "laundry": 3500,
    "changeLinens": 1500, "dishes": 2000, "baseboards": 3500, "blinds": 3000,
    "cabinets": 3500, "walls": 4000, "ceilingFans": 1500, "microwave": 1000,
    "dishwasher": 1500, "garage": 5000, "basement": 7500, "patio": 3500,
    "petHair": 3500, "closets": 3000, "trashHaul": 7500,
    "deepBathroomDetail": 4500, "cateringEvent": 8500
  },
  "move_in_out_free_add_ons": ["fridge", "oven"],
  "membership": {
    "prices_cents": {
      "0_999":     { "monthly": 12900, "biweekly": 19900, "weekly": 35900 },
      "1000_1500": { "monthly": 15900, "biweekly": 24900, "weekly": 44900 },
      "1501_2000": { "monthly": 19900, "biweekly": 31900, "weekly": 56900 },
      "2001_2500": { "monthly": 23900, "biweekly": 36900, "weekly": 65900 },
      "2501_3000": { "monthly": 27900, "biweekly": 44900, "weekly": 79900 },
      "3001_3500": { "monthly": 31900, "biweekly": 49900, "weekly": null },
      "3501_4000": { "monthly": 36900, "biweekly": 57900, "weekly": null },
      "4001_4500": { "monthly": 40900, "biweekly": 64900, "weekly": null },
      "4501_5000": { "monthly": 45900, "biweekly": 71900, "weekly": null }
    },
    "first_month_deep_clean_fee_cents": 7500,
    "demand_exempt": true
  },
  "surcharges": { "same_day_cents": 5000 },
  "demand": {
    "enabled": false,
    "shadow_mode": true,
    "min_multiplier": 0.90,
    "max_multiplier": 1.25,
    "max_delta_per_hour": 0.05,
    "inputs": {
      "capacity_utilization": { "enabled": true, "weight": 0.10 },
      "lead_time":            { "enabled": true, "weight": 0.06 },
      "peak_period":          { "enabled": true, "weight": 0.05 },
      "zone_capacity":        { "enabled": true, "weight": 0.04 }
    },
    "lead_time_short_days": 2,
    "lead_time_long_days": 21,
    "peak_periods": [
      { "type": "weekday", "days": [0, 6], "pressure": 0.6, "label": "Weekend demand" },
      { "type": "month_end", "from_day": 25, "pressure": 0.5, "label": "Month-end move-out season" }
    ]
  },
  "guardrails": {
    "min_effective_hourly_cents": 2200,
    "floor_cents": {},
    "max_total_uplift": 1.35,
    "override_band_percent": 10,
    "quote_lock_hours": 48
  },
  "override_reasons": [
    { "code": "price_match",       "label": "Competitor price match" },
    { "code": "repeat_customer",   "label": "Repeat customer goodwill" },
    { "code": "service_recovery",  "label": "Service recovery / prior issue" },
    { "code": "scope_clarified",   "label": "Scope clarified on call" },
    { "code": "promo_honored",     "label": "Advertised promo honored" },
    { "code": "other",             "label": "Other (note required)" }
  ]
}
$json$::jsonb,
  true,
  'Initial dynamic pricing config — Training Guide base (unreconciled), demand OFF + shadow ON',
  'migration'
WHERE NOT EXISTS (SELECT 1 FROM public.dynamic_pricing_config_versions);
