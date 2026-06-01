-- Post-completion testimonial video offers → 50% off the customer's 2nd clean

CREATE TABLE IF NOT EXISTS public.testimonial_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  customer_email TEXT NOT NULL,
  customer_first_name TEXT,
  promo_code TEXT NOT NULL UNIQUE,
  submit_token TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'submitted', 'redeemed')),
  offer_sent_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ,
  redeemed_booking_id UUID REFERENCES public.bookings(id),
  video_url TEXT,
  answer_what_stood_out TEXT,
  answer_results TEXT,
  answer_recommend TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_testimonial_offers_booking
  ON public.testimonial_offers(booking_id);
CREATE INDEX IF NOT EXISTS idx_testimonial_offers_token
  ON public.testimonial_offers(submit_token);
CREATE INDEX IF NOT EXISTS idx_testimonial_offers_email
  ON public.testimonial_offers(customer_email);

ALTER TABLE public.testimonial_offers ENABLE ROW LEVEL SECURITY;

INSERT INTO storage.buckets (id, name, public)
VALUES ('testimonial-videos', 'testimonial-videos', true)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.promo_codes DROP CONSTRAINT IF EXISTS promo_codes_applies_to_check;
ALTER TABLE public.promo_codes ADD CONSTRAINT promo_codes_applies_to_check
  CHECK (applies_to = ANY (ARRAY[
    'all'::text,
    'new_customers'::text,
    'returning_customers'::text,
    'testimonial_second_clean'::text
  ]));
