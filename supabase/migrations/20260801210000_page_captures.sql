-- Real screenshots of the customer-facing checkout and agreement/signature
-- pages, captured in the customer's own browser as they complete each step.
-- qc-drive-mirror embeds the latest capture per kind into the job's dispute
-- packet so the packet shows exactly what the customer saw and accepted.

CREATE TABLE IF NOT EXISTS public.page_captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('checkout', 'agreement')),
  storage_path text NOT NULL,
  page_url text,
  image_width integer,
  image_height integer,
  viewport_width integer,
  viewport_height integer,
  byte_size integer,
  ip text,
  user_agent text,
  captured_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_captures_booking_kind
  ON public.page_captures(booking_id, kind, captured_at DESC);

ALTER TABLE public.page_captures ENABLE ROW LEVEL SECURITY;

-- Writes only ever happen through store-page-capture (service role, which
-- bypasses RLS). Admin/VA read access powers the QC console.
DROP POLICY IF EXISTS "admins read page captures" ON public.page_captures;
CREATE POLICY "admins read page captures" ON public.page_captures
  FOR SELECT USING (public.is_admin_or_va(auth.uid()));

-- Private bucket for the captured page images.
INSERT INTO storage.buckets (id, name, public)
VALUES ('page-captures', 'page-captures', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "admins read page capture files" ON storage.objects;
CREATE POLICY "admins read page capture files" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'page-captures' AND public.is_admin_or_va(auth.uid()));
