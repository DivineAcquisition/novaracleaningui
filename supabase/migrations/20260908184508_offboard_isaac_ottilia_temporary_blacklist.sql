-- One-time: complete offboard of Isaac (Issac Bell), Isaac Jr, and Ottilia
-- Williams, with a temporary blacklist (90-day reapply lockout).
-- Safe to re-run. Matches on email, not generated IDs.
-- Already applied on hosted as supabase_migrations 20260908184508.

DO $$
DECLARE
  v_eligible timestamptz := now() + interval '90 days';
  v_eligible_label text := to_char((now() + interval '90 days')::date, 'Mon FMDD, YYYY');
  v_notes text :=
    'Temporary blacklist. Complete offboard. Hiring / reapply locked for 90 days (until '
    || to_char((now() + interval '90 days')::date, 'Mon FMDD, YYYY')
    || '). Review then; not a permanent do-not-hire.';
BEGIN
  -- 1. Release open / stuck assignments so dispatch can cover them.
  WITH old_rows AS (
    SELECT ja.id, ja.job_id, ja.cleaner_id, ja.status AS from_status, b.id AS booking_id, b.booking_number, b.service_date
    FROM public.job_assignments ja
    JOIN public.cleaners c ON c.id = ja.cleaner_id
    LEFT JOIN public.bookings b ON b.job_id = ja.job_id
    WHERE lower(c.email) IN (
      'isaac.ricardo.bell.jr@gmail.com',
      'belltre933@gmail.com',
      'ottilia.williams83@gmail.com'
    )
      AND ja.status IN ('Offered', 'Accepted', 'Confirmed', 'In Progress')
  ),
  upd AS (
    UPDATE public.job_assignments ja
    SET status = 'Needs Reassignment'
    FROM old_rows o
    WHERE ja.id = o.id
    RETURNING ja.id
  )
  INSERT INTO public.job_status_history (job_id, from_status, to_status, changed_by, metadata)
  SELECT
    o.job_id,
    o.from_status,
    'Needs Reassignment',
    NULL,
    jsonb_build_object(
      'reason', 'cleaner_terminated:other',
      'source', 'ops-temporary-blacklist-offboard',
      'cleaner_id', o.cleaner_id,
      'booking_number', o.booking_number,
      'service_date', o.service_date
    )
  FROM old_rows o
  WHERE EXISTS (SELECT 1 FROM upd);

  -- 2. Terminate directory rows + stamp temporary blacklist.
  UPDATE public.cleaners c
  SET
    status = 'terminated',
    terminated_at = COALESCE(c.terminated_at, now()),
    termination_reason = 'other',
    termination_effective_date = COALESCE(c.termination_effective_date, current_date),
    rehire_status = 'blacklist',
    rehire_notes = v_notes,
    reapply_eligible_at = COALESCE(c.reapply_eligible_at, v_eligible),
    available_for_bookings = false,
    approved = false,
    walkthrough_eligible = false,
    sms_notifications_enabled = false,
    deactivated_at = COALESCE(c.deactivated_at, now()),
    deactivation_reason = COALESCE(c.deactivation_reason, 'other'),
    inactive_until = NULL,
    crew_id = NULL,
    agreement_token = NULL,
    agreement_token_expires_at = NULL,
    setup_token = NULL,
    setup_token_expires_at = NULL,
    supply_token = NULL,
    supply_token_expires_at = NULL,
    notes_internal = CASE
      WHEN coalesce(c.notes_internal, '') LIKE '%Temporary blacklist offboard%' THEN c.notes_internal
      ELSE trim(both from coalesce(c.notes_internal, '')
        || CASE WHEN coalesce(c.notes_internal, '') = '' THEN '' ELSE E'\n' END
        || 'Temporary blacklist offboard ' || to_char(now(), 'YYYY-MM-DD')
        || '. Reapply eligible ' || to_char(v_eligible::date, 'YYYY-MM-DD') || '.')
    END,
    updated_at = now()
  WHERE lower(c.email) IN (
    'isaac.ricardo.bell.jr@gmail.com',
    'belltre933@gmail.com',
    'ottilia.williams83@gmail.com'
  );

  -- 3. Termination audit ledger (skip if this offboard already logged today).
  INSERT INTO public.cleaner_terminations (
    cleaner_id, reason, reason_label, rehire_status, notes, effective_date,
    letter_to, letter_cc, letter_sent, letter_error
  )
  SELECT
    c.id,
    'other',
    'Complete offboard — temporary blacklist',
    'blacklist',
    'Temporary blacklist. Portal, dispatch, crew, hiring pipeline, and login closed. May reapply after '
      || v_eligible_label
      || '. No termination letter sent (letter copy is a permanent do-not-hire notice).',
    current_date,
    c.email,
    'hr@novaracleaning.com, contact@novaracleaning.com',
    false,
    'Letter skipped — temporary blacklist (letter copy is permanent do-not-hire).'
  FROM public.cleaners c
  WHERE lower(c.email) IN (
    'isaac.ricardo.bell.jr@gmail.com',
    'belltre933@gmail.com',
    'ottilia.williams83@gmail.com'
  )
  AND NOT EXISTS (
    SELECT 1
    FROM public.cleaner_terminations t
    WHERE t.cleaner_id = c.id
      AND t.rehire_status = 'blacklist'
      AND t.created_at > now() - interval '1 day'
  );

  -- 4. Close hiring pipeline rows.
  UPDATE public.cleaner_applicants a
  SET
    stage = 'rejected',
    rejection_reason = 'Temporary blacklist — complete offboard. May reapply after ' || v_eligible_label || '.',
    invite_token = NULL,
    invite_expires_at = NULL,
    hold_pending = NULL,
    hold_follow_up_at = NULL,
    hold_reminder_sent_at = NULL,
    stage_changed_at = now(),
    stage_changed_by = 'ops:temporary-blacklist-offboard',
    updated_at = now()
  WHERE lower(a.email) IN (
    'isaac.ricardo.bell.jr@gmail.com',
    'belltre933@gmail.com',
    'ottilia.williams83@gmail.com'
  )
  OR a.cleaner_id IN (
    SELECT id FROM public.cleaners
    WHERE lower(email) IN (
      'isaac.ricardo.bell.jr@gmail.com',
      'belltre933@gmail.com',
      'ottilia.williams83@gmail.com'
    )
  );

  -- 5. Deactivate their crew (looked up by name — members were just unlinked).
  UPDATE public.crews cr
  SET
    lead_cleaner_id = NULL,
    active = false,
    notes = CASE
      WHEN coalesce(cr.notes, '') LIKE '%temporarily blacklisted / offboarded%' THEN cr.notes
      ELSE trim(both from coalesce(cr.notes, '')
        || CASE WHEN coalesce(cr.notes, '') = '' THEN '' ELSE E'\n' END
        || 'Deactivated ' || to_char(now(), 'YYYY-MM-DD')
        || ' — Isaac, Isaac Jr, and Ottilia temporarily blacklisted / offboarded.')
    END,
    updated_at = now()
  WHERE lower(cr.name) = 'zone a crew 1 (md & dc)';

  -- 6. Drop push tokens.
  DELETE FROM public.cleaner_device_tokens
  WHERE cleaner_id IN (
    SELECT id FROM public.cleaners
    WHERE lower(email) IN (
      'isaac.ricardo.bell.jr@gmail.com',
      'belltre933@gmail.com',
      'ottilia.williams83@gmail.com'
    )
  )
  OR user_id IN (
    SELECT user_id FROM public.cleaners
    WHERE lower(email) IN (
      'isaac.ricardo.bell.jr@gmail.com',
      'belltre933@gmail.com',
      'ottilia.williams83@gmail.com'
    )
    AND user_id IS NOT NULL
  );

  -- 7. Expire unused pulse-check links.
  UPDATE public.pulse_check_entries
  SET token_expires_at = now(), updated_at = now()
  WHERE cleaner_id IN (
    SELECT id FROM public.cleaners
    WHERE lower(email) IN (
      'isaac.ricardo.bell.jr@gmail.com',
      'belltre933@gmail.com',
      'ottilia.williams83@gmail.com'
    )
  )
  AND (token_expires_at IS NULL OR token_expires_at > now())
  AND submitted_at IS NULL;

  -- 8. Ban contractor logins (same duration as VA offboard).
  UPDATE auth.users u
  SET banned_until = now() + interval '87600 hours'
  WHERE lower(u.email) IN (
    'isaac.ricardo.bell.jr@gmail.com',
    'belltre933@gmail.com',
    'ottilia.williams83@gmail.com'
  )
  OR u.id IN (
    SELECT user_id FROM public.cleaners
    WHERE lower(email) IN (
      'isaac.ricardo.bell.jr@gmail.com',
      'belltre933@gmail.com',
      'ottilia.williams83@gmail.com'
    )
    AND user_id IS NOT NULL
  );

  BEGIN
    DELETE FROM auth.refresh_tokens
    WHERE user_id IN (
      SELECT user_id FROM public.cleaners
      WHERE lower(email) IN (
        'isaac.ricardo.bell.jr@gmail.com',
        'belltre933@gmail.com',
        'ottilia.williams83@gmail.com'
      )
      AND user_id IS NOT NULL
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    DELETE FROM auth.sessions
    WHERE user_id IN (
      SELECT user_id FROM public.cleaners
      WHERE lower(email) IN (
        'isaac.ricardo.bell.jr@gmail.com',
        'belltre933@gmail.com',
        'ottilia.williams83@gmail.com'
      )
      AND user_id IS NOT NULL
    );
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  -- 9. Activity feed (skip duplicate if already written today).
  INSERT INTO public.events (event_type, source, summary, cleaner_id, data)
  SELECT
    'cleaner.terminated',
    'ops-temporary-blacklist-offboard',
    'Cleaner ' || concat_ws(' ', c.first_name, c.last_name)
      || ' terminated — Complete offboard · Blacklisted — do not hire (temporary, 90-day reapply lockout)',
    c.id,
    jsonb_build_object(
      'reason', 'other',
      'reasonLabel', 'Complete offboard — temporary blacklist',
      'rehireStatus', 'blacklist',
      'blacklisted', true,
      'temporary', true,
      'reapply_eligible_at', COALESCE(c.reapply_eligible_at, v_eligible),
      'letter_sent', false,
      'email', c.email,
      'via', 'ops-temporary-blacklist-offboard'
    )
  FROM public.cleaners c
  WHERE lower(c.email) IN (
    'isaac.ricardo.bell.jr@gmail.com',
    'belltre933@gmail.com',
    'ottilia.williams83@gmail.com'
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.events e
    WHERE e.event_type = 'cleaner.terminated'
      AND e.cleaner_id = c.id
      AND e.source = 'ops-temporary-blacklist-offboard'
      AND e.created_at > now() - interval '1 day'
  );

  INSERT INTO public.events (event_type, source, summary, cleaner_id, booking_id, job_id, data)
  SELECT
    'job.needs_reassignment',
    'ops-temporary-blacklist-offboard',
    'Booking #' || coalesce(b.booking_number::text, '?')
      || ' released — ' || concat_ws(' ', c.first_name, c.last_name) || ' offboarded',
    ja.cleaner_id,
    b.id,
    ja.job_id,
    jsonb_build_object(
      'assignment_id', ja.id,
      'from_status', h.from_status,
      'service_date', b.service_date,
      'booking_number', b.booking_number
    )
  FROM public.job_status_history h
  JOIN public.job_assignments ja ON ja.job_id = h.job_id
    AND ja.cleaner_id = (h.metadata->>'cleaner_id')::uuid
  JOIN public.cleaners c ON c.id = ja.cleaner_id
  LEFT JOIN public.bookings b ON b.job_id = ja.job_id
  WHERE h.metadata->>'source' = 'ops-temporary-blacklist-offboard'
    AND h.changed_at > now() - interval '10 minutes'
    AND b.service_date >= current_date
    AND NOT EXISTS (
      SELECT 1 FROM public.events e
      WHERE e.event_type = 'job.needs_reassignment'
        AND e.job_id = ja.job_id
        AND e.source = 'ops-temporary-blacklist-offboard'
        AND e.created_at > now() - interval '1 day'
    );
END $$;
