-- Promotional mail is sent from hello@ and replies there.
-- Keep that address on the monitored list so those messages can send.

UPDATE public.app_settings
SET value = jsonb_set(
  value,
  '{monitoredInboxes}',
  (value->'monitoredInboxes') || jsonb_build_array('hello@novaracleaning.com')
)
WHERE key = 'email_business_identity'
  AND jsonb_typeof(value->'monitoredInboxes') = 'array'
  AND NOT (value->'monitoredInboxes') @> jsonb_build_array('hello@novaracleaning.com');
