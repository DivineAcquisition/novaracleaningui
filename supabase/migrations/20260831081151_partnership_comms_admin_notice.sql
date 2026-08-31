-- Admin-internal notice template + SMS on host turnover completion.
-- Inserts only when missing; publishing a new current version of
-- host_turnover_completed does not rewrite historical partnership_messages.

INSERT INTO public.partnership_message_templates
  (key, version, is_current, role, priority, channels, subject, html, sms_body, description)
SELECT
  'admin_internal_notice', 1, true, 'admin', 'standard', ARRAY['email']::text[],
  '{{subject_line}}',
  '{{body_html}}',
  NULL,
  'Internal admin / VA notices (host flags, proposal owner nudges)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.partnership_message_templates x WHERE x.key = 'admin_internal_notice'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.partnership_message_templates
    WHERE key = 'host_turnover_completed' AND is_current AND sms_body IS NULL
  ) THEN
    UPDATE public.partnership_message_templates
      SET is_current = false
      WHERE key = 'host_turnover_completed' AND is_current;

    INSERT INTO public.partnership_message_templates
      (key, version, is_current, role, priority, channels, subject, html, sms_body, description)
    VALUES (
      'host_turnover_completed', 2, true, 'partner', 'routine', ARRAY['email','sms']::text[],
      'Turnover complete — {{property}}',
      '<p>Hi {{first_name}},</p><p>Your turnover is guest-ready. Before/after documentation is in your portal.</p><p><a href="{{link}}">View documentation</a></p>',
      '{{first_name}}, {{property}} is guest-ready. Photos: {{link}}',
      'Host completion notice — email + SMS'
    );
  END IF;
END $$;
