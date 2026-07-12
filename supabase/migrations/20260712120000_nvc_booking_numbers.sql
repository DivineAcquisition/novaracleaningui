-- ─── Real booking numbers: unique, sequential, NVC-XXXX ──────────────────────
--
-- Every booking so far carried booking_number = 1 (a static default — no
-- sequence ever existed), so refs like NOV-00001 were identical across jobs
-- and useless as a search key. This migration:
--   1. Backfills DISTINCT numbers chronologically (created_at order).
--   2. Installs a real sequence as the column default + unique index, so
--      every future booking gets the next number automatically.
--   3. Rewrites every DB function that renders 'NOV-' + 5-digit refs to the
--      new 'NVC-' + 4-digit format (event fanout, Discord summaries, QC
--      documentation trigger).
--   4. Backfills stored refs on job_documentation + qc_issues.
--
-- NVC-XXXX becomes the customer-facing job reference — searchable in the
-- admin console and usable by customers reporting a complaint/question
-- about a specific booking.

-- ─── 1. Backfill distinct numbers (chronological) ────────────────────────────
WITH ordered AS (
  SELECT id, row_number() OVER (ORDER BY created_at, id) AS rn
  FROM public.bookings
)
UPDATE public.bookings b
SET booking_number = o.rn
FROM ordered o
WHERE o.id = b.id;

-- ─── 2. Sequence + default + uniqueness ──────────────────────────────────────
DO $do$
DECLARE v_max integer;
BEGIN
  SELECT coalesce(max(booking_number), 0) INTO v_max FROM public.bookings;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = 'booking_number_seq') THEN
    EXECUTE format('CREATE SEQUENCE public.booking_number_seq START WITH %s', v_max + 1);
  ELSE
    EXECUTE format('SELECT setval(''public.booking_number_seq'', %s, true)', v_max);
  END IF;
END $do$;

ALTER TABLE public.bookings
  ALTER COLUMN booking_number SET DEFAULT nextval('public.booking_number_seq');
CREATE UNIQUE INDEX IF NOT EXISTS bookings_booking_number_uniq
  ON public.bookings (booking_number);

-- ─── 3. NOV-00001 → NVC-0001 in every DB function that renders refs ─────────
-- Rewrites pg functions in place: 'NOV-' literal → 'NVC-', and the 5-wide
-- lpad used exclusively for booking numbers → 4-wide.
DO $do$
DECLARE fn record; def text;
BEGIN
  FOR fn IN
    SELECT p.oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'  -- pg_get_functiondef errors on aggregates/windows
      AND pg_get_functiondef(p.oid) LIKE '%''NOV-''%'
  LOOP
    def := pg_get_functiondef(fn.oid);
    def := replace(def, '''NOV-''', '''NVC-''');
    def := replace(def, '::text, 5, ''0''', '::text, 4, ''0''');
    def := replace(def, '::TEXT, 5, ''0''', '::TEXT, 4, ''0''');
    EXECUTE def;
  END LOOP;
END $do$;

-- ─── 4. Backfill stored refs ─────────────────────────────────────────────────
UPDATE public.job_documentation d
SET booking_ref = 'NVC-' || lpad(b.booking_number::text, 4, '0')
FROM public.bookings b
WHERE b.id = d.booking_id;

UPDATE public.qc_issues i
SET booking_ref = 'NVC-' || lpad(b.booking_number::text, 4, '0')
FROM public.bookings b
WHERE b.id = i.booking_id;
