-- Create storage bucket for cleaner avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('cleaner-avatars', 'cleaner-avatars', true);

-- Add avatar_url column to cleaners table
ALTER TABLE public.cleaners 
ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Create RLS policies for cleaner avatars
CREATE POLICY "Cleaners can view all avatars"
ON storage.objects FOR SELECT
USING (bucket_id = 'cleaner-avatars');

CREATE POLICY "Cleaners can upload their own avatar"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'cleaner-avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Cleaners can update their own avatar"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'cleaner-avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);

CREATE POLICY "Cleaners can delete their own avatar"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'cleaner-avatars' 
  AND auth.uid()::text = (storage.foldername(name))[1]
);