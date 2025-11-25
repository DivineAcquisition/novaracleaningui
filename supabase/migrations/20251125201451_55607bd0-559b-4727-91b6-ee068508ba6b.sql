-- Add Google Calendar sync columns to availability_slots
ALTER TABLE availability_slots 
ADD COLUMN google_calendar_event_id TEXT,
ADD COLUMN blocked_by_google BOOLEAN DEFAULT false,
ADD COLUMN last_synced_at TIMESTAMPTZ;

-- Add Google Calendar event ID to bookings
ALTER TABLE bookings 
ADD COLUMN google_calendar_event_id TEXT;

-- Create index for faster Google Calendar event lookups
CREATE INDEX idx_availability_slots_google_event ON availability_slots(google_calendar_event_id);
CREATE INDEX idx_bookings_google_event ON bookings(google_calendar_event_id);