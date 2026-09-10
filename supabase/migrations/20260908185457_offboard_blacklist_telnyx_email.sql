-- Send Telnyx SMS + HR email (CC contact@) about the temporary blacklist.
-- Reason in the email: malpractice — assigned a job and went no-contact.
-- Safe to re-run: skips a recipient if the same notice already went out today.
-- Secrets stay in app_secrets / function env; they are never written to events.
-- Already applied on hosted as supabase_migrations 20260908185457.

DO $$
DECLARE
  rec record;
  sms_resp extensions.http_response;
  email_resp extensions.http_response;
  resend_key text;
  anon_key text;
  greeting text;
  sms_text text;
  email_html text;
  email_text text;
  sms_ok boolean;
  email_ok boolean;
  sms_from text;
  sms_err text;
  email_id text;
  email_err text;
  eligible_label text := 'December 7, 2026';
BEGIN
  PERFORM extensions.http_set_curlopt('CURLOPT_TIMEOUT', '45');
  PERFORM extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT', '15');

  SELECT value INTO resend_key FROM public.app_secrets WHERE key = 'RESEND_API_KEY';
  anon_key := coalesce(
    nullif(current_setting('app.settings.supabase_anon_key', true), ''),
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I'
  );

  UPDATE public.cleaners c
  SET
    termination_reason = 'job_abandonment',
    rehire_notes = 'Temporary blacklist. Malpractice: assigned a job and went no-contact. Reapply eligible ' || eligible_label || '.',
    updated_at = now()
  WHERE lower(c.email) IN (
    'isaac.ricardo.bell.jr@gmail.com',
    'belltre933@gmail.com',
    'ottilia.williams83@gmail.com'
  );

  UPDATE public.cleaner_terminations t
  SET
    reason = 'job_abandonment',
    reason_label = 'Malpractice — assigned a job and went no-contact',
    notes = 'Malpractice: assigned a job and went no-contact. Temporary blacklist through '
      || eligible_label || '. SMS (Telnyx) + email (CC contact@novaracleaning.com).'
  WHERE t.cleaner_id IN (
    SELECT id FROM public.cleaners
    WHERE lower(email) IN (
      'isaac.ricardo.bell.jr@gmail.com',
      'belltre933@gmail.com',
      'ottilia.williams83@gmail.com'
    )
  )
  AND t.created_at > now() - interval '1 day';

  FOR rec IN
    SELECT
      c.id,
      c.first_name,
      c.last_name,
      concat_ws(' ', c.first_name, c.last_name) AS full_name,
      c.email,
      c.phone,
      CASE
        WHEN lower(c.email) = 'isaac.ricardo.bell.jr@gmail.com' THEN 'Isaac'
        WHEN lower(c.email) = 'belltre933@gmail.com' THEN 'Isaac'
        ELSE coalesce(c.first_name, 'there')
      END AS greeting
    FROM public.cleaners c
    WHERE lower(c.email) IN (
      'isaac.ricardo.bell.jr@gmail.com',
      'belltre933@gmail.com',
      'ottilia.williams83@gmail.com'
    )
  LOOP
    greeting := rec.greeting;
    sms_text :=
      'Novara Cleaning: Your contractor engagement ended 9/8/2026 after you were assigned a job and went no-contact. '
      || 'You are on a temporary do-not-hire list until Dec 7, 2026. Portal access and job offers are closed. '
      || 'Pay already earned will still be paid. Questions: hr@novaracleaning.com';

    email_text :=
      'Dear ' || greeting || ',' || E'\n\n'
      || 'This letter confirms that your independent-contractor engagement with Novara Cleaning is terminated effective September 8, 2026.' || E'\n\n'
      || 'Reason: Malpractice — you were assigned a job and went no-contact.' || E'\n\n'
      || 'Following this, you have been placed on Novara Cleaning''s temporary do-not-hire list. You will not be eligible for future engagement until December 7, 2026. After that date, rehire is subject to review.' || E'\n\n'
      || 'Your access to the contractor portal, job offers, and payouts has been discontinued, and any upcoming jobs assigned to you have been reassigned. Any payouts already earned for completed work will be settled per our standard schedule.' || E'\n\n'
      || 'Please return any company materials in your possession and direct questions to hr@novaracleaning.com.' || E'\n\n'
      || 'Sincerely,' || E'\n'
      || 'Novara Cleaning — Human Resources';

    email_html := format($html$
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:600px;margin:0 auto;padding:28px;color:#0f172a;line-height:1.6">
    <div style="border-bottom:2px solid #5C0FFE;padding-bottom:12px;margin-bottom:20px">
      <span style="font-weight:800;font-size:18px;color:#5C0FFE">Novara Cleaning</span>
      <span style="float:right;color:#64748b;font-size:12px">Human Resources</span>
    </div>
    <p style="margin:0 0 4px;color:#64748b;font-size:13px">September 8, 2026</p>
    <h2 style="margin:0 0 16px;font-size:18px">Notice of Termination of Contractor Engagement</h2>
    <p style="margin:0 0 14px">Dear %s,</p>
    <p style="margin:0 0 14px">
      This letter confirms that your independent-contractor engagement with Novara Cleaning is
      terminated effective <strong>September 8, 2026</strong>.
    </p>
    <p style="margin:0 0 14px">
      <strong>Reason:</strong> Malpractice — you were assigned a job and went no-contact.
    </p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:14px;margin:0 0 14px">
      <p style="margin:0;color:#991b1b"><strong>Temporary do-not-hire notice:</strong> Following this termination, you have been
      placed on Novara Cleaning's temporary do-not-hire list. You will not be eligible for future
      engagement until <strong>December 7, 2026</strong>. After that date, any rehire is subject to review.</p>
    </div>
    <p style="margin:0 0 14px">
      Effective on the date above, your access to the contractor portal, job offers, and payouts will be
      discontinued, and any upcoming jobs assigned to you have been reassigned. Any payouts already earned
      for completed work will be settled per our standard schedule.
    </p>
    <p style="margin:0 0 14px">
      Please return any company materials in your possession and direct any questions to
      <a href="mailto:hr@novaracleaning.com" style="color:#5C0FFE">hr@novaracleaning.com</a>.
    </p>
    <p style="margin:18px 0 4px">Sincerely,</p>
    <p style="margin:0;font-weight:600">Novara Cleaning — Human Resources</p>
    <p style="margin:2px 0 0;color:#64748b;font-size:13px">hr@novaracleaning.com</p>
  </div>
$html$, greeting);

    sms_ok := false;
    email_ok := false;
    sms_from := null;
    sms_err := null;
    email_id := null;
    email_err := null;

    IF rec.phone IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.sms_logs s
      WHERE regexp_replace(s.to_phone, '\D', '', 'g') LIKE '%' || right(regexp_replace(rec.phone, '\D', '', 'g'), 10)
        AND s.message LIKE '%temporary do-not-hire list%'
        AND s.created_at > now() - interval '1 day'
        AND s.status IN ('sent', 'queued', 'delivered')
    ) THEN
      BEGIN
        sms_resp := extensions.http(ROW(
          'POST'::extensions.http_method,
          'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/send-sms-notification',
          ARRAY[
            extensions.http_header('Content-Type', 'application/json'),
            extensions.http_header('Authorization', 'Bearer ' || anon_key),
            extensions.http_header('apikey', anon_key)
          ],
          'application/json',
          jsonb_build_object(
            'toPhone', rec.phone,
            'message', sms_text,
            'type', 'reminder'
          )::text
        )::extensions.http_request);
        sms_ok := sms_resp.status BETWEEN 200 AND 299
          AND coalesce(sms_resp.content, '') NOT ILIKE '%"error"%';
        sms_from := substring(coalesce(sms_resp.content, '') from '"from"\s*:\s*"([^"]+)"');
        IF NOT sms_ok THEN
          sms_err := left(coalesce(sms_resp.content, 'HTTP ' || sms_resp.status), 400);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        sms_err := left(SQLERRM, 400);
      END;
    ELSE
      sms_ok := true;
      sms_from := 'skipped_already_sent';
    END IF;

    IF rec.email IS NOT NULL AND resend_key IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.event_type = 'cleaner.blacklist_notice_sent'
        AND e.cleaner_id = rec.id
        AND coalesce(e.data->>'email_ok', '') = 'true'
        AND e.created_at > now() - interval '1 day'
    ) THEN
      BEGIN
        email_resp := extensions.http(ROW(
          'POST'::extensions.http_method,
          'https://api.resend.com/emails',
          ARRAY[
            extensions.http_header('Authorization', 'Bearer ' || resend_key),
            extensions.http_header('Content-Type', 'application/json')
          ],
          'application/json',
          jsonb_build_object(
            'from', 'Novara Cleaning HR <hr@novaracleaning.com>',
            'to', jsonb_build_array(rec.email),
            'cc', jsonb_build_array('contact@novaracleaning.com'),
            'reply_to', 'hr@novaracleaning.com',
            'subject', 'Notice of Termination and Temporary Do-Not-Hire — Novara Cleaning',
            'text', email_text,
            'html', email_html
          )::text
        )::extensions.http_request);
        email_ok := email_resp.status BETWEEN 200 AND 299;
        email_id := substring(coalesce(email_resp.content, '') from '"id"\s*:\s*"([^"]+)"');
        IF NOT email_ok THEN
          email_err := left(coalesce(email_resp.content, 'HTTP ' || email_resp.status), 400);
        END IF;
      EXCEPTION WHEN OTHERS THEN
        email_err := left(SQLERRM, 400);
      END;
    ELSIF rec.email IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.event_type = 'cleaner.blacklist_notice_sent'
        AND e.cleaner_id = rec.id
        AND coalesce(e.data->>'email_ok', '') = 'true'
        AND e.created_at > now() - interval '1 day'
    ) THEN
      email_ok := true;
      email_id := 'skipped_already_sent';
    ELSIF resend_key IS NULL THEN
      email_err := 'RESEND_API_KEY missing from app_secrets';
    END IF;

    IF email_ok THEN
      UPDATE public.cleaner_terminations
      SET letter_sent = true, letter_to = rec.email, letter_cc = 'contact@novaracleaning.com', letter_error = null
      WHERE cleaner_id = rec.id AND created_at > now() - interval '1 day';
      UPDATE public.cleaners
      SET termination_letter_sent_at = now()
      WHERE id = rec.id;
    ELSIF email_err IS NOT NULL THEN
      UPDATE public.cleaner_terminations
      SET letter_error = email_err
      WHERE cleaner_id = rec.id AND created_at > now() - interval '1 day';
    END IF;

    INSERT INTO public.events (event_type, source, summary, cleaner_id, data)
    VALUES (
      'cleaner.blacklist_notice_sent',
      'ops-temporary-blacklist-offboard',
      format(
        'Blacklist notice to %s — SMS %s%s · email %s%s',
        rec.full_name,
        CASE WHEN sms_ok THEN 'sent' ELSE 'FAILED' END,
        CASE WHEN sms_from IS NOT NULL THEN ' via ' || sms_from ELSE '' END,
        CASE WHEN email_ok THEN 'sent (cc contact@)' ELSE 'FAILED' END,
        CASE WHEN email_id IS NOT NULL AND email_id <> 'skipped_already_sent' THEN ' ' || email_id ELSE '' END
      ),
      rec.id,
      jsonb_strip_nulls(jsonb_build_object(
        'sms_ok', sms_ok,
        'sms_from', sms_from,
        'sms_error', sms_err,
        'email_ok', email_ok,
        'email_id', email_id,
        'email_error', email_err,
        'email_cc', 'contact@novaracleaning.com',
        'reason', 'malpractice_assigned_job_no_contact'
      ))
    );
  END LOOP;
END $$;
