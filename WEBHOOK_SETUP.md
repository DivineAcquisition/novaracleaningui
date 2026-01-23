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

## External Webhook Integrations (Zapier & GHL)

Novara supports sending webhooks to external services like Zapier and GoHighLevel (GHL) for various events.

### Webhook Endpoints (Supabase Edge Functions)

| Function | Description | Trigger |
|----------|-------------|---------|
| `send-zapier-webhook` | Sends booking data to Zapier/GHL | Booking created, updated, completed |
| `send-lead-capture-webhook` | Sends lead data to CRM | Landing page form submission |
| `ghl-inbound-webhook` | Receives bookings from GHL | GHL contact/booking workflow |
| `send-cleaner-assignment-webhook` | Notifies when cleaner is assigned | Cleaner assigned to booking |
| `send-cleaner-payout-webhook` | Notifies when payout is processed | Payout completed |

### Environment Variables Required

Add these to your Supabase Edge Function secrets:

```bash
# Outbound Zapier Webhooks
ZAPIER_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/...
ZAPIER_BOOKING_WEBHOOK_URL_2=https://hooks.zapier.com/hooks/catch/...  # Secondary
ZAPIER_DISPATCH_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/...
ZAPIER_LEAD_CAPTURE_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/...
ZAPIER_CLEANER_ASSIGNMENT_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/...
ZAPIER_CLEANER_PAYOUT_WEBHOOK_URL=https://hooks.zapier.com/hooks/catch/...

# Outbound GoHighLevel Webhooks
GHL_BOOKING_WEBHOOK_URL=https://services.leadconnectorhq.com/hooks/...
GHL_LEAD_CAPTURE_WEBHOOK_URL=https://services.leadconnectorhq.com/hooks/...
GHL_CLEANER_ASSIGNMENT_WEBHOOK_URL=https://services.leadconnectorhq.com/hooks/...
GHL_CLEANER_PAYOUT_WEBHOOK_URL=https://services.leadconnectorhq.com/hooks/...

# Inbound GHL Webhook Secret (optional, for signature validation)
GHL_WEBHOOK_SECRET=your-secret-here
```

### Inbound GHL Webhook Endpoint

To receive bookings/leads FROM GoHighLevel:

**Endpoint URL:**
```
https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/ghl-inbound-webhook
```

**Expected Payload Format:**
```json
{
  "type": "contact.created",
  "contact": {
    "first_name": "John",
    "last_name": "Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "address1": "123 Main St",
    "city": "Dallas",
    "state": "TX",
    "postal_code": "75001"
  },
  "customFields": {
    "service_type": "deep",
    "home_size": "2001-2500",
    "service_date": "2025-02-01",
    "time_slot": "morning"
  }
}
```

### Booking Webhook Payload (Outbound)

When a booking is created/updated, the following data is sent:

```json
{
  "Job ID": "uuid",
  "External Job Ref": "NOV-00001",
  "Customer Phone": "+1234567890",
  "Customer Email": "john@example.com",
  "Service Address": "123 Main St, Dallas, TX 75001",
  "Service Type": "Deep Cleaning",
  "Sq Ft": "2001-2500",
  "Scheduled Date": "2025-02-01",
  "Arrival Window": "8–10a",
  "Status": "Booked",
  "Assigned Cleaner Name": "Jane Smith",
  "Total Charged": "$225.00",
  "Deposit": "$39.00",
  ...
}
```

### Cleaner Assignment Webhook Payload

When a cleaner is assigned to a booking:

```json
{
  "Event Type": "Cleaner Assigned",
  "Booking Number": "NOV-00001",
  "Customer Name": "John Doe",
  "Service Address": "123 Main St, Dallas, TX 75001",
  "Service Date": "Saturday, February 1, 2025",
  "Cleaner Name": "Jane Smith",
  "Cleaner Phone": "+1987654321",
  "Cleaner Rating": "4.8 (42 reviews)",
  "Estimated Cleaner Payout": "$90.00",
  ...
}
```

### Cleaner Payout Webhook Payload

When a payout is processed:

```json
{
  "Event Type": "Payout Completed",
  "Payout Status": "Completed",
  "Cleaner Name": "Jane Smith",
  "Total Payout Amount": "$90.00",
  "Number of Jobs": 1,
  "Job IDs": "NOV-00001",
  "Stripe Transfer ID": "tr_...",
  ...
}
```

### Testing Webhooks

1. **Test Zapier webhook manually:**
   ```bash
   curl -X POST https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/test-zapier-webhook \
     -H "Content-Type: application/json" \
     -d '{"bookingId": "your-booking-id"}'
   ```

2. **Test GHL inbound webhook:**
   ```bash
   curl -X POST https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/ghl-inbound-webhook \
     -H "Content-Type: application/json" \
     -d '{
       "contact": {
         "first_name": "Test",
         "last_name": "User",
         "email": "test@example.com",
         "phone": "1234567890"
       }
     }'
   ```

### Webhook Monitoring

- **View webhook failures:** `/admin/webhooks` in your app
- **View webhook logs:** Check `webhook_logs` and `webhook_failures` tables in Supabase

---

**Note**: The Zapier webhooks (`send-zapier-webhook`, `test-zapier-webhook`) are working correctly as shown in your logs. This setup is specifically for Stripe payment webhooks.
