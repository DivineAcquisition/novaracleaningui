-- Separate Sales Pipeline opportunity from Job Dispatch opportunity on bookings.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS ghl_sales_opportunity_id TEXT;

COMMENT ON COLUMN public.bookings.ghl_sales_opportunity_id IS
  'GHL Sales Pipeline opportunity id (VA/lead booking). Job Dispatch uses ghl_opportunity_id.';

CREATE INDEX IF NOT EXISTS bookings_ghl_sales_opp_idx
  ON public.bookings (ghl_sales_opportunity_id)
  WHERE ghl_sales_opportunity_id IS NOT NULL;

-- GHL sub-account user provisioning for contractors
INSERT INTO public.app_secrets (key, value, description)
VALUES
  (
    'GHL_USER_TEMPLATE_EMAIL',
    'maliksannie7@gmail.com',
    'GHL user whose role/permissions/scopes are cloned when provisioning contractor portal users.'
  )
ON CONFLICT (key) DO UPDATE SET
  description = EXCLUDED.description,
  value = CASE
    WHEN public.app_secrets.value IS NULL OR public.app_secrets.value = '' THEN EXCLUDED.value
    ELSE public.app_secrets.value
  END;

NOTIFY pgrst, 'reload schema';
