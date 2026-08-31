-- First-clean deep ($75 Glow reset) is a catalog add-on AND a scope-adjustment
-- reason so VAs can apply the same prompt on Bookings, Internal Booking, and
-- a job that skipped it at signup.

INSERT INTO public.scope_adjustment_reasons
  (code, label, customer_phrase, internal_hint, customer_facing, suggests_service_type, service_label_override, sort_order)
VALUES
  ('first_clean_deep', 'First-clean deep (skipped at booking)',
   'a first-clean deep reset was needed — the home had not been professionally deep cleaned recently',
   'Customer declined the $75 first-clean deep at Glow signup. Add the catalog add-on (+$75) or reclassify to Deep for heavier condition.',
   TRUE, NULL, NULL, 65)
ON CONFLICT (code) DO UPDATE SET
  label = EXCLUDED.label,
  customer_phrase = EXCLUDED.customer_phrase,
  internal_hint = EXCLUDED.internal_hint,
  customer_facing = EXCLUDED.customer_facing,
  suggests_service_type = EXCLUDED.suggests_service_type,
  service_label_override = EXCLUDED.service_label_override,
  sort_order = EXCLUDED.sort_order,
  active = TRUE,
  updated_at = NOW();
