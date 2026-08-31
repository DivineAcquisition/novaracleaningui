-- Add Elkridge, Maryland (ZIP 21075) to the active service area.
-- Howard County — adjacent to Columbia / Ellicott City (Zone B).

INSERT INTO public.service_coverage_zones (
  zip_code, city, state, county, tier, tier_label, is_active, pricing_multiplier
)
VALUES (
  '21075',
  'Elkridge',
  'MD',
  'Howard County',
  'tier_2',
  'Upper-Middle',
  true,
  1.05
)
ON CONFLICT (zip_code) DO UPDATE SET
  city = EXCLUDED.city,
  state = EXCLUDED.state,
  county = EXCLUDED.county,
  tier = EXCLUDED.tier,
  tier_label = EXCLUDED.tier_label,
  is_active = true,
  pricing_multiplier = EXCLUDED.pricing_multiplier,
  updated_at = NOW();

-- Explicit Zone B mapping (same band as Columbia / Ellicott City).
INSERT INTO public.pricing_zone_zips (zip, zone_id)
SELECT '21075', id
FROM public.pricing_zones
WHERE code = 'B'
ON CONFLICT (zip) DO UPDATE SET
  zone_id = EXCLUDED.zone_id;

UPDATE public.pricing_zones
SET
  description = 'Rest of Montgomery County, Prince George''s County, Columbia, Ellicott City, Elkridge, Laurel, Bowie, College Park',
  updated_at = NOW()
WHERE code = 'B';
