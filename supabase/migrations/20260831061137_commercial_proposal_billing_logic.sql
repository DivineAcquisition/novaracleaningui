-- Hosted apply_migration split the official commercial_proposal_billing file
-- into tables then logic because of statement-size limits. The objects live
-- in 20260831061055_commercial_proposal_billing_tables.sql. This version
-- exists so schema_migrations on production matches the repo; it is a no-op
-- on a fresh install (CREATE OR REPLACE already ran in the tables file).

SELECT 1;
