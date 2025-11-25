-- Enable pg_cron extension
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily cleanup job at 2 AM
SELECT cron.schedule(
  'cleanup-old-availability-slots',
  '0 2 * * *',
  $$
  SELECT
    net.http_post(
        url:='https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/cleanup-old-slots',
        headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I"}'::jsonb,
        body:='{"scheduled": true}'::jsonb
    ) as request_id;
  $$
);