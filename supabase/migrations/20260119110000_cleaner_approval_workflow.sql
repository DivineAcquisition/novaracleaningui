-- =====================================================
-- Cleaner Approval Workflow
-- Admin must approve cleaners before they receive jobs
-- =====================================================

-- 1. Admin Notifications Table
-- =====================================================
CREATE TABLE IF NOT EXISTS admin_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR(50) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT,
  data JSONB DEFAULT '{}',
  read BOOLEAN DEFAULT FALSE,
  read_at TIMESTAMPTZ,
  read_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_admin_notifications_read ON admin_notifications(read, created_at DESC);
CREATE INDEX idx_admin_notifications_type ON admin_notifications(type);

-- RLS for admin_notifications
ALTER TABLE admin_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view notifications"
  ON admin_notifications FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND (
        u.raw_user_meta_data->>'role' = 'admin'
        OR u.email LIKE '%@novaracleaning.com'
      )
    )
  );

CREATE POLICY "Admins can update notifications"
  ON admin_notifications FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM auth.users u
      WHERE u.id = auth.uid()
      AND (
        u.raw_user_meta_data->>'role' = 'admin'
        OR u.email LIKE '%@novaracleaning.com'
      )
    )
  );

CREATE POLICY "Service role can manage notifications"
  ON admin_notifications FOR ALL
  USING (auth.role() = 'service_role');

-- 2. Add approval tracking columns to cleaners
-- =====================================================
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS approved_by UUID REFERENCES auth.users(id);
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE cleaners ADD COLUMN IF NOT EXISTS application_notes TEXT;

-- 3. Function to approve a cleaner
-- =====================================================
CREATE OR REPLACE FUNCTION approve_cleaner(
  p_cleaner_id UUID,
  p_admin_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE cleaners
  SET 
    approved = TRUE,
    status = 'active',
    approved_by = p_admin_id,
    approved_at = NOW(),
    activated_at = NOW(),
    application_notes = COALESCE(p_notes, application_notes)
  WHERE id = p_cleaner_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Function to reject a cleaner
-- =====================================================
CREATE OR REPLACE FUNCTION reject_cleaner(
  p_cleaner_id UUID,
  p_admin_id UUID,
  p_reason TEXT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE cleaners
  SET 
    approved = FALSE,
    status = 'rejected',
    approved_by = p_admin_id,
    approved_at = NOW(),
    rejection_reason = p_reason
  WHERE id = p_cleaner_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 5. View for pending cleaner approvals
-- =====================================================
CREATE OR REPLACE VIEW v_pending_cleaner_approvals AS
SELECT 
  c.id,
  c.first_name,
  c.last_name,
  c.email,
  c.phone,
  c.state,
  c.home_zip,
  c.max_travel_miles,
  c.preferred_work_days,
  c.skillset,
  c.pay_rate_hr,
  c.avatar_url,
  c.created_at as applied_at,
  c.onboarding_complete
FROM cleaners c
WHERE c.status = 'pending_approval'
  AND c.approved = FALSE
  AND c.onboarding_complete = TRUE
ORDER BY c.created_at DESC;

-- 6. Add index for pending approvals
-- =====================================================
CREATE INDEX IF NOT EXISTS idx_cleaners_pending_approval 
  ON cleaners(created_at DESC) 
  WHERE status = 'pending_approval' AND approved = FALSE;

COMMENT ON TABLE admin_notifications IS 'Notifications for admin dashboard (new applications, alerts, etc.)';
COMMENT ON FUNCTION approve_cleaner IS 'Approves a cleaner and activates their account';
COMMENT ON FUNCTION reject_cleaner IS 'Rejects a cleaner application with reason';
