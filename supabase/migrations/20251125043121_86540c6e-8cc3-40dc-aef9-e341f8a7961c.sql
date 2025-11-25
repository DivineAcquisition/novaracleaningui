-- Create availability_slots table for real-time booking availability
CREATE TABLE IF NOT EXISTS availability_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service_date DATE NOT NULL,
  time_slot TEXT NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  max_capacity INTEGER NOT NULL DEFAULT 5,
  current_bookings INTEGER NOT NULL DEFAULT 0,
  is_available BOOLEAN GENERATED ALWAYS AS (current_bookings < max_capacity) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(service_date, start_time)
);

-- Create index for fast lookups
CREATE INDEX idx_availability_date_time ON availability_slots(service_date, start_time);
CREATE INDEX idx_availability_date_available ON availability_slots(service_date) WHERE is_available = true;

-- Create trigger to prevent double-booking
CREATE OR REPLACE FUNCTION check_slot_availability()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.current_bookings > NEW.max_capacity THEN
    RAISE EXCEPTION 'Time slot fully booked';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER availability_capacity_check
  BEFORE INSERT OR UPDATE ON availability_slots
  FOR EACH ROW
  EXECUTE FUNCTION check_slot_availability();

-- Function to increment booking count atomically
CREATE OR REPLACE FUNCTION reserve_time_slot(
  _date DATE,
  _start_time TIME,
  _end_time TIME
)
RETURNS BOOLEAN AS $$
DECLARE
  slot_available BOOLEAN;
BEGIN
  SELECT current_bookings < max_capacity INTO slot_available
  FROM availability_slots
  WHERE service_date = _date 
    AND start_time = _start_time
    AND end_time = _end_time
  FOR UPDATE;
  
  IF NOT FOUND OR NOT slot_available THEN
    RETURN FALSE;
  END IF;
  
  UPDATE availability_slots
  SET current_bookings = current_bookings + 1,
      updated_at = NOW()
  WHERE service_date = _date 
    AND start_time = _start_time
    AND end_time = _end_time;
  
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Function to release time slot (for cancellations)
CREATE OR REPLACE FUNCTION release_time_slot(
  _date DATE,
  _start_time TIME
)
RETURNS VOID AS $$
BEGIN
  UPDATE availability_slots
  SET current_bookings = GREATEST(current_bookings - 1, 0),
      updated_at = NOW()
  WHERE service_date = _date 
    AND start_time = _start_time;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Enable RLS
ALTER TABLE availability_slots ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Anyone can view availability"
ON availability_slots FOR SELECT
TO PUBLIC USING (true);

-- Only admins can modify
CREATE POLICY "Admins can manage availability"
ON availability_slots FOR ALL
TO authenticated
USING (has_role(auth.uid(), 'admin'))
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Enable realtime
ALTER TABLE availability_slots REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE availability_slots;