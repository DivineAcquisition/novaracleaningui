-- Add configuration table for operational settings
CREATE TABLE IF NOT EXISTS public.app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  description TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

INSERT INTO public.app_config (key, value, description) VALUES
  ('offer_expiry_minutes', '15', 'Minutes before a job offer expires'),
  ('offer_reminder_minutes', '10', 'Minutes before sending a reminder for pending offers'),
  ('default_cleaner_hourly_rate', '18', 'Default cleaner hourly rate in dollars'),
  ('admin_phone', '4436486798', 'Admin phone for dispatch alerts'),
  ('min_profit_margin_percent', '20', 'Minimum profit margin percentage'),
  ('sales_access_pin', '1234', 'PIN for sales tool access'),
  ('default_state', 'MD', 'Default state for new entries'),
  ('cleaner_onboarding_url', 'https://try.novaracleaning.com/cleaner/onboarding-landing', 'URL for cleaner onboarding'),
  ('late_checkin_threshold_minutes', '15', 'Minutes after start time to flag as late')
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read config"
ON public.app_config FOR SELECT TO public USING (true);

CREATE POLICY "Admins can manage config"
ON public.app_config FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));
