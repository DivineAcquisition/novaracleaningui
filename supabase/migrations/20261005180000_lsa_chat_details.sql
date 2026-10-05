-- Extra intake the text agent collects before it names a price.
ALTER TABLE public.lsa_chat_threads
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
