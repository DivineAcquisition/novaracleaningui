-- Billing contact may differ from the signer (Property Management Services
-- Agreement Section 6). Cycle and net terms already live on the account;
-- these columns hold the person invoices actually go to.

ALTER TABLE public.property_manager_accounts
  ADD COLUMN IF NOT EXISTS billing_contact_name text,
  ADD COLUMN IF NOT EXISTS billing_contact_email text,
  ADD COLUMN IF NOT EXISTS billing_contact_phone text;

COMMENT ON COLUMN public.property_manager_accounts.billing_contact_email IS
  'Invoicing contact; may differ from the agreement signer.';
