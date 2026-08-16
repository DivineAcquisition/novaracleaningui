-- Pest — Light and Mold — Minor (surface) are catalog add-ons AND
-- scope-adjustment reasons so VAs can apply the same in-scope findings
-- from Bookings / Internal Booking / scope adjustment that cleaners flag
-- from the checklist.

INSERT INTO public.scope_adjustment_reasons
  (code, label, customer_phrase, internal_hint, customer_facing, suggests_service_type, service_label_override, sort_order)
VALUES
  ('pest_light', 'Pest — Light',
   'light pest presence (dead bugs, webs, or minor trails) that was handled as part of the clean',
   'In-scope confined surface work. Adds the Pest — Light catalog add-on ($65, Focused Clean area rate). Active infestation or bed bugs are stop-and-report — do not use this reason.',
   TRUE, NULL, NULL, 72),
  ('mold_minor', 'Mold — Minor (surface)',
   'a small area of surface mold that was handled as part of the clean',
   'In-scope confined surface work. Adds the Mold — Minor catalog add-on ($65, Focused Clean area rate). Spread work may instead use Heavy / Excessive Condition. Over ~10 sq ft, porous material, or hidden-source odor is stop-and-report.',
   TRUE, NULL, NULL, 73)
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
