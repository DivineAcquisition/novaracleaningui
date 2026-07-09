-- Job value increase — fifth extra-pay type (paid when a job turned out
-- bigger/more valuable than booked and the cleaner's cut goes up).
ALTER TABLE public.job_extra_pay ADD COLUMN IF NOT EXISTS job_value_cents integer NOT NULL DEFAULT 0;
