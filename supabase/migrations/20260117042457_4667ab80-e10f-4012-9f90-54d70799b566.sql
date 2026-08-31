-- Enable pg_net extension if not already enabled (needed for HTTP calls from cron)
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Schedule abandoned cart check every 4 hours
SELECT cron.schedule(
  'check-abandoned-carts-job',
  '0 */4 * * *',
  $$
  SELECT net.http_post(
    url := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/check-abandoned-carts',
    headers := '{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);