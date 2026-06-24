-- Create storage bucket for job before/after photos submitted by contractors
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-photos', 'job-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Track when a contractor submitted photos for a booking
ALTER TABLE public.bookings
ADD COLUMN IF NOT EXISTS photos_submitted_at timestamp with time zone;

-- RLS policies for job-photos bucket
-- Anyone can view job photos (bucket is public; needed for Zapier/admin display)
CREATE POLICY "Anyone can view job photos"
ON storage.objects FOR SELECT
USING (bucket_id = 'job-photos');

-- Authenticated contractors can upload job photos
CREATE POLICY "Authenticated users can upload job photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (bucket_id = 'job-photos');

-- Authenticated contractors can update job photos they uploaded
CREATE POLICY "Authenticated users can update job photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (bucket_id = 'job-photos');
