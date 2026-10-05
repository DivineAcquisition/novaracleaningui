-- Threads for the LSA text agent. The Google relay number stays on
-- relay_phone. customer_phone is the number the customer actually sends.

CREATE TABLE IF NOT EXISTS public.lsa_chat_threads (
  ghl_conversation_id text PRIMARY KEY,
  ghl_contact_id text,
  relay_phone text,
  customer_phone text,
  first_name text,
  email text,
  zip_code text,
  sqft integer,
  bedrooms integer,
  home_size_id text,
  service_hint text,
  quote_cents integer,
  booking_id text,
  pay_url text,
  status text NOT NULL DEFAULT 'new',
  handoff boolean NOT NULL DEFAULT false,
  opener_sent_at timestamptz,
  last_inbound_id text,
  last_reply_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.lsa_chat_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.lsa_chat_threads FROM PUBLIC, anon, authenticated;

INSERT INTO public.app_secrets (key, value, description)
VALUES (
  'LSA_CHAT_AGENT_SECRET',
  encode(extensions.gen_random_bytes(24), 'hex'),
  'Shared secret for the LSA chat agent cron'
)
ON CONFLICT (key) DO NOTHING;

NOTIFY pgrst, 'reload schema';
