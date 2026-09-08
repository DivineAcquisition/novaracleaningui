-- Hosted 2026-09-08: enabled extensions.http so Postgres could call GHL
-- (this environment cannot reach services.leadconnectorhq.com directly).
-- Idempotent locally.
CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
