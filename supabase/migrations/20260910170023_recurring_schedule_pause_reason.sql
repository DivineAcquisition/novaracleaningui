-- Store the customer-facing reason when an admin pauses a recurring schedule
-- so the Recurring hub can show it and SMS/email can quote it.

alter table public.customer_recurring_schedules
  add column if not exists pause_reason text,
  add column if not exists pause_reason_code text,
  add column if not exists paused_at timestamptz;

comment on column public.customer_recurring_schedules.pause_reason is
  'Customer-facing pause wording sent by SMS and email.';
comment on column public.customer_recurring_schedules.pause_reason_code is
  'Preset id: cleaner_unavailable | finding_coverage | quality | customer_request | other.';
comment on column public.customer_recurring_schedules.paused_at is
  'When the schedule was last paused by admin.';
