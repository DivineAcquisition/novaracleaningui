# Supabase Secrets Configuration

This document lists all the environment variables/secrets that need to be configured in your Supabase project for the application to work properly.

## Required Secrets

### Stripe Payment Processing

| Secret Name | Description | Example | Required |
|-------------|-------------|---------|----------|
| `STRIPE_PUBLISHABLE_KEY` | Stripe publishable API key (frontend) | `pk_test_...` or `pk_live_...` | **Yes** |
| `STRIPE_SECRET_KEY` | Stripe secret API key (backend) | `sk_test_...` or `sk_live_...` | **Yes** |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret for payment events | `whsec_...` | **Yes** |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Webhook signing secret for Connect events | `whsec_...` | For cleaner payouts |

### Supabase (Auto-configured)

These are automatically available in Edge Functions:

| Secret Name | Description | Auto-configured |
|-------------|-------------|-----------------|
| `SUPABASE_URL` | Your Supabase project URL | ✅ Yes |
| `SUPABASE_ANON_KEY` | Anonymous/public API key | ✅ Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (admin) | ✅ Yes |

### Email Services (Optional)

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `RESEND_API_KEY` | Resend.com API key for emails | `re_...` |
| `SENDGRID_API_KEY` | SendGrid API key (alternative) | `SG.xxx` |

### SMS Services (Optional)

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `TWILIO_ACCOUNT_SID` | Twilio account SID | `AC...` |
| `TWILIO_AUTH_TOKEN` | Twilio auth token | `...` |
| `TWILIO_PHONE_NUMBER` | Twilio phone number | `+1234567890` |

### Google Services (Optional)

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `GOOGLE_PLACES_API_KEY` | Google Places API key | `AIza...` |
| `GOOGLE_CALENDAR_CLIENT_ID` | Google Calendar OAuth client ID | `...` |
| `GOOGLE_CALENDAR_CLIENT_SECRET` | Google Calendar OAuth secret | `...` |
| `GOOGLE_CALENDAR_REDIRECT_URI` | OAuth redirect URI | `https://...` |

### Webhooks/Integrations (Optional)

| Secret Name | Description | Example |
|-------------|-------------|---------|
| `ZAPIER_WEBHOOK_URL` | Zapier webhook endpoint | `https://hooks.zapier.com/...` |
| `SLACK_WEBHOOK_URL` | Slack notifications | `https://hooks.slack.com/...` |

---

## How to Set Secrets in Supabase

### Method 1: Supabase Dashboard (Recommended)

1. Go to [Supabase Dashboard](https://supabase.com/dashboard)
2. Select your project
3. Navigate to **Project Settings** → **Edge Functions**
4. Scroll to **Secrets** section
5. Click **Add new secret**
6. Enter the secret name and value
7. Click **Save**

### Method 2: Supabase CLI

```bash
# Set a single secret
supabase secrets set STRIPE_SECRET_KEY=sk_test_your_key_here

# Set multiple secrets
supabase secrets set STRIPE_SECRET_KEY=sk_test_... STRIPE_PUBLISHABLE_KEY=pk_test_...

# View existing secrets (names only)
supabase secrets list
```

---

## Getting Your Stripe Keys

### Test Mode Keys (for development)

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Toggle **Test mode** in the top right
3. Go to **Developers** → **API keys**
4. Copy:
   - **Publishable key** (starts with `pk_test_`)
   - **Secret key** (starts with `sk_test_`)

### Webhook Secret

1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Set endpoint URL to: `https://your-project.supabase.co/functions/v1/stripe-webhook`
4. Select events to listen for:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `checkout.session.completed`
5. Click **Add endpoint**
6. Click **Reveal** next to signing secret and copy it

### Stripe Connect Webhook (for cleaner payouts)

1. Go to **Developers** → **Webhooks**
2. Click **Add endpoint**
3. Set endpoint URL to: `https://your-project.supabase.co/functions/v1/stripe-connect-webhook`
4. Select **Connect** events:
   - `account.updated`
   - `account.application.deauthorized`
   - `capability.updated`
   - `transfer.created`
   - `transfer.failed`
5. Copy the signing secret

---

## Health Check

After setting up your secrets, you can verify the configuration by calling:

```bash
curl https://your-project.supabase.co/functions/v1/stripe-health-check
```

This will return a JSON response showing which secrets are configured and if Stripe connectivity works.

Example healthy response:
```json
{
  "status": "healthy",
  "checks": [
    { "name": "STRIPE_PUBLISHABLE_KEY", "status": "pass" },
    { "name": "STRIPE_SECRET_KEY", "status": "pass" },
    { "name": "Stripe API Connection", "status": "pass" }
  ]
}
```

---

## Troubleshooting

### "STRIPE_PUBLISHABLE_KEY not configured"
- Make sure you've added the secret in Supabase Dashboard
- Verify the secret name is exactly `STRIPE_PUBLISHABLE_KEY` (case-sensitive)
- Redeploy the Edge Function: `supabase functions deploy get-stripe-publishable-key`

### "Payment form not loading"
- Check browser console for errors
- Verify STRIPE_PUBLISHABLE_KEY starts with `pk_test_` or `pk_live_`
- Ensure both publishable and secret keys are from the same Stripe mode

### "Webhook signature verification failed"
- Make sure STRIPE_WEBHOOK_SECRET starts with `whsec_`
- Verify you're using the correct webhook endpoint URL
- Check that the webhook is active in Stripe Dashboard

### "Payment intent creation failed"
- Verify STRIPE_SECRET_KEY is correct
- Check Stripe Dashboard for any restrictions on your account
- Review Edge Function logs in Supabase Dashboard

---

## Live Mode Checklist

Before going to production:

- [ ] Replace all `pk_test_` and `sk_test_` keys with `pk_live_` and `sk_live_`
- [ ] Create new webhook endpoints with live URLs
- [ ] Update webhook secrets in Supabase
- [ ] Test a real payment with a small amount
- [ ] Verify webhook events are being received
- [ ] Enable Stripe Radar for fraud protection
