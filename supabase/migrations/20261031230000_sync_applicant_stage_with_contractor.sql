-- One lifecycle, two views. The Applicants tab reads cleaner_applicants.stage and
-- the Contractors tab reads cleaners.status. Activating from either side used to
-- update only its own table, so the two disagreed (an applicant "Active" with no
-- active contractor, or an active contractor whose applicant row still said
-- "Onboarding"). The contractor row is the source of truth: when its status
-- changes, the linked applicant row follows.

create or replace function public.sync_applicant_stage_from_cleaner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  s text := lower(coalesce(new.status, ''));
begin
  if s = 'active' then
    update public.cleaner_applicants
       set stage = 'active',
           rejection_reason = null,
           stage_changed_at = now(),
           stage_changed_by = 'system:contractor-sync'
     where cleaner_id = new.id
       and stage <> 'active';
  elsif s = 'pending' then
    update public.cleaner_applicants
       set stage = 'onboarding',
           stage_changed_at = now(),
           stage_changed_by = 'system:contractor-sync'
     where cleaner_id = new.id
       and stage = 'active';
  end if;
  return new;
end;
$$;

drop trigger if exists sync_applicant_stage_from_cleaner on public.cleaners;
create trigger sync_applicant_stage_from_cleaner
  after insert or update of status on public.cleaners
  for each row
  execute function public.sync_applicant_stage_from_cleaner();

update public.cleaner_applicants a
   set stage = 'active',
       rejection_reason = null,
       stage_changed_at = now(),
       stage_changed_by = 'system:contractor-sync'
  from public.cleaners c
 where c.id = a.cleaner_id
   and lower(coalesce(c.status, '')) = 'active'
   and a.stage <> 'active';

update public.cleaner_applicants a
   set stage = 'onboarding',
       stage_changed_at = now(),
       stage_changed_by = 'system:contractor-sync'
  from public.cleaners c
 where c.id = a.cleaner_id
   and lower(coalesce(c.status, '')) = 'pending'
   and a.stage = 'active';
