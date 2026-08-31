-- Add promo code enhancement columns for holiday promotions
ALTER TABLE promo_codes 
ADD COLUMN IF NOT EXISTS min_profit_margin_percent integer DEFAULT 20,
ADD COLUMN IF NOT EXISTS applies_to text DEFAULT 'all' CHECK (applies_to IN ('all', 'new_customers', 'returning_customers')),
ADD COLUMN IF NOT EXISTS max_uses_per_customer integer,
ADD COLUMN IF NOT EXISTS total_uses integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS max_total_uses integer;

-- Create index for faster promo code lookups
CREATE INDEX IF NOT EXISTS idx_promo_codes_code_active ON promo_codes(code, active);

-- Insert holiday promo codes
INSERT INTO promo_codes (code, type, value, active, expires_at, min_profit_margin_percent, applies_to, max_uses_per_customer, max_total_uses)
VALUES 
  ('HOLIDAY25', 'percent', 25, true, '2026-01-05 23:59:59', 20, 'new_customers', 1, 500),
  ('JOLLY20', 'percent', 20, true, '2026-01-05 23:59:59', 20, 'returning_customers', 3, 1000),
  ('NEWYEAR15', 'percent', 15, true, '2026-01-10 23:59:59', 20, 'all', null, null)
ON CONFLICT (code) DO UPDATE SET
  type = EXCLUDED.type,
  value = EXCLUDED.value,
  active = EXCLUDED.active,
  expires_at = EXCLUDED.expires_at,
  min_profit_margin_percent = EXCLUDED.min_profit_margin_percent,
  applies_to = EXCLUDED.applies_to,
  max_uses_per_customer = EXCLUDED.max_uses_per_customer,
  max_total_uses = EXCLUDED.max_total_uses;