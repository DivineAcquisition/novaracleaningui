INSERT INTO public.partnership_message_templates
  (key, version, is_current, role, priority, channels, subject, html, sms_body, description)
SELECT * FROM (VALUES
(
  'host_onboarding_link', 1, true, 'partner', 'standard', ARRAY['email','sms']::text[],
  'Your Novara host setup is ready',
  '<p>Hi {{first_name}},</p><p>Your per-turnover rates are set. Review and sign the Host Partnership Agreement, confirm each property, and save a payment method — all on one page.</p>{{rate_summary_html}}<p><a href="{{link}}">Open your setup page</a></p><p>The same link brings you back if you need to step away.</p>',
  '{{first_name}}, your Novara Host Partnership Agreement (with your rates) is ready: {{link}}',
  'Tokenized host onboarding link'
),
(
  'host_application_received', 1, true, 'partner', 'standard', ARRAY['email','sms']::text[],
  'We''ve got your Novara host application',
  '<p>Hi {{first_name}},</p><p>Thanks for applying. We''ll set your per-turnover rates and send your Host Partnership Agreement to e-sign within 24 hours.</p>',
  'Thanks {{first_name}} — we received your Novara host application. Rates and agreement follow within 24 hours.',
  'Host apply-form confirmation'
),
(
  'host_agreement_signed', 1, true, 'partner', 'standard', ARRAY['email','sms']::text[],
  'You''re active — welcome to Novara',
  '<p>Hi {{first_name}},</p><p>Your Host Partnership Agreement is signed and your properties are active. Request a turnover anytime from your portal.</p><p><a href="{{link}}">Open the host portal</a></p>',
  'You''re all set, {{first_name}}! Request a turnover anytime: {{link}}',
  'Host agreement signed'
),
(
  'host_turnover_confirmed', 1, true, 'partner', 'standard', ARRAY['email','sms']::text[],
  'Turnover confirmed — {{property}} on {{date}}',
  '<p>Hi {{first_name}},</p><p>Your turnover is booked. We''re assigning a crew and will update you when it''s confirmed.</p><p>{{property}} · {{date}} · {{window}} · {{price}}</p>',
  'Payment received — your {{date}} turnover at {{property}} is booked.',
  'Host turnover request confirmation'
),
(
  'host_turnover_cancelled', 1, true, 'partner', 'standard', ARRAY['email','sms']::text[],
  'Turnover cancelled — {{property}}',
  '<p>Hi {{first_name}},</p><p>Your turnover has been cancelled.{{fee_html}}</p><p>{{property}} · {{date}}</p>',
  'Your turnover at {{property}} on {{date}} is cancelled.{{fee_sms}}',
  'Host cancellation confirmation with auto-calculated fee'
),
(
  'host_turnover_rescheduled', 1, true, 'partner', 'standard', ARRAY['email','sms']::text[],
  'Turnover rescheduled — {{property}} → {{date}}',
  '<p>Hi {{first_name}},</p><p>Your turnover has been moved.{{fee_html}}</p><p>{{property}} · {{date}} · {{window}}</p>',
  'Your turnover at {{property}} is now {{date}}.',
  'Host reschedule confirmation'
),
(
  'host_turnover_assigned', 1, true, 'partner', 'standard', ARRAY['email','sms']::text[],
  'Your turnover is assigned — {{property}}',
  '<p>Hi {{first_name}},</p><p>A crew is assigned for your turnover. We''ll have the property guest-ready by the end of your window. Day-of coordination stays on a relay channel — not a personal number.</p><p>{{property}} · {{date}} · {{window}}</p>',
  'Your turnover for {{property}} on {{date}} is confirmed and assigned. We''ll have it guest-ready by the end of your window.',
  'Host assignment notice — no crew contact'
),
(
  'host_turnover_completed', 1, true, 'partner', 'routine', ARRAY['email']::text[],
  'Turnover complete — {{property}}',
  '<p>Hi {{first_name}},</p><p>Your turnover is guest-ready. Before/after documentation is in your portal.</p><p><a href="{{link}}">View documentation</a></p>',
  NULL,
  'Host completion notice'
),
(
  'host_payment_link', 1, true, 'partner', 'standard', ARRAY['email','sms']::text[],
  'Pay to confirm your turnover — {{property}}',
  '<p>Hi {{first_name}},</p><p>Confirm this turnover with the secure payment link.</p><p><a href="{{link}}">Pay and confirm</a></p>',
  'Novara: pay to confirm your {{date}} turnover at {{property}}: {{link}}',
  'Host payment link'
),
(
  'portal_magic_link', 1, true, 'partner', 'standard', ARRAY['email','sms']::text[],
  'Your Novara partner portal sign-in link',
  '<p>Hi {{first_name}},</p><p>Tap below to sign in to your Novara partner portal. No password is needed.</p><p><a href="{{link}}">Sign in</a></p><p>This link expires in {{expires_minutes}} minutes and can only be used once.</p>',
  'Novara Cleaning: your partner portal sign-in link (expires in {{expires_minutes}} min): {{link}}',
  'Passwordless portal magic link'
),
(
  'commercial_proposal_intake', 1, true, 'partner', 'standard', ARRAY['email']::text[],
  'We received your cleaning proposal request',
  '<p>Hi {{first_name}},</p><p>Thanks — your request is pending while we assign a walkthrough agent for {{address}}.</p>',
  NULL,
  'Proposal request intake confirmation'
),
(
  'walkthrough_agent_assignment', 1, true, 'walkthrough_agent', 'urgent', ARRAY['email','sms']::text[],
  'Walkthrough assigned — {{address}}',
  '<p>Hi {{first_name}},</p><p>You''re assigned to document {{address}}{{when_html}}.</p><p>Open the property-type checklist (tokenized):</p><p><a href="{{link}}">Open walkthrough checklist</a></p>',
  'Novara walkthrough assigned: {{address}}. Checklist: {{link}}',
  'Walkthrough agent assignment — email + SMS, urgent'
),
(
  'walkthrough_scheduled', 1, true, 'partner', 'standard', ARRAY['email']::text[],
  'Walkthrough scheduled — {{address}}',
  '<p>Hi {{first_name}},</p><p>Your walkthrough is scheduled{{when_html}} at {{address}}.</p>',
  NULL,
  'Walkthrough scheduled confirmation to requester'
),
(
  'walkthrough_agent_reminder', 1, true, 'walkthrough_agent', 'urgent', ARRAY['email','sms']::text[],
  'Walkthrough reminder — {{address}}',
  '<p>Hi {{first_name}},</p><p>Reminder: walkthrough at {{address}} {{when}}.</p><p><a href="{{link}}">Open checklist</a></p>',
  'Novara: walkthrough reminder — {{address}}, {{when}}. {{link}}',
  'Time-critical walkthrough reminder'
),
(
  'commercial_proposal_link', 1, true, 'partner', 'standard', ARRAY['email']::text[],
  'Your Novara pricing proposal',
  '<p>Hi {{first_name}},</p><p>Review non-binding pricing for {{business_name}}:</p><p><a href="{{link}}">Open your proposal</a></p>',
  NULL,
  'Commercial proposal tokenized link'
),
(
  'commercial_request_changes', 1, true, 'admin', 'standard', ARRAY['email']::text[],
  'Changes requested — {{business_name}}',
  '<p><strong>{{first_name}}</strong> asked for changes to {{business_name}}.</p><p style="border-left:3px solid #7c3aed;padding-left:12px;white-space:pre-wrap">{{note}}</p>',
  NULL,
  'Request Changes routed to admin'
),
(
  'commercial_onboarding_link', 1, true, 'partner', 'standard', ARRAY['email','sms']::text[],
  'Getting {{business_name}} set up — Novara Cleaning',
  '<p>Hi {{first_name}},</p><p>Everything to get <strong>{{business_name}}</strong> started is on one page: pricing review, agreement, billing, then portal access.</p><p><a href="{{link}}">Open your setup page</a></p>',
  'Novara Cleaning: here''s everything to get {{business_name}} started: {{link}}',
  'Consolidated commercial onboarding session link'
),
(
  'coi_expiry_admin', 1, true, 'admin', 'standard', ARRAY['email']::text[],
  'COI {{milestone}} — {{business_name}}',
  '<p>{{detail}}</p><p>Upload the renewed certificate under Commercial → Compliance. A valid expiry lifts the block.</p>',
  NULL,
  'COI 90/30/15/7 escalation to admin / assigned VA'
),
(
  'coi_delivery_client', 1, true, 'partner', 'standard', ARRAY['email']::text[],
  'Certificate of insurance — NovaraCleaning LLC',
  '<p>Hi {{first_name}},</p><p>Attached is NovaraCleaning''s current certificate of insurance for <strong>{{business_name}}</strong>.</p><p>Valid through {{expires}}.</p>',
  NULL,
  'Company COI delivery on signature'
),
(
  'crew_lead_heads_up', 1, true, 'partner', 'urgent', ARRAY['email','sms']::text[],
  'Update on today''s cleaning',
  '<p>Hi {{first_name}},</p><p>{{message}}</p><p>Reply to this email and it reaches the conversation on your account.</p>',
  '{{message}}',
  'Crew-lead delay/scope flag to the commercial client — urgent, quiet-hours exempt'
),
(
  'host_calendar_link', 1, true, 'partner', 'standard', ARRAY['email','sms']::text[],
  'Your Novara weekly cleaning scheduler',
  '<p>Hi {{first_name}},</p><p>Schedule your short-term-rental turnovers for the week:</p><p><a href="{{link}}">Open my weekly scheduler</a></p>',
  'Hi {{first_name}}! Here''s your Novara weekly cleaning scheduler: {{link}}',
  'Host weekly calendar / scheduler link'
),
(
  'commercial_proposal_expiry', 1, true, 'partner', 'routine', ARRAY['email']::text[],
  'Your Novara proposal is still open',
  '<p>Hi {{first_name}},</p><p>Your pricing proposal for {{business_name}} is still available:</p><p><a href="{{link}}">Open proposal</a></p>',
  NULL,
  'Proposal expiry reminder'
)
) AS t(key, version, is_current, role, priority, channels, subject, html, sms_body, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.partnership_message_templates x WHERE x.key = t.key
);

-- Sweep queued / retry rows every minute.
DO $$
DECLARE
  v_supabase_url text;
  v_anon_key text;
  v_job_id bigint;
BEGIN
  SELECT value INTO v_supabase_url FROM public.app_secrets WHERE key = 'SUPABASE_URL';
  IF v_supabase_url IS NULL OR length(v_supabase_url) = 0 THEN
    v_supabase_url := 'https://sxdraeptzuamsgjcvfeg.supabase.co';
  END IF;
  SELECT value INTO v_anon_key FROM public.app_secrets WHERE key = 'SUPABASE_ANON_KEY';

  SELECT jobid INTO v_job_id FROM cron.job WHERE jobname = 'partnership-comms-sweep';
  IF v_job_id IS NOT NULL THEN
    PERFORM cron.unschedule('partnership-comms-sweep');
  END IF;

  PERFORM cron.schedule(
    'partnership-comms-sweep',
    '* * * * *',
    format(
      $cron$
        SELECT net.http_post(
          url := '%s/functions/v1/partnership-comms-sweep',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || coalesce(%L::text, '')
          ),
          body := jsonb_build_object('source', 'pg_cron')
        );
      $cron$,
      v_supabase_url,
      coalesce(v_anon_key, '')
    )
  );
EXCEPTION WHEN undefined_table OR undefined_function OR insufficient_privilege THEN
  RAISE NOTICE 'pg_cron unavailable — partnership-comms-sweep not scheduled.';
END $$;
