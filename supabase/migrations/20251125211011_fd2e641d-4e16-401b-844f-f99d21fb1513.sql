-- Fix search_path security warning for notify_capacity_alert function
CREATE OR REPLACE FUNCTION notify_capacity_alert()
RETURNS TRIGGER AS $$
DECLARE
  alert_threshold INTEGER := 4;
BEGIN
  -- Only trigger if current_bookings reaches 4 or 5 (and wasn't already there)
  IF NEW.current_bookings >= alert_threshold AND 
     (OLD.current_bookings IS NULL OR OLD.current_bookings < alert_threshold) THEN
    
    -- Call the edge function asynchronously using pg_net
    PERFORM net.http_post(
      url := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/send-capacity-alert',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN4ZHJhZXB0enVhbXNnamN2ZmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTkzNzYzMzMsImV4cCI6MjA3NDk1MjMzM30.g7Ipg_qYJiC7uASufDsDqIMtRGPg_dJbSZClJCuAa5I'
      ),
      body := jsonb_build_object(
        'service_date', NEW.service_date,
        'time_slot', NEW.time_slot,
        'current_bookings', NEW.current_bookings,
        'max_capacity', NEW.max_capacity
      )
    );
    
    -- Log the alert trigger
    RAISE NOTICE 'Capacity alert triggered for % at % (% of % booked)', 
      NEW.service_date, NEW.time_slot, NEW.current_bookings, NEW.max_capacity;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = 'public';