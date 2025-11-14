# Stripe Webhook Setup Guide

Your Stripe webhook endpoint is configured and ready, but you need to add it to your Stripe Dashboard to receive webhook events.

## Webhook Endpoint URL

```
https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/stripe-webhook
```

## Setup Steps

### 1. Go to Stripe Dashboard
Visit: https://dashboard.stripe.com/webhooks

### 2. Click "Add endpoint"

### 3. Configure the endpoint:
- **Endpoint URL**: `https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/stripe-webhook`
- **Description**: "Lovable App Webhook Handler"
- **Events to send**: Select the following events:
  - `payment_intent.succeeded`
  - `checkout.session.completed`
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `invoice.paid`
  - `invoice.payment_failed`

### 4. Get the Signing Secret
After creating the endpoint, Stripe will show you a **Webhook Signing Secret** (starts with `whsec_...`)

### 5. Update your Supabase Secret
You've already configured `STRIPE_WEBHOOK_SECRET` in your Supabase secrets. If you need to update it:
1. Go to: https://supabase.com/dashboard/project/sxdraeptzuamsgjcvfeg/settings/functions
2. Update the `STRIPE_WEBHOOK_SECRET` value with your new signing secret

## Testing the Webhook

### Test from Stripe Dashboard
1. Go to your webhook endpoint in Stripe
2. Click "Send test webhook"
3. Select an event type (e.g., `payment_intent.succeeded`)
4. Click "Send test webhook"

### Monitor Webhook Logs
Check the webhook logs in Supabase:
```
Edge Function Logs: https://supabase.com/dashboard/project/sxdraeptzuamsgjcvfeg/functions/stripe-webhook/logs
```

## Webhook Events Currently Handled

The webhook handler processes these events:

| Event | Action |
|-------|--------|
| `payment_intent.succeeded` | Confirms booking, sends confirmation email |
| `checkout.session.completed` | Creates subscription, allocates credits, sends welcome email |
| `customer.subscription.updated` | Handles subscription changes |
| `customer.subscription.deleted` | Handles subscription cancellation |
| `invoice.paid` | Allocates credits for recurring billing |

## Important Security Notes

✅ **JWT verification is disabled** for this endpoint (required for webhooks)
✅ **Webhook signature validation** is enabled using `STRIPE_WEBHOOK_SECRET`
✅ **Idempotency checks** prevent duplicate processing

## Troubleshooting

### Webhook not receiving events?
1. Verify the endpoint URL is correct in Stripe Dashboard
2. Check that webhook secret is properly configured
3. Review Edge Function logs for errors

### Test webhook failing?
1. Check Supabase Edge Function logs
2. Verify STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set
3. Ensure endpoint is publicly accessible (JWT disabled in config)

## Monitoring

- **Webhook Failures**: View in your app at `/admin/webhooks`
- **Edge Function Logs**: https://supabase.com/dashboard/project/sxdraeptzuamsgjcvfeg/functions/stripe-webhook/logs
- **Stripe Events**: https://dashboard.stripe.com/events

---

**Note**: The Zapier webhooks (`send-zapier-webhook`, `test-zapier-webhook`) are working correctly as shown in your logs. This setup is specifically for Stripe payment webhooks.
