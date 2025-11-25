-- Seed availability slots for the next 60 weekdays
INSERT INTO availability_slots (service_date, time_slot, start_time, end_time, max_capacity, current_bookings)
SELECT 
  date_series::date as service_date,
  time_slot.label as time_slot,
  time_slot.start_time::time,
  time_slot.end_time::time,
  5 as max_capacity,
  0 as current_bookings
FROM generate_series(
  CURRENT_DATE + INTERVAL '3 days',
  CURRENT_DATE + INTERVAL '63 days',
  INTERVAL '1 day'
) AS date_series
CROSS JOIN (
  VALUES 
    ('8:00 AM - 10:00 AM', '08:00', '10:00'),
    ('10:00 AM - 12:00 PM', '10:00', '12:00'),
    ('12:00 PM - 2:00 PM', '12:00', '14:00'),
    ('2:00 PM - 4:00 PM', '14:00', '16:00'),
    ('4:00 PM - 6:00 PM', '16:00', '18:00'),
    ('6:00 PM - 8:00 PM', '18:00', '20:00')
) AS time_slot(label, start_time, end_time)
WHERE EXTRACT(DOW FROM date_series) NOT IN (0, 6)
ON CONFLICT (service_date, start_time) DO NOTHING;

-- Sync existing confirmed bookings to availability counts
UPDATE availability_slots AS a
SET current_bookings = COALESCE(booking_counts.cnt, 0),
    updated_at = NOW()
FROM (
  SELECT service_date, time_slot, COUNT(*) as cnt
  FROM bookings
  WHERE status IN ('confirmed', 'pending_payment')
  GROUP BY service_date, time_slot
) AS booking_counts
WHERE a.service_date = booking_counts.service_date
  AND a.time_slot = booking_counts.time_slot;