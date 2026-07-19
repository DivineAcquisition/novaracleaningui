-- Feedback follow-up reminders + open detection
--
-- The tokenized feedback link is texted ~2h after completion. If the
-- customer never opens it, we want to nudge them again — but only while
-- they haven't opened it and haven't answered. These columns let the
-- send-rating-reminders sweep drive bounded follow-ups off the
-- job_feedback row itself (independent of the one-shot first send stamped
-- on bookings.rating_reminder_sent_at).
--
--   opened_at        — first time the page was loaded (job-feedback `get`)
--   reminder_count   — number of FOLLOW-UP nudges sent (beyond the first)
--   last_reminder_at — when the most recent follow-up went out (spacing)

ALTER TABLE public.job_feedback
  ADD COLUMN IF NOT EXISTS opened_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_count smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at timestamptz;

-- Follow-up sweep pulls pending, unopened rows whose first send is old
-- enough — index the hot path.
CREATE INDEX IF NOT EXISTS job_feedback_followup_idx
  ON public.job_feedback (sent_at)
  WHERE status = 'pending' AND opened_at IS NULL;

-- Admin-tunable follow-up cadence.
INSERT INTO public.app_secrets (key, value)
VALUES
  ('FEEDBACK_REMINDER_DELAY_HOURS', '24'),
  ('FEEDBACK_MAX_REMINDERS', '2')
ON CONFLICT (key) DO NOTHING;
