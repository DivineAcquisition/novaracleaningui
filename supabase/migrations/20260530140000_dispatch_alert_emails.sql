INSERT INTO public.app_secrets (key, value, description)
VALUES
  (
    'DISPATCH_ALERT_EMAILS',
    '',
    'Comma-separated emails for urgent no-cleaner dispatch alerts (in addition to all admin + va users in user_roles).'
  )
ON CONFLICT (key) DO NOTHING;
