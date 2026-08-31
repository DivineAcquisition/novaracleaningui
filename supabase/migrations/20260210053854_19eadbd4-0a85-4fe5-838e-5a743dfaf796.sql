INSERT INTO bookings (
  first_name, last_name, email, phone, address, city, state, zip_code,
  service_type, home_size_id, service_date, time_slot,
  base_price_cents, deposit_cents, total_estimate_cents, status,
  payment_option, bedrooms, bathrooms, dwelling_type, add_ons, membership_plan
) VALUES (
  'Test', 'Webhook', 'test-webhook@novaracleaning.com', '(301) 555-0199',
  '123 Webhook Test Lane', 'Bethesda', 'MD', '20814',
  'standard', 'md_2br_1ba', '2026-02-15', '8-12',
  18900, 3900, 18900, 'confirmed',
  'deposit', 2, 1, 'house', ARRAY['fridge','oven'], 'none'
);