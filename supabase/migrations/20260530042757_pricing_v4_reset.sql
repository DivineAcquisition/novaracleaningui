-- ─── Pricing v4 reset ────────────────────────────────────────────────────
-- Restores `pricing_config` to the documented one-time defaults so any
-- admin tool reading from this table sees the same numbers
-- `_shared/pricing.ts` produces. We do NOT delete the recurring
-- frequencies — membership pricing has its own rail and is untouched.
--
-- v4 base table (Zone B standard clean, one-time, no add-ons):
--   0_999       $150
--   1000_1499   $190
--   1500_1999   $225
--   2000_2499   $260
--   2500_2999   $300
--   3000_3499   $340
--   3500_3999   $375
--   4000+       $415 (treated as 4000-4500 bucket)
--
-- The shared module uses "1000_1500" / "1501_2000" etc. as the home_size_id
-- (underscore). `pricing_config.tier` historically used hyphens ("1000-1499"),
-- so we keep the existing tier strings here for backwards compatibility
-- with any UI that still reads the table.

UPDATE public.pricing_config SET price_cents = 15000 WHERE tier = '0-999'      AND frequency = 'one-time';
UPDATE public.pricing_config SET price_cents = 19000 WHERE tier = '1000-1499'  AND frequency = 'one-time';
UPDATE public.pricing_config SET price_cents = 22500 WHERE tier = '1500-1999'  AND frequency = 'one-time';
UPDATE public.pricing_config SET price_cents = 26000 WHERE tier = '2000-2499'  AND frequency = 'one-time';
UPDATE public.pricing_config SET price_cents = 30000 WHERE tier = '2500-2999'  AND frequency = 'one-time';
UPDATE public.pricing_config SET price_cents = 34000 WHERE tier = '3000-3499'  AND frequency = 'one-time';
UPDATE public.pricing_config SET price_cents = 37500 WHERE tier = '3500-3999'  AND frequency = 'one-time';
UPDATE public.pricing_config SET price_cents = 41500 WHERE tier = '4000+'      AND frequency = 'one-time';

-- Deactivate every DB-driven promo code. v4 has exactly three discounts
-- and they're all baked into the per-service-tier rate; promo_codes are
-- no longer honored at checkout (create-payment-intent and Checkout.tsx
-- already ignore them, but flipping `active=false` makes admin tools
-- stop suggesting them too).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='promo_codes') THEN
    UPDATE public.promo_codes SET active = false WHERE active = true;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
