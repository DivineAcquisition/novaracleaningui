-- ─── Retire OpenPhone ───────────────────────────────────────────────────────
--
-- OpenPhone was wired up in 20260520_openphone_ghl_va_ops.sql and never
-- adopted: the account was never provisioned, both OPENPHONE_* secrets sat
-- empty, no lead ever carried an openphone_contact_id, and the one row in
-- phone_calls is the smoke test from the original runbook. VAs dial from GHL,
-- and GHL is where the conversation record lives.
--
-- The `openphone-webhook` edge function is deleted alongside this. It was worse
-- than dead weight: it verified its HMAC only when OPENPHONE_WEBHOOK_SECRET was
-- populated, and it never was, so a public unauthenticated endpoint would
-- accept anybody's payload and write to leads, phone_calls and sms_logs.
--
-- `phone_calls` and `va_assignments` stay. They are provider-agnostic and the
-- VA performance collector reads the ledger; only the OpenPhone-shaped columns
-- go. Nothing writes to it now, which the collector accounts for by treating an
-- empty window as "can't see" rather than a confident zero.

ALTER TABLE public.leads
  DROP COLUMN IF EXISTS openphone_contact_id;

-- Dropping the column takes phone_calls_openphone_call_id_key (the upsert
-- dedupe key) with it. Intentional: there is no longer anything to dedupe.
ALTER TABLE public.phone_calls
  DROP COLUMN IF EXISTS openphone_call_id,
  DROP COLUMN IF EXISTS openphone_conversation_id;

COMMENT ON TABLE public.phone_calls IS
  'Provider-agnostic call ledger. Unwritten since the OpenPhone webhook was retired (2026-07-29) — VA call metrics come from the GHL conversations API. Retained as the landing shape for any future dialer.';

DELETE FROM public.app_secrets
  WHERE key IN ('OPENPHONE_API_KEY', 'OPENPHONE_WEBHOOK_SECRET');

NOTIFY pgrst, 'reload schema';
