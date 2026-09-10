-- Seed the property-manager onboarding link template when it is missing.
-- Live already has this row; WHERE NOT EXISTS keeps local `db reset` and
-- future environments in sync without rewriting a published version.

INSERT INTO public.partnership_message_templates
  (key, version, is_current, role, priority, channels, subject, html, sms_body, description)
SELECT
  'property_manager_onboarding_link',
  1,
  true,
  'partner',
  'standard',
  ARRAY['email', 'sms']::text[],
  'Your unit registry for {{company_name}} is ready to review',
  '<p>Hi {{first_name}},</p><p>Your unit registry for <strong>{{company_name}}</strong> is ready to review.</p>{{rate_summary_html}}<p>Each unit has a standing rate we set once. From then on you book a turnover by picking the unit, the service, and the date it has to be ready by.</p><p><a href="{{link}}">Review and confirm your registry</a></p><p>It''s one page at a time and you can stop and come back — the same link returns you to where you left off.</p>',
  'Novara Cleaning: your unit registry and standing rates are ready to review: {{link}}',
  'Tokenized property-manager onboarding link (Legal → Unit Registry & Rates → Billing & Portal)'
WHERE NOT EXISTS (
  SELECT 1 FROM public.partnership_message_templates x WHERE x.key = 'property_manager_onboarding_link'
);
