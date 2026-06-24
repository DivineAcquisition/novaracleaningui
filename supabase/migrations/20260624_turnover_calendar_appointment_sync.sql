-- Fire Google Calendar + GHL appointment sync for a turnover when it is
-- scheduled (paid/assigned), rescheduled (date/window change), or cancelled.
-- Targets the self-contained sync-turnover-calendar edge function (idempotent).
create or replace function public.notify_turnover_calendar_sync()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  fn_url constant text := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/sync-turnover-calendar';
  act text;
  req_id bigint;
begin
  if tg_op = 'UPDATE' then
    if NEW.status = 'cancelled' and OLD.status is distinct from 'cancelled' then
      act := 'cancel';
    elsif NEW.status in ('paid','assigned','cleaner_confirmed','in_progress')
          and (
            OLD.status not in ('paid','assigned','cleaner_confirmed','in_progress')
            or NEW.requested_date is distinct from OLD.requested_date
            or NEW.window_start is distinct from OLD.window_start
            or NEW.window_end is distinct from OLD.window_end
          ) then
      act := null;
    else
      return NEW;
    end if;
    begin
      select net.http_post(
        url := fn_url,
        body := jsonb_build_object('turnoverId', NEW.id)
                || case when act is null then '{}'::jsonb else jsonb_build_object('action', act) end,
        headers := jsonb_build_object('Content-Type','application/json'),
        timeout_milliseconds := 30000
      ) into req_id;
    exception when others then
      req_id := null;
    end;
  end if;
  return NEW;
end;
$$;

drop trigger if exists notify_turnover_calendar_sync on public.turnover_requests;
create trigger notify_turnover_calendar_sync
  after update on public.turnover_requests
  for each row execute function public.notify_turnover_calendar_sync();
