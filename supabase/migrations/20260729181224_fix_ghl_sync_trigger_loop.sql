-- ─── Stop the GHL booking-sync infinite loop ────────────────────────────────
--
-- notify_ghl_sync() fires send-zapier-webhook on every booking change, then
-- send-zapier-webhook writes results back onto the booking. To avoid recursing
-- on its own write-backs the trigger had a guard, but the guard was stated
-- backwards for robustness: "skip only if one of {ghl_synced_at,
-- ghl_sync_attempts, ghl_sync_error} changed AND every business column is
-- unchanged."
--
-- send-zapier-webhook, though, also stamps ghl_contact_id, ghl_opportunity_id
-- and — in a SEPARATE update — ghl_sales_opportunity_id. That sales-opportunity
-- write changes none of the three columns the guard's OR looks at, so the guard
-- fell through and fired the webhook again. Postgres fires row triggers on any
-- UPDATE (even one that sets a column to its current value), so this ran ~4×/s
-- against a single booking: 24h of logs showed ~370,000 trigger fires across
-- just 2 bookings, which exhausted the GHL location's 200k/day API quota and
-- took down every GHL SMS (including the contractor agreement link) with it.
--
-- The fix inverts the guard into the loop-proof form: fire ONLY when a real
-- business column actually changed (or on INSERT). Any bookkeeping-only write —
-- ghl_*, updated_at, sync stamps, anything not in the business set — changes no
-- business column and is skipped, so the write-back can never re-enter the sync.

CREATE OR REPLACE FUNCTION public.notify_ghl_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'net'
AS $function$
declare
  request_id bigint;
  fn_url constant text := 'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/send-zapier-webhook';
begin
  -- Only a real business change warrants a GHL resync. Everything the sync
  -- writes back (ghl_synced_at, ghl_sync_attempts, ghl_sync_error,
  -- ghl_contact_id, ghl_opportunity_id, ghl_sales_opportunity_id, updated_at,
  -- …) is outside this set, so a write-back never re-triggers the webhook.
  if tg_op = 'UPDATE' then
    if not (
         NEW.status is distinct from OLD.status
      or NEW.cleaner_id is distinct from OLD.cleaner_id
      or NEW.service_date is distinct from OLD.service_date
      or NEW.time_slot is distinct from OLD.time_slot
      or NEW.payment_intent_id is distinct from OLD.payment_intent_id
      or NEW.email is distinct from OLD.email
      or NEW.phone is distinct from OLD.phone
      or NEW.first_name is distinct from OLD.first_name
      or NEW.last_name is distinct from OLD.last_name
      or NEW.address is distinct from OLD.address
      or NEW.city is distinct from OLD.city
      or NEW.state is distinct from OLD.state
      or NEW.zip_code is distinct from OLD.zip_code
      or NEW.bedrooms is distinct from OLD.bedrooms
      or NEW.bathrooms is distinct from OLD.bathrooms
      or NEW.dwelling_type is distinct from OLD.dwelling_type
      or NEW.add_ons is distinct from OLD.add_ons
      or NEW.service_type is distinct from OLD.service_type
      or NEW.membership_plan is distinct from OLD.membership_plan
      or NEW.base_price_cents is distinct from OLD.base_price_cents
      or NEW.total_estimate_cents is distinct from OLD.total_estimate_cents
      or NEW.final_charge_cents is distinct from OLD.final_charge_cents
      or NEW.deposit_cents is distinct from OLD.deposit_cents
      or NEW.tip_cents is distinct from OLD.tip_cents
      or NEW.cancel_reason is distinct from OLD.cancel_reason
      or NEW.cancel_fee_cents is distinct from OLD.cancel_fee_cents
      or NEW.reschedule_fee_cents is distinct from OLD.reschedule_fee_cents
      or NEW.rating_submitted is distinct from OLD.rating_submitted
      or NEW.access_notes is distinct from OLD.access_notes
      or NEW.team_notes is distinct from OLD.team_notes
      or NEW.dispatch_notes is distinct from OLD.dispatch_notes
      or NEW.check_in_time is distinct from OLD.check_in_time
      or NEW.check_out_time is distinct from OLD.check_out_time
      or NEW.payment_option is distinct from OLD.payment_option
      or NEW.payment_method is distinct from OLD.payment_method
      or NEW.payout_status is distinct from OLD.payout_status
    ) then
      return NEW;
    end if;
  end if;

  begin
    select net.http_post(
      url := fn_url,
      body := jsonb_build_object('bookingId', NEW.id, 'source', 'pg_trigger', 'op', tg_op),
      headers := jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds := 30000
    ) into request_id;
  exception when others then
    request_id := null;
  end;

  begin
    insert into public.ghl_sync_log (booking_id, source, trigger_op, http_request_id)
    values (NEW.id, 'pg_trigger', tg_op, request_id);
  exception when others then null;
  end;

  return NEW;
end;
$function$;
