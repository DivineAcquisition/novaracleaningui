-- Add performance tracking fields to cleaners table
ALTER TABLE cleaners 
ADD COLUMN IF NOT EXISTS acceptance_rate numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS on_time_rate numeric DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_offers_received integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_offers_accepted integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_on_time_arrivals integer DEFAULT 0;

-- Create index for performance queries
CREATE INDEX IF NOT EXISTS idx_cleaners_performance 
ON cleaners(acceptance_rate, on_time_rate, weighted_score);

-- Insert test cleaners with realistic metrics for testing
INSERT INTO cleaners (
  email, first_name, last_name, phone, status, approved, 
  available_for_bookings, workload_score, weighted_score,
  acceptance_rate, on_time_rate, total_offers_received,
  total_offers_accepted, total_on_time_arrivals, completed_bookings,
  average_rating, total_ratings, home_lat, home_lng, state, home_zip,
  pay_rate_hr, max_travel_miles, status_today, preferred_work_days,
  service_zip_codes
) VALUES 
(
  'test.cleaner1@novara.com', 'Sarah', 'Johnson', '+15551234567',
  'active', true, true, 45.5, 78.2, 92.5, 88.0, 
  40, 37, 22, 25, 4.8, 25, 39.7392, -104.9903, 'CO', '80202',
  18.00, 20, 'Available', ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  ARRAY['80202', '80203', '80204']
),
(
  'test.cleaner2@novara.com', 'Mike', 'Chen', '+15551234568',
  'active', true, true, 62.3, 65.8, 85.0, 95.5,
  60, 51, 42, 44, 4.9, 44, 39.7392, -104.9903, 'CO', '80202',
  18.00, 20, 'Available', ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  ARRAY['80202', '80203', '80204']
),
(
  'test.cleaner3@novara.com', 'Emma', 'Rodriguez', '+15551234569',
  'active', true, true, 38.1, 82.5, 95.0, 90.0,
  20, 19, 18, 20, 4.7, 20, 39.7392, -104.9903, 'CO', '80202',
  18.00, 20, 'Available', ARRAY['Mon', 'Tue', 'Wed', 'Thu', 'Fri'],
  ARRAY['80202', '80203', '80204']
);

-- Create a test job for dispatch webhook testing
INSERT INTO jobs (
  address, city, state, zip, service_type, sq_ft, bedrooms, bathrooms,
  start_datetime, duration_est_hours, min_cleaners_required,
  lat, lng, status
) VALUES (
  '123 Test Street', 'Denver', 'CO', '80202', 'Standard',
  2500, 3, 2, NOW() + INTERVAL '2 days', 4, 2,
  39.7392, -104.9903, 'New'
);