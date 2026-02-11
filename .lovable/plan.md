

# Abandoned Cart Email via Migma (with Direct Placeholders)

## Overview
Update `send-abandoned-cart-email` to fetch the HTML template from Migma, populate placeholders using direct cart data values (no GHL-style naming), and fall back to React Email if Migma fails.

## Migma Conversation ID
`698acaea41154eb80fab602e`

## Placeholder Strategy
Instead of GHL-style `{{contact.first_name}}`, use straightforward placeholders mapped directly from abandoned cart fields:

| Placeholder | Source |
|---|---|
| `{{first_name}}` | `cart.first_name` |
| `{{service_type}}` | `cart.service_type` |
| `{{home_size}}` | `cart.home_size` |
| `{{resume_url}}` | Generated resume booking link |
| `{{zip_code}}` | `cart.zip_code` |

## Changes

### 1. `supabase/functions/send-abandoned-cart-email/index.ts`
- Add `fetchMigmaTemplate()` (reuse same pattern from `send-booking-email`)
- Add `populateAbandonedCartTemplate()` with direct placeholder names
- Try Migma first; on failure, fall back to existing React Email `AbandonedCartReminder`
- Keep `testMode` support intact
- No changes to subject line logic or Resend sending

### 2. Flow

```text
Request --> Fetch Migma HTML (conversation 698acaea...)
              |
              +-- Success --> Replace {{first_name}}, {{resume_url}}, etc. --> Send via Resend
              |
              +-- Failure --> Render AbandonedCartReminder (React Email) --> Send via Resend
```

### What stays the same
- `check-abandoned-carts` cron job (no changes)
- `testMode` behavior
- Subject lines (1st vs 2nd reminder)
- Resend delivery from `hello@novaracleaning.com`
- `MIGMA_API_KEY` secret (already configured)

