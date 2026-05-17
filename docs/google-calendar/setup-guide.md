# Google Calendar Integration — Setup Guide

The integration is **already coded and credentials are already in Supabase**. There is **one click left** to make it work: enable the Calendar API in your Google Cloud project.

---

## What's already done

| Layer | Status |
|---|---|
| 3 edge functions deployed: `create-google-calendar-event`, `update-google-calendar-event`, `sync-google-calendar` | ✅ |
| Health-check endpoint `google-calendar-health` | ✅ |
| DB columns `bookings.google_calendar_event_id` + `availability_slots.google_calendar_event_id / blocked_by_google / last_synced_at` | ✅ |
| Wired into the lifecycle: payment_succeeded creates event, reschedule updates it, cancel deletes it | ✅ |
| Supabase secrets: `GOOGLE_CALENDAR_ID`, `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` | ✅ |
| Service account: `novaracleaning@serious-physics-477016-v4.iam.gserviceaccount.com` | ✅ |
| Target calendar: `c_0567c0779a5d60679fbdb02b6b231970adee190fd56c27cd49a6b3f0a2ab1d4c@group.calendar.google.com` | ✅ |
| `verify_jwt = false` on all calendar functions so any service can invoke | ✅ |

---

## What you need to do (one-time, ~5 min total)

### Step 1 · Enable Google Calendar API ← currently blocking

The health check is reporting:

> `SERVICE_DISABLED — Google Calendar API has not been used in project 10983869932`

**Fix:**

1. Open: <https://console.developers.google.com/apis/api/calendar-json.googleapis.com/overview?project=10983869932>
2. Click the big **"ENABLE"** button.
3. Wait 1–2 minutes for Google to propagate.

### Step 2 · Verify the service account has calendar access

The service account email needs **"Make changes to events"** permission on your Novara calendar. If the calendar was created by a Google user (not by the service account itself), you almost certainly need to share it.

1. Open <https://calendar.google.com>
2. Find your **Novara** calendar in the left sidebar.
3. Hover over it → click the three dots → **"Settings and sharing"**.
4. Scroll to **"Share with specific people or groups"** → **"Add people and groups"**.
5. Paste: `novaracleaning@serious-physics-477016-v4.iam.gserviceaccount.com`
6. Permission: **"Make changes to events"** (NOT "See all event details" — we need write).
7. Click **Send**.

### Step 3 · Verify with the health endpoint

```
curl https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/google-calendar-health | jq
```

You should see:

```json
{
  "ok": true,
  "calendar_id": "c_0567...@group.calendar.google.com",
  "calendar_summary": "Novara Cleaning",
  "calendar_timezone": "America/New_York",
  "upcoming_events_count": 0,
  "upcoming_events": [],
  "checked_at": "2026-05-17T..."
}
```

If `ok: false`, the response will include a `hint` and (where applicable) a `fix_url` pointing at exactly what to do next.

### Step 4 · Backfill events for existing confirmed bookings (optional, ~1 min)

You have 10 `status='confirmed'` bookings with no calendar event. To push them all to the calendar at once:

```sql
-- Run from the SQL editor; the PG trigger we built will fire send-zapier-webhook
-- but NOT create-google-calendar-event. So invoke directly via the edge function:
```

```bash
# Then from a terminal (replace with each booking id):
for id in $(supabase db query --output json "select id from bookings where status='confirmed' and google_calendar_event_id is null"); do
  curl -sS -X POST "https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/create-google-calendar-event" \
    -H "Content-Type: application/json" \
    -d "{\"bookingId\":\"$id\"}"
  sleep 1
done
```

Or just trigger the cron we set up in §6 below — it will catch all 10 within a few minutes.

---

## How the integration behaves (now that step 1 + 2 are done)

| Event in Novara | What happens in Google Calendar |
|---|---|
| Customer pays deposit → `stripe-webhook` marks booking `confirmed` | `create-google-calendar-event` fires → event created on the Novara calendar with title `Cleaning — {first_name} {last_name}`, location = full address, description = booking details + tags |
| Customer reschedules → `reschedule-booking` runs | `update-google-calendar-event(action: 'reschedule')` → PATCHes start/end times on the existing event |
| Customer cancels → `cancel-booking` runs | `update-google-calendar-event(action: 'cancel')` → DELETEs the event + clears `google_calendar_event_id` on the row |
| Admin manually creates a booking from `/admin/sales` | Same as above — creates the event |
| Operator drops a manual event onto the calendar (e.g. holiday block, sick day) | `sync-google-calendar` cron picks it up → marks overlapping `availability_slots` as full + sets `blocked_by_google = true` so the booking funnel won't sell that slot |

**Two-way sync:** Novara → Google is real-time. Google → Novara is via the cron (every 15 min by default). Operators can extend their reach by adding events directly to the Google Calendar — those slots become unbookable on the funnel automatically.

---

## Monitoring

### Quick sanity check anytime

```
GET https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/google-calendar-health
```

Green dot if `ok: true`. Includes calendar summary + next 5 events.

### Recent bookings missing a calendar event

```sql
select id, status, service_date, first_name, last_name, ghl_synced_at
from bookings
where status = 'confirmed'
  and google_calendar_event_id is null
  and service_date > current_date
order by service_date asc;
```

### Slots blocked by Google Calendar holds

```sql
select service_date, start_time, end_time, google_calendar_event_id, last_synced_at
from availability_slots
where blocked_by_google = true
order by service_date asc, start_time asc;
```

### Last 5 sync-google-calendar runs

Check Supabase Dashboard → Edge Functions → `sync-google-calendar` → Logs.

---

## Architecture notes

### Why service account (not OAuth user consent)

- The Novara calendar is **owned by the business**, not by a specific person. Service account = no user account needed, no token refresh dance.
- Permissions are explicit: only what the calendar is shared with the service account.
- Survives team changes (no "what if the user who connected leaves" problem).

### Why `verify_jwt = false` on these functions

- They're invoked server-to-server from other edge functions (`stripe-webhook`, `cancel-booking`, `reschedule-booking`) — there's no user JWT to verify.
- They don't accept arbitrary parameters that would let an attacker do harm: they read everything from the `bookings` table by id.
- The only outbound effects are on a calendar that's already private to the org.

### Timezone handling

Currently hardcoded to `America/New_York` in `create-google-calendar-event`. If you expand to multiple markets, we'd swap this to derive from the booking's ZIP. Trivial change — flag it when needed.

---

## What's NOT included (yet — easy adds when needed)

- **Per-cleaner calendars.** Today all events go to the one shared Novara calendar. To give each cleaner their own calendar feed, we'd add `cleaner.google_calendar_id` + invite the cleaner's email to each event.
- **Customer ICS attachments.** Already implemented via `_shared/calendar-utils.ts` — confirmation emails attach a `.ics` so the customer can add the cleaning to their own calendar.
- **Booking-page "Add to Calendar" button.** Could surface the `.ics` as a download from `/account` — say the word.
