-- Airtable insight mirror configuration.
--
-- Novara pushes job + payroll data to Airtable as a secondary "insight"
-- database. The integration is gated on these secrets — until AIRTABLE_API_KEY
-- and AIRTABLE_BASE_ID are filled in, all Airtable sync calls no-op safely.
--
-- Fill the values with SQL (or via the Supabase dashboard / Edge Function env):
--   update public.app_secrets set value = 'pat...' where key = 'AIRTABLE_API_KEY';
--   update public.app_secrets set value = 'app...' where key = 'AIRTABLE_BASE_ID';
--
-- The API key must be an Airtable Personal Access Token with the
-- data.records:read and data.records:write scopes on the target base.

INSERT INTO public.app_secrets (key, value, description)
VALUES
  ('AIRTABLE_API_KEY', '', 'Airtable Personal Access Token (pat…) with data.records:read + data.records:write on the base.'),
  ('AIRTABLE_BASE_ID', '', 'Airtable base id (app…) that holds the Jobs + Payroll tables.'),
  ('AIRTABLE_JOBS_TABLE', 'Jobs', 'Airtable table name for job/booking data (default "Jobs"). Merge field: "Booking ID".'),
  ('AIRTABLE_PAYROLL_TABLE', 'Payroll', 'Airtable table name for payroll/payout data (default "Payroll"). Merge field: "Payout ID".')
ON CONFLICT (key) DO NOTHING;
