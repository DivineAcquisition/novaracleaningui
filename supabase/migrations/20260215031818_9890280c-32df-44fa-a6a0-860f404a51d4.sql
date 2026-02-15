UPDATE service_coverage_zones
SET is_active = true
WHERE state = 'MD' AND is_active = false;