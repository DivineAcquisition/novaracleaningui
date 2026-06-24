-- ─── Turnover cleaner photo-upload via tokenized SMS link ──────────────────
--
-- Cleaners working turnovers were told (by SMS) to submit photos but had no
-- way to upload from the text, and the SMS gate could falsely report success.
-- This adds:
--   1. A public `turnover-photos` Storage bucket (mirrors cleaner-job-photos)
--      so both the in-app flow and the new token page can upload.
--   2. A single-use `photo_upload_token` on turnover_requests (+ sent/submitted
--      stamps) that powers the public /cleaner/turnover-photos/[token] page.
--   3. A trigger that texts the assigned cleaner the upload link the moment a
--      turnover is assigned, via the self-contained `turnover-photos` edge fn.

-- 1) Storage bucket + policies -------------------------------------------------
insert into storage.buckets (id, name, public)
values ('turnover-photos', 'turnover-photos', true)
on conflict (id) do update set public = true;

drop policy if exists turnover_photos_anon_upload on storage.objects;
create policy turnover_photos_anon_upload
  on storage.objects for insert to anon
  with check (bucket_id = 'turnover-photos');

drop policy if exists turnover_photos_public_read on storage.objects;
create policy turnover_photos_public_read
  on storage.objects for select to anon
  using (bucket_id = 'turnover-photos');

drop policy if exists turnover_photos_authd_upload on storage.objects;
create policy turnover_photos_authd_upload
  on storage.objects for insert to authenticated
  with check (bucket_id = 'turnover-photos');

drop policy if exists turnover_photos_service_role on storage.objects;
create policy turnover_photos_service_role
  on storage.objects for all to service_role
  using (bucket_id = 'turnover-photos')
  with check (bucket_id = 'turnover-photos');

-- 2) Token columns -------------------------------------------------------------
alter table public.turnover_requests
  add column if not exists photo_upload_token text
    default replace(gen_random_uuid()::text, '-', ''),
  add column if not exists photo_upload_sent_at timestamptz,
  add column if not exists photo_upload_submitted_at timestamptz;

-- Backfill tokens for any rows that predate the default.
update public.turnover_requests
   set photo_upload_token = replace(gen_random_uuid()::text, '-', '')
 where photo_upload_token is null;

create unique index if not exists turnover_requests_photo_upload_token_idx
  on public.turnover_requests (photo_upload_token);

-- 3) SMS the upload link when a turnover is assigned --------------------------
create or replace function public.notify_turnover_photo_link()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $$
declare
  fn_url constant text := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/turnover-photos';
  req_id bigint;
begin
  if tg_op = 'UPDATE'
     and NEW.status = 'assigned'
     and OLD.status is distinct from 'assigned'
     and NEW.assigned_cleaner_id is not null then
    begin
      select net.http_post(
        url := fn_url,
        body := jsonb_build_object('op', 'sendlink', 'turnoverId', NEW.id),
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

drop trigger if exists notify_turnover_photo_link on public.turnover_requests;
create trigger notify_turnover_photo_link
  after update on public.turnover_requests
  for each row execute function public.notify_turnover_photo_link();
