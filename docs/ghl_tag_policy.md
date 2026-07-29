# GHL tag policy

Tags in GoHighLevel are a **closed vocabulary**. A contact carries **at most five
tags**, one per category. Anything outside the vocabulary is dropped before it
reaches GHL — including anything an AI suggests.

Source of truth: `supabase/functions/_shared/ghl-tags.ts`. If a tag isn't in
there, it doesn't exist.

## Why it's closed

The chat agent used to ask an LLM for `tag_recommendations` and push whatever
came back, so the account filled with one-offs like `military-gift` and
`navy-family`. Contractor sync pushed up to twenty tags per person — pay tier,
service zones, skills, background-check state, eight onboarding checkboxes — all
of which were **already written to `contractor_*` custom fields in the same
request**. Six other callers invented their own shapes (`src-fb`,
`membership-paused`, `zone-20816`, `svc-2026-08-15`).

A tag vocabulary nobody can enumerate is a filter nobody can trust. Segmentation
stops working, workflows fire on the wrong things, and the tag picker becomes a
list of hundreds of near-duplicates that invite more near-duplicates.

## The slots

Priority order. When a contact exceeds five tags, the bottom of this list goes
first — and everything below `service` is data that **already lives in a GHL
custom field**, so nothing is actually lost.

| # | Slot | Example | Notes |
|---|------|---------|-------|
| 1 | `action` | `send-host-agreement-entity` | Workflow triggers. Verbatim legacy spelling — renaming one silently breaks the automation. Each trigger holds its own place, so a trigger and its marker coexist. |
| 2 | `alert` | `alert - speed to lead miss` | Something needs a human. |
| 3 | `role` | `customer`, `lead`, `member`, `contractor`, `partner`, `waitlist` | Who they are. Exactly one. |
| 4 | `status` | `lead - warm`, `member - paused`, `contractor - active`, `booking - cancelled`, `partner - host` | Where they are in that role. Exactly one. |
| 5 | `service` | `service - deep` | What they buy. |
| 6 | `zip` | `zip - 20816` | Also a custom field. |
| 7 | `source` | `source - facebook` | Also a custom field (`customer_source`, `utm_*`). |
| 8 | `campaign` | `campaign - spring` | Also a custom field. |

Values are lowercase and space-separated (`pending approval`, `move in out`,
`speed to lead miss`). Hyphens in a multi-word value are a bug — normalization
produces spaces, so a hyphenated vocabulary entry defines a tag the policy then
refuses to accept.

## What replaced what

Legacy shapes are remapped rather than discarded, so years of accumulated tags
converge instead of vanishing:

| Was | Now |
|-----|-----|
| `booking`, `commercial-booking` | `customer` |
| `membership` | `member` |
| `membership-paused/-resumed/-cancelled` | `member - paused` / `- resumed` / `- cancelled` |
| `cancelled`, `rescheduled` | `booking - cancelled`, `booking - rescheduled` |
| `contractor-active`, `onboarding-complete`, … | `contractor - active` (one status) |
| `account-commercial`, `str host`, `host-entity` | `partner - commercial`, `partner - host` |
| `call-booked`, `call-dnc`, … | `lead - booked`, `lead - unqualified`, … |
| `src-fb_lead_ads`, `cmp-spring` | `source - facebook`, `campaign - spring` |
| `zone-20816` | `zip - 20816` |
| `tier-*`, `skill-*`, `bg-check-*`, `insurance-*`, `phone-verified`, `stripe-connected`, `payouts-*`, `agreement-signed`, `discord-joined`, `supplies-reviewed`, `training-accessed`, `svc-<date>`, `home-*`, `pref-day-*`, `was-*`, `cancel-*`, `short-notice-reschedule`, `admin-rescheduled`, `payment-method-updated`, `one-time` | **Retired.** Each is a custom field. Filter on the field. |

## Replace vs merge

`POST /contacts/upsert` **replaces** the whole tag array. That is why a caller
asserting one lifecycle tag used to wipe a contact's role, service, ZIP and
source — a customer rescheduling lost their `source - facebook` attribution.

- A caller that knows the contact's **whole** picture may replace. Only the
  booking sync and lead intake are close to that, and even they now merge.
- A caller that knows **part** of the picture sets `mergeTags: true` on
  `upsertContact`. The upsert then sends fields only, and
  `reconcileContactTags()` reads the current tags, merges, applies the policy,
  and moves only the difference via the append/delete endpoints.

Asserted tags are passed **last**, so they win their slot against the contact's
history: a paused membership replaces an active one rather than sitting beside it.

## The AI does not create tags

`admin-chat-agent` may propose exactly one **lead stage** from `LEAD_STAGES`.
Everything else it observes about a customer goes into `extracted_fields`, which
is filterable and reportable. `admin-ghl-update-contact` validates every incoming
tag against the vocabulary and returns `tags_rejected` for anything outside it,
because that endpoint is reachable by the agent.

## Cleaning up what already exists

`supabase/functions/ghl-tag-cleanup` walks the location's contacts, works out
which of each contact's tags the policy recognizes, removes the rest, and
optionally deletes the orphaned tag **definitions** from the location so a
retired tag can't be picked again six months later.

**Dry run by default.** `{ apply: true }` is required to change anything. Run it
from Operations → Sync health → *GHL tag hygiene*: the first click reports what
would be removed, the second does it.

## Adding a tag

Edit `_shared/ghl-tags.ts` — add the value to the right category set, and a
`TAG_REMAP` entry if an older spelling is already in the wild. Then ask whether
it should be a custom field instead. It usually should: fields hold values, tags
hold membership, and anything you'd want to *read* rather than *filter on* is a
field.
