-- The service, host, and partner agreements state that the company maintains
-- commercial general liability insurance. That is the basis for this claim.
-- Licensed and background-checked stay off the list.

UPDATE public.app_settings
SET value = coalesce(value, '[]'::jsonb) || jsonb_build_array(
  jsonb_build_object(
    'id', 'insured',
    'phrase', 'insured',
    'basis', 'The service, host, and partner agreements state that Novara Cleaning LLC maintains commercial general liability insurance.',
    'conditional', false,
    'requiredWording', '',
    'active', true
  )
)
WHERE key = 'email_approved_claims'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(coalesce(value, '[]'::jsonb)) AS claim
    WHERE claim->>'id' = 'insured'
  );
