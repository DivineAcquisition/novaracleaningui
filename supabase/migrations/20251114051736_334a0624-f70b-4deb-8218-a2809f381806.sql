-- =============================================
-- CLEANER DISPATCH SYSTEM - DATA MODEL (FIXED)
-- =============================================

-- Add new fields to existing cleaners table
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS home_zip TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS home_lat NUMERIC;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS home_lng NUMERIC;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS pay_rate_hr NUMERIC NOT NULL DEFAULT 18.00;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS preferred_work_days TEXT[] DEFAULT '{}';
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS max_travel_miles INTEGER DEFAULT 20;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS status_today TEXT DEFAULT 'Unavailable';
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS jobs_assigned_last_7d INTEGER DEFAULT 0;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS workload_score NUMERIC DEFAULT 0;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS weighted_score NUMERIC DEFAULT 0;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_cleaners_status_today ON cleaners(status_today);
CREATE INDEX IF NOT EXISTS idx_cleaners_state ON cleaners(state);
CREATE INDEX IF NOT EXISTS idx_cleaners_weighted_score ON cleaners(weighted_score);

-- =============================================
-- CUSTOMERS TABLE (enhanced)
-- =============================================
ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS state TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS zip TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lat NUMERIC;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS lng NUMERIC;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS analytics_source TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS utm_campaign TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_email ON customers(email);
CREATE INDEX IF NOT EXISTS idx_customers_state ON customers(state);

-- =============================================
-- JOBS TABLE (new dispatch-focused table)
-- =============================================
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  customer_id UUID REFERENCES customers(id),
  
  service_type TEXT NOT NULL DEFAULT 'Standard',
  sq_ft INTEGER,
  bedrooms INTEGER,
  bathrooms INTEGER,
  
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  lat NUMERIC,
  lng NUMERIC,
  
  start_datetime TIMESTAMPTZ NOT NULL,
  duration_est_hours NUMERIC NOT NULL DEFAULT 3,
  min_cleaners_required INTEGER NOT NULL DEFAULT 2,
  
  status TEXT NOT NULL DEFAULT 'New',
  analytics_source TEXT,
  notes TEXT,
  
  manual_intervention_required BOOLEAN DEFAULT false,
  dispatch_alert_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);
CREATE INDEX IF NOT EXISTS idx_jobs_start_datetime ON jobs(start_datetime);
CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);

-- =============================================
-- JOB ASSIGNMENTS TABLE (junction)
-- =============================================
CREATE TABLE IF NOT EXISTS job_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  cleaner_id UUID NOT NULL REFERENCES cleaners(id) ON DELETE CASCADE,
  
  role TEXT NOT NULL DEFAULT 'Support',
  distance_miles NUMERIC,
  status TEXT NOT NULL DEFAULT 'Offered',
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  responded_at TIMESTAMPTZ,
  
  UNIQUE(job_id, cleaner_id)
);

CREATE INDEX IF NOT EXISTS idx_job_assignments_job_id ON job_assignments(job_id);
CREATE INDEX IF NOT EXISTS idx_job_assignments_cleaner_id ON job_assignments(cleaner_id);
CREATE INDEX IF NOT EXISTS idx_job_assignments_status ON job_assignments(status);

-- =============================================
-- REVIEWS TABLE (dispatch-specific)
-- =============================================
CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  cleaner_id UUID REFERENCES cleaners(id),
  
  rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment TEXT
);

CREATE INDEX IF NOT EXISTS idx_reviews_job_id ON reviews(job_id);
CREATE INDEX IF NOT EXISTS idx_reviews_cleaner_id ON reviews(cleaner_id);

-- =============================================
-- DISPATCH ALERTS TABLE
-- =============================================
CREATE TABLE IF NOT EXISTS dispatch_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  
  resolved BOOLEAN DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_dispatch_alerts_job_id ON dispatch_alerts(job_id);
CREATE INDEX IF NOT EXISTS idx_dispatch_alerts_resolved ON dispatch_alerts(resolved);

-- =============================================
-- RLS POLICIES
-- =============================================

-- Jobs RLS
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all jobs" ON jobs;
CREATE POLICY "Admins can manage all jobs"
  ON jobs FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Cleaners can view assigned jobs" ON jobs;
CREATE POLICY "Cleaners can view assigned jobs"
  ON jobs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM job_assignments ja
      INNER JOIN cleaners c ON ja.cleaner_id = c.id
      WHERE ja.job_id = jobs.id
      AND c.user_id = auth.uid()
    )
  );

-- Job Assignments RLS
ALTER TABLE job_assignments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all assignments" ON job_assignments;
CREATE POLICY "Admins can manage all assignments"
  ON job_assignments FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Cleaners can view own assignments" ON job_assignments;
CREATE POLICY "Cleaners can view own assignments"
  ON job_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cleaners c
      WHERE c.id = job_assignments.cleaner_id
      AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Cleaners can update own assignment status" ON job_assignments;
CREATE POLICY "Cleaners can update own assignment status"
  ON job_assignments FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM cleaners c
      WHERE c.id = job_assignments.cleaner_id
      AND c.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM cleaners c
      WHERE c.id = job_assignments.cleaner_id
      AND c.user_id = auth.uid()
    )
  );

-- Reviews RLS
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage all reviews" ON reviews;
CREATE POLICY "Admins can manage all reviews"
  ON reviews FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Cleaners can view own reviews" ON reviews;
CREATE POLICY "Cleaners can view own reviews"
  ON reviews FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM cleaners c
      WHERE c.id = reviews.cleaner_id
      AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Anyone can insert reviews" ON reviews;
CREATE POLICY "Anyone can insert reviews"
  ON reviews FOR INSERT
  WITH CHECK (true);

-- Dispatch Alerts RLS
ALTER TABLE dispatch_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can manage dispatch alerts" ON dispatch_alerts;
CREATE POLICY "Admins can manage dispatch alerts"
  ON dispatch_alerts FOR ALL
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- =============================================
-- TRIGGERS & FUNCTIONS
-- =============================================

-- Update updated_at on jobs
DROP TRIGGER IF EXISTS update_jobs_updated_at ON jobs;
CREATE TRIGGER update_jobs_updated_at
  BEFORE UPDATE ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Update avg_review when review is inserted
CREATE OR REPLACE FUNCTION update_cleaner_avg_review()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE cleaners
  SET 
    average_rating = (
      SELECT AVG(rating)::NUMERIC(3,2)
      FROM reviews
      WHERE cleaner_id = NEW.cleaner_id
    ),
    total_ratings = (
      SELECT COUNT(*)
      FROM reviews
      WHERE cleaner_id = NEW.cleaner_id
    )
  WHERE id = NEW.cleaner_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_cleaner_review_stats ON reviews;
CREATE TRIGGER update_cleaner_review_stats
  AFTER INSERT ON reviews
  FOR EACH ROW
  EXECUTE FUNCTION update_cleaner_avg_review();

-- Compute min_cleaners_required based on sq_ft
CREATE OR REPLACE FUNCTION compute_min_cleaners()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.sq_ft >= 3000 THEN
    NEW.min_cleaners_required = 3;
  ELSE
    NEW.min_cleaners_required = 2;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_min_cleaners_on_job ON jobs;
CREATE TRIGGER set_min_cleaners_on_job
  BEFORE INSERT OR UPDATE OF sq_ft ON jobs
  FOR EACH ROW
  EXECUTE FUNCTION compute_min_cleaners();