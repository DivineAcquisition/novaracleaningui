-- Weekly report Airtable target.
-- AIRTABLE_BASE_ID is intentionally empty (other syncs no-op until filled).
-- weekly-report-generate falls back to AIRTABLE_REVENUE_OPS_BASE_ID, which is
-- the existing "NVC | Client & Revenue Ops" base (same as payroll ops).
-- Table "Weekly Reports" (tbl2iYc2CXCN1et0s) merges on Period Start.

INSERT INTO public.app_secrets (key, value, description)
VALUES (
  'AIRTABLE_REVENUE_OPS_BASE_ID',
  'appoUuFQZQfCyKGlw',
  'NVC Client & Revenue Ops Airtable base. Used by weekly-report-generate when AIRTABLE_BASE_ID is empty.'
)
ON CONFLICT (key) DO UPDATE
SET description = EXCLUDED.description,
    value = CASE
      WHEN btrim(COALESCE(public.app_secrets.value, '')) = '' THEN EXCLUDED.value
      ELSE public.app_secrets.value
    END;
