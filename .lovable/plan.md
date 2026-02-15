

# Capture fbclid and Pass to GHL Webhook

## What This Does

Captures the `fbclid` parameter from the URL (added by Meta when someone clicks a Facebook/Instagram ad) and sends it to GHL in the lead capture webhook payload. GHL needs this to trigger its Meta Conversions API action and attribute the lead back to the ad click.

## How It Works

When a user lands on the site from a Meta ad, the URL looks like:
`https://novaracleaning.com/?fbclid=AbCdEfG123...`

We capture that value on page load and include it in the webhook payload sent to GHL.

## Changes

### 1. `src/pages/book/Zip.tsx`
- Read `fbclid` from URL search params (alongside existing `ref` param)
- Include `fbclid` in the `send-lead-capture-webhook` body

### 2. `src/pages/Index.tsx`
- Read `fbclid` from URL search params
- Include `fbclid` in the `send-lead-capture-webhook` body

### 3. `supabase/functions/send-lead-capture-webhook/index.ts`
- Add `fbclid` to the `LeadCapturePayload` interface
- Add `"Facebook Click ID": leadData.fbclid` to the GHL webhook payload so GHL can map it to its Meta CAPI action

### Files Changed

| File | Change |
|---|---|
| `src/pages/book/Zip.tsx` | Capture `fbclid` from URL, pass to webhook |
| `src/pages/Index.tsx` | Capture `fbclid` from URL, pass to webhook |
| `supabase/functions/send-lead-capture-webhook/index.ts` | Accept and forward `fbclid` in GHL payload |

