ALTER TABLE bookings ADD COLUMN IF NOT EXISTS sdr_rep_name text;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS num_cleaners_assigned integer;