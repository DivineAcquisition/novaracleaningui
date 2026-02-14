
-- Leads table for tracking sales pipeline
CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL,
  last_name text NOT NULL,
  phone text,
  email text,
  source text NOT NULL DEFAULT 'Website',
  channel text NOT NULL DEFAULT 'Phone Call',
  active_channel text DEFAULT 'Phone Call',
  status text NOT NULL DEFAULT 'new',
  property_type text,
  bedrooms integer,
  bathrooms numeric,
  sqft integer,
  zip_code text,
  service_type text,
  frequency text,
  preferred_date date,
  preferred_time text,
  special_requests text,
  urgency text,
  is_existing_customer boolean DEFAULT false,
  existing_customer_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage leads" ON public.leads
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Sales quotes tied to leads
CREATE TABLE public.sales_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
  service_type text NOT NULL,
  property_type text,
  bedrooms integer,
  bathrooms numeric,
  sqft integer,
  frequency text DEFAULT 'One-Time',
  base_price_cents integer NOT NULL DEFAULT 0,
  discount_pct numeric DEFAULT 0,
  discount_amount_cents integer DEFAULT 0,
  final_price_cents integer NOT NULL DEFAULT 0,
  deposit_cents integer DEFAULT 0,
  monthly_total_cents integer DEFAULT 0,
  add_ons text[] DEFAULT '{}',
  add_ons_total_cents integer DEFAULT 0,
  home_size_id text,
  notes text,
  sent_via text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_quotes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage sales quotes" ON public.sales_quotes
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Follow-ups for leads
CREATE TABLE public.follow_ups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
  scheduled_date date NOT NULL,
  scheduled_time time,
  channel text DEFAULT 'Phone Call',
  message text,
  completed boolean DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.follow_ups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage follow ups" ON public.follow_ups
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Activity log for leads
CREATE TABLE public.lead_activity_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE CASCADE NOT NULL,
  action text NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lead_activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage lead activity" ON public.lead_activity_log
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

-- Sales scripts (database-driven)
CREATE TABLE public.sales_scripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL,
  trigger_context text,
  title text NOT NULL,
  script_text text NOT NULL,
  channel text DEFAULT 'all',
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sales_scripts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage sales scripts" ON public.sales_scripts
  FOR ALL USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Anyone can view active scripts" ON public.sales_scripts
  FOR SELECT USING (is_active = true);

-- Seed default scripts
INSERT INTO public.sales_scripts (category, trigger_context, title, script_text, sort_order) VALUES
-- Objection handling
('objection', 'price', 'Too Expensive', 'Highlight value: vetted 2-person crew, insured & bonded, premium eco-friendly products, satisfaction guarantee. Offer a one-time trial clean. Suggest adjusting scope or frequency to fit budget.', 1),
('objection', 'thinking', 'Need to Think About It', '"Totally understand! I can hold a spot on [day] with no obligation — you can always adjust. I''ll follow up tomorrow to answer any questions."', 2),
('objection', 'comparing', 'Just Getting Quotes', '"Smart move! A few things that set us apart: dedicated teams assigned to your home, premium products, and our satisfaction guarantee. Happy to answer any comparison questions."', 3),
('objection', 'cheaper', 'Found a Cheaper Option', '"We hear that a lot! Our clients find the consistency, thorough vetting, and quality saves them from the headache of unreliable service. Would you like to try one clean risk-free?"', 4),
('objection', 'spouse', 'Need to Ask Spouse/Partner', '"Of course! Want me to send a quick summary you can share? And they''re welcome to call or text us with any questions."', 5),
('objection', 'discount', 'Can You Do a Discount?', 'Adjust scope, not price. Mention recurring savings (up to 20% off). Never offer ad-hoc discounts — maintain pricing integrity.', 6),
('objection', 'busy', 'Don''t Have Time Right Now', '"No worries — I can book you for [next available] and send a confirmation. Takes 30 seconds and you''re all set."', 7),
-- Closing techniques
('closing', null, 'Assumptive Close', '"I have [Day] at [Time] or [Day] at [Time] — which works better for you?"', 1),
('closing', null, 'Choice Close', '"Would you like to start with a deep clean to reset, or jump into recurring maintenance?"', 2),
('closing', null, 'Urgency (Availability)', '"Our schedule fills up quickly in your area — I''d recommend locking in a spot this week while we have openings."', 3),
('closing', null, 'Trial Close', '"Want to try one clean and see how you like it? No commitment, no strings attached."', 4),
-- Channel tips
('channel_tip', 'Phone Call', 'Phone Tips', 'Be conversational and warm. Use assumptive close. Don''t rush silence — let them think. Mirror their energy level. Always recap next steps before hanging up.', 1),
('channel_tip', 'Text/SMS', 'Text/DM Tips', 'Keep messages short (under 160 chars). One question at a time. Use choice close. Respond within 2 minutes. Use emojis sparingly but warmly.', 2),
('channel_tip', 'Email', 'Email Tips', 'Lead with value summary. Include pricing clearly in a formatted block. End with a specific CTA and two time options. Subject line should create urgency.', 3),
('channel_tip', 'Instagram DM', 'Instagram DM Tips', 'Keep it casual and personal. Reference their profile if possible. Use voice notes for complex explanations. Send a booking link, not a phone number.', 4),
-- Talking points by step
('talking_point', 'service_type', 'Service Selection', 'Our deep clean is a 4-hour, 40-point checklist — perfect if the home hasn''t been cleaned professionally recently. Standard cleans are great for maintenance.', 1),
('talking_point', 'frequency', 'Frequency Selection', '"Most of our clients go bi-weekly — it keeps the home fresh and you save up to 20% per clean compared to one-time bookings."', 2),
('talking_point', 'price_presentation', 'Presenting Price', '"That includes our professional 2-person crew, all premium eco-friendly supplies, and our 100% satisfaction guarantee. No hidden fees."', 3),
('talking_point', 'zip_validation', 'Service Area Confirmed', '"Great news — we service your area! Our local team knows your neighborhood well and we have availability this week."', 4);

-- Trigger for updated_at
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_sales_scripts_updated_at BEFORE UPDATE ON public.sales_scripts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
