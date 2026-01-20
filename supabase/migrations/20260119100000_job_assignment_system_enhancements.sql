-- =====================================================
-- Job Assignment System Enhancements
-- Adds: tokens, queue, analytics, priority escalation
-- =====================================================

-- 1. Job Assignment Tokens - Secure accept/decline tokens
-- =====================================================
CREATE TABLE IF NOT EXISTS job_assignment_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_assignment_id UUID NOT NULL REFERENCES job_assignments(id) ON DELETE CASCADE,
  token VARCHAR(64) NOT NULL UNIQUE,
  action VARCHAR(20) NOT NULL CHECK (action IN ('accept', 'decline')),
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  ip_address INET,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_assignment_tokens_token ON job_assignment_tokens(token);
CREATE INDEX idx_assignment_tokens_assignment ON job_assignment_tokens(job_assignment_id);
CREATE INDEX idx_assignment_tokens_expires ON job_assignment_tokens(expires_at) WHERE used_at IS NULL;

-- 2. Assignment Queue - Backup cleaners for redistribution
-- =====================================================
CREATE TABLE IF NOT EXISTS assignment_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  cleaner_id UUID NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  priority_level VARCHAR(20) NOT NULL DEFAULT 'normal' CHECK (priority_level IN ('normal', 'high', 'urgent')),
  queue_position INTEGER NOT NULL DEFAULT 1,
  match_score NUMERIC(5,2),
  distance_miles NUMERIC(6,2),
  offered_at TIMESTAMPTZ,
  response_deadline TIMESTAMPTZ,
  status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'offered', 'accepted', 'declined', 'expired', 'skipped')),
  decline_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(job_id, cleaner_id)
);

CREATE INDEX idx_assignment_queue_job ON assignment_queue(job_id);
CREATE INDEX idx_assignment_queue_cleaner ON assignment_queue(cleaner_id);
CREATE INDEX idx_assignment_queue_status ON assignment_queue(status);
CREATE INDEX idx_assignment_queue_priority ON assignment_queue(priority_level, queue_position);
CREATE INDEX idx_assignment_queue_deadline ON assignment_queue(response_deadline) WHERE status = 'offered';

-- 3. Assignment Analytics - Track assignment metrics
-- =====================================================
CREATE TABLE IF NOT EXISTS assignment_analytics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  booking_id UUID REFERENCES bookings(id) ON DELETE SET NULL,
  
  -- Timing metrics
  created_at TIMESTAMPTZ DEFAULT NOW(),
  first_offer_sent_at TIMESTAMPTZ,
  first_response_at TIMESTAMPTZ,
  fully_assigned_at TIMESTAMPTZ,
  
  -- Assignment metrics
  total_cleaners_needed INTEGER NOT NULL DEFAULT 1,
  total_cleaners_assigned INTEGER DEFAULT 0,
  total_offers_sent INTEGER DEFAULT 0,
  total_accepts INTEGER DEFAULT 0,
  total_declines INTEGER DEFAULT 0,
  total_expirations INTEGER DEFAULT 0,
  
  -- Escalation tracking
  escalation_count INTEGER DEFAULT 0,
  current_priority VARCHAR(20) DEFAULT 'normal',
  escalated_to_high_at TIMESTAMPTZ,
  escalated_to_urgent_at TIMESTAMPTZ,
  
  -- Outcome
  status VARCHAR(30) DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'completed', 'failed', 'manual_intervention')),
  failure_reason TEXT,
  manual_intervention_required BOOLEAN DEFAULT FALSE,
  
  -- Performance metrics
  avg_response_time_seconds INTEGER,
  time_to_full_assignment_seconds INTEGER
);

CREATE INDEX idx_assignment_analytics_job ON assignment_analytics(job_id);
CREATE INDEX idx_assignment_analytics_booking ON assignment_analytics(booking_id);
CREATE INDEX idx_assignment_analytics_status ON assignment_analytics(status);
CREATE INDEX idx_assignment_analytics_created ON assignment_analytics(created_at);

-- 4. Add priority and escalation columns to job_assignments
-- =====================================================
ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS priority_level VARCHAR(20) DEFAULT 'normal';
ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS response_deadline TIMESTAMPTZ;
ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS offer_sent_at TIMESTAMPTZ;
ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS decline_reason TEXT;
ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS escalation_level INTEGER DEFAULT 0;
ALTER TABLE job_assignments ADD COLUMN IF NOT EXISTS token_id UUID REFERENCES job_assignment_tokens(id);

-- 5. Add escalation tracking to jobs table
-- =====================================================
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS current_priority VARCHAR(20) DEFAULT 'normal';
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS escalation_count INTEGER DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_escalation_at TIMESTAMPTZ;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS assignment_analytics_id UUID;

-- 6. Function to generate secure tokens
-- =====================================================
CREATE OR REPLACE FUNCTION generate_assignment_token()
RETURNS VARCHAR(64) AS $$
DECLARE
  token VARCHAR(64);
BEGIN
  -- Generate a secure random token
  token := encode(gen_random_bytes(32), 'hex');
  RETURN token;
END;
$$ LANGUAGE plpgsql;

-- 7. Function to calculate response deadline based on priority
-- =====================================================
CREATE OR REPLACE FUNCTION get_response_deadline(priority VARCHAR(20))
RETURNS TIMESTAMPTZ AS $$
BEGIN
  CASE priority
    WHEN 'urgent' THEN RETURN NOW() + INTERVAL '15 minutes';
    WHEN 'high' THEN RETURN NOW() + INTERVAL '20 minutes';
    ELSE RETURN NOW() + INTERVAL '30 minutes';
  END CASE;
END;
$$ LANGUAGE plpgsql;

-- 8. Function to check and escalate priority
-- =====================================================
CREATE OR REPLACE FUNCTION check_escalation_needed(
  p_job_id UUID,
  p_decline_count INTEGER,
  p_hours_elapsed NUMERIC
)
RETURNS VARCHAR(20) AS $$
DECLARE
  new_priority VARCHAR(20);
BEGIN
  -- Escalation rules:
  -- Normal -> High: 2 declines OR 2+ hours elapsed
  -- High -> Urgent: 3 declines OR 4+ hours elapsed
  IF p_decline_count >= 3 OR p_hours_elapsed >= 4 THEN
    new_priority := 'urgent';
  ELSIF p_decline_count >= 2 OR p_hours_elapsed >= 2 THEN
    new_priority := 'high';
  ELSE
    new_priority := 'normal';
  END IF;
  
  RETURN new_priority;
END;
$$ LANGUAGE plpgsql;

-- 9. Trigger to auto-update assignment_queue.updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_assignment_queue_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_assignment_queue_timestamp ON assignment_queue;
CREATE TRIGGER trigger_update_assignment_queue_timestamp
  BEFORE UPDATE ON assignment_queue
  FOR EACH ROW
  EXECUTE FUNCTION update_assignment_queue_timestamp();

-- 10. RLS Policies
-- =====================================================

-- job_assignment_tokens
ALTER TABLE job_assignment_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage tokens"
  ON job_assignment_tokens FOR ALL
  USING (auth.role() = 'service_role');

-- assignment_queue
ALTER TABLE assignment_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage queue"
  ON assignment_queue FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND u.raw_user_meta_data->>'role' = 'admin'
    )
  );

CREATE POLICY "Cleaners can view own queue entries"
  ON assignment_queue FOR SELECT
  USING (
    cleaner_id IN (
      SELECT c.id FROM cleaners c WHERE c.user_id = auth.uid()
    )
  );

-- assignment_analytics
ALTER TABLE assignment_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage analytics"
  ON assignment_analytics FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND u.raw_user_meta_data->>'role' = 'admin'
    )
  );

CREATE POLICY "Service role can manage analytics"
  ON assignment_analytics FOR ALL
  USING (auth.role() = 'service_role');

-- 11. Create index for expired offers cleanup
-- =====================================================
CREATE INDEX idx_job_assignments_expired_offers 
  ON job_assignments(response_deadline) 
  WHERE status = 'Offered' AND response_deadline IS NOT NULL;

-- 12. View for assignment dashboard
-- =====================================================
CREATE OR REPLACE VIEW v_assignment_status AS
SELECT 
  j.id as job_id,
  j.status as job_status,
  j.current_priority,
  j.escalation_count,
  j.min_cleaners_required,
  j.city,
  j.state,
  j.start_datetime,
  aa.total_offers_sent,
  aa.total_accepts,
  aa.total_declines,
  aa.status as assignment_status,
  COUNT(CASE WHEN ja.status = 'Confirmed' THEN 1 END) as confirmed_cleaners,
  COUNT(CASE WHEN ja.status = 'Offered' THEN 1 END) as pending_offers,
  COUNT(CASE WHEN aq.status = 'queued' THEN 1 END) as cleaners_in_queue
FROM jobs j
LEFT JOIN assignment_analytics aa ON aa.job_id = j.id
LEFT JOIN job_assignments ja ON ja.job_id = j.id
LEFT JOIN assignment_queue aq ON aq.job_id = j.id
WHERE j.status IN ('New', 'Dispatching', 'Assigned')
GROUP BY j.id, j.status, j.current_priority, j.escalation_count, 
         j.min_cleaners_required, j.city, j.state, j.start_datetime,
         aa.total_offers_sent, aa.total_accepts, aa.total_declines, aa.status;

COMMENT ON TABLE job_assignment_tokens IS 'Secure tokens for accept/decline actions via SMS/email links';
COMMENT ON TABLE assignment_queue IS 'Queue of backup cleaners for job redistribution with priority levels';
COMMENT ON TABLE assignment_analytics IS 'Tracks assignment performance metrics and escalation history';

-- 13. Schedule cron job to check for expired offers
-- =====================================================
-- Note: This requires pg_cron extension to be enabled
-- Run every 5 minutes

DO $$
BEGIN
  -- Only attempt if pg_cron is available
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove old job if exists
    PERFORM cron.unschedule('check-expired-offers-job');
    
    -- Schedule new job to run every 5 minutes
    PERFORM cron.schedule(
      'check-expired-offers-job',
      '*/5 * * * *',
      $$
      SELECT net.http_post(
        url := current_setting('app.settings.supabase_url') || '/functions/v1/check-expired-offers',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key'),
          'Content-Type', 'application/json'
        ),
        body := '{}'
      );
      $$
    );
  END IF;
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron not available, skipping cron job creation';
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not create cron job: %', SQLERRM;
END;
$$;
