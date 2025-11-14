# Zapier Integration Documentation

## Overview
The Novara Cleaning booking system integrates with Zapier to automatically sync booking data with external systems like Jobber, Notion, or Google Sheets. Webhooks are triggered on key booking lifecycle events:
- ✅ **Booking Confirmation** - When customer completes payment
- ✅ **Cleaner Assignment** - When a cleaner is assigned to the booking
- ✅ **Booking Completion** - When service is marked complete
- ✅ **Booking Modification** - When booking details are changed
- ✅ **Booking Reschedule** - When service date/time is changed
- ✅ **Booking Cancellation** - When booking is cancelled

## Architecture

### Flow Diagram
```
Customer Payment → Stripe Webhook → Booking Confirmation → Send Zapier Webhook → External System
Cleaner Assignment → assign-cleaner → Send Zapier Webhook → External System
Booking Completion → complete-booking → Send Zapier Webhook → External System
Booking Modification → modify-booking → Send Zapier Webhook → External System
Booking Reschedule → reschedule-booking → Send Zapier Webhook → External System
Booking Cancellation → cancel-booking → Send Zapier Webhook → External System
```

### Components
1. **send-zapier-webhook** - Edge function that formats and sends booking data
2. **stripe-webhook** - Triggers Zapier webhook on successful payment
3. **assign-cleaner** - Triggers webhook when cleaner is assigned
4. **complete-booking** - Triggers webhook when booking is completed
5. **modify-booking** - Triggers webhook when booking is modified
6. **reschedule-booking** - Triggers webhook when booking is rescheduled
7. **cancel-booking** - NEW: Handles cancellation with refund logic and webhook trigger
8. **webhook_failures** - Database table tracking failed webhook attempts
9. **retry-webhook** - Edge function for manual retry of failed webhooks
10. **test-zapier-webhook** - Testing utility for validation

## Setup Instructions

### Step 1: Configure Zapier Webhook URL
The webhook URL is hardcoded in `supabase/functions/send-zapier-webhook/index.ts`:

```typescript
const ZAPIER_WEBHOOK_URL = "https://hooks.zapier.com/hooks/catch/25149972/us79bxw/";
```

To change this:
1. Create a new Zap in Zapier
2. Add a "Webhook" trigger with "Catch Hook" event
3. Copy the webhook URL provided by Zapier
4. Update the `ZAPIER_WEBHOOK_URL` constant in the code
5. Deploy the updated edge function

### Step 2: Create Your Zap

1. **Trigger**: Webhooks by Zapier → Catch Hook
2. **Test**: Use the test-zapier-webhook function to send test data
3. **Action**: Choose your destination (Jobber, Notion, Google Sheets, etc.)
4. **Map Fields**: Use the field mappings below

## Webhook Payload Structure

### Core Fields

#### Basic Job Information
- `Job ID` - UUID of the booking
- `External Job Ref` - Formatted booking number (e.g., NOV-00001)
- `Booking Channel` - Source of the booking (Website, Phone, etc.)
- `Booker Source` - New Lead or Returning Client

#### Customer Information
- `Customer Phone` - Contact phone number
- `Customer Email` - Contact email
- `Service Address` - Full formatted address
- `First Name` - Customer first name
- `Last Name` - Customer last name

#### Location Details
- `City` - Service city
- `State` - Service state
- `Zip Code` - Service zip code
- `Access Notes` - Special access instructions

#### Service Details
- `Service Type` - Standard, Deep, or Move In/Out
- `Frequency` - One-Time, Weekly, Bi-weekly, Monthly
- `Sq Ft` - Square footage range (e.g., "800–1,199")
- `Bedrooms` - Number of bedrooms
- `Bathrooms` - Number of bathrooms
- `Add-ons` - Comma-separated list of add-ons
- `Notes to Team` - Special instructions for cleaners

#### Scheduling
- `Scheduled Date` - Service date (YYYY-MM-DD)
- `Start Time` - ISO timestamp for start
- `End Time` - ISO timestamp for estimated end
- `Arrival Window` - Time window (8–10a, 12–2p, 4–6p)
- `Service Time Window` - Raw time slot (8-12, 12-16, 16-20)
- `Estimated Duration` - Hours estimated for job

#### Status & Operations
- `Status` - Booked, Assigned, Completed, Canceled
- `Cancel Reason` - Reason if canceled
- `Assigned Cleaner(s)` - Full name of assigned cleaner
- `Dispatch Notes` - Internal dispatch notes
- `Check-in Time` - When cleaner checked in
- `Check-out Time` - When cleaner checked out
- `Before/After Photos` - Comma-separated URLs
- `Issues Flag` - Boolean for quality issues
- `Issues Notes` - Description of any issues

#### Financial Information
- `Price` - Base price ($XX.XX format)
- `Deposit` - Deposit amount
- `Discount/Credit` - Total discounts applied
- `Tax` - Tax amount
- `Total Charged` - Final amount charged
- `Payment Status` - Unpaid, Deposit Paid, Paid in Full, Refunded
- `Payment Method` - Card, Cash, etc.
- `Cleaner Split %` - Percentage going to cleaner
- `Cleaner Payout` - Amount paid to cleaner
- `Company Net` - Company's net revenue
- `Tip` - Tip amount if any

### Field Mapping Examples

#### For Jobber
- Job Title → `Service Type` + `Scheduled Date`
- Client Name → `First Name` + `Last Name`
- Property Address → `Service Address`
- Job Description → `Notes to Team`
- Total Price → `Total Charged`

#### For Notion Database
- Name → `External Job Ref`
- Status → `Status`
- Customer → `First Name` + `Last Name`
- Date → `Scheduled Date`
- Amount → `Total Charged`

#### For Google Sheets
Create columns matching the field names above, Zapier will auto-populate rows.

## Cancellation Handling (Phase 7)

### Cancel Booking Function
The `cancel-booking` edge function handles the complete cancellation workflow:

**Features:**
- Validates booking can be cancelled (not already completed/cancelled)
- Processes refunds via Stripe (full, partial, or none)
- Implements refund policy:
  - Full refund: If cancelled >24 hours before service
  - Partial refund (50%): If cancelled <24 hours before service
  - No refund: Admin configurable
- Updates booking status to 'cancelled' with reason
- Releases availability slot for rebooking
- Updates cleaner stats if assigned
- Sends cancellation confirmation email
- Triggers Zapier webhook with cancellation details

**Usage:**
```typescript
const { data, error } = await supabase.functions.invoke("cancel-booking", {
  body: {
    bookingId: "uuid",
    cancelReason: "Customer requested",
    refundType: "full" // or "partial" or "none"
  }
});
```

**Admin UI Component:**
The `CancelBookingDialog` component provides an admin interface for cancelling bookings with:
- Refund type selection (Full/Partial/None)
- Required cancellation reason input
- Confirmation workflow
- Automatic webhook notification

### Webhook Payload for Cancellations
When a booking is cancelled, the webhook includes:
- `Status` field updates to "Canceled"
- `Cancel Reason` field populated with reason
- `Payment Status` updates to "Refunded" (if refund processed)
- All other booking details remain for record-keeping

## Testing the Integration

### Using the Test Function

```bash
# Call the test function (requires admin auth)
curl -X POST \
  'https://sxdraeptzuamsgjcvfeg.supabase.co/functions/v1/test-zapier-webhook' \
  -H "Authorization: Bearer YOUR_SUPABASE_ANON_KEY"
```

This will:
1. Find the most recent confirmed booking
2. Send it to the Zapier webhook
3. Return the booking ID that was sent

### Monitoring Webhook Status

Access the admin monitoring dashboard:
```
/admin/webhooks
```

Features:
- View all webhook failures
- See retry counts and error messages
- Manually retry failed webhooks
- Mark failures as resolved

## Error Handling

### Automatic Retry Logic
The system includes automatic retry with exponential backoff:
- Initial attempt
- Retry after 1 second
- Retry after 2 seconds
- Retry after 4 seconds (max 3 retries)

### Failed Webhook Storage
Failed webhooks are stored in the `webhook_failures` table:
```sql
CREATE TABLE webhook_failures (
  id UUID PRIMARY KEY,
  booking_id UUID,
  webhook_url TEXT,
  payload JSONB,
  error_message TEXT,
  retry_count INTEGER,
  resolved BOOLEAN,
  created_at TIMESTAMPTZ
);
```

### Manual Retry
Use the retry-webhook function:
```typescript
const { error } = await supabase.functions.invoke("retry-webhook", {
  body: { 
    failureId: "uuid-of-failure",
    bookingId: "uuid-of-booking"
  }
});
```

## Troubleshooting

### Webhook Not Firing
1. Check Supabase edge function logs:
   - Functions → send-zapier-webhook → Logs
2. Verify booking status is "confirmed"
3. Check stripe-webhook is triggering correctly

### Zapier Not Receiving Data
1. Verify webhook URL is correct
2. Test with test-zapier-webhook function
3. Check Zapier's webhook request history
4. Ensure Zap is turned ON

### Data Not Mapping Correctly
1. Review the payload structure in webhook_failures table
2. Check field mappings in your Zap
3. Use Zapier's "Test" feature to see actual data

### Common Errors

**"No confirmed bookings found"**
- Create a test booking and complete payment
- Check bookings table for status='confirmed'

**"Webhook URL not responding"**
- Verify Zapier webhook URL is active
- Check Zapier account status
- Test URL with curl or Postman

**"Permission denied"**
- Ensure proper RLS policies on webhook_failures table
- Check admin role is set correctly

**"Booking already cancelled"**
- Check booking status before cancellation
- Verify the booking hasn't been previously cancelled
- Use the admin dashboard to check booking history

**"Cannot cancel completed bookings"**
- Completed bookings cannot be cancelled
- Consider issuing a manual refund instead
- Contact customer directly for post-service issues

## Maintenance

### Updating Webhook URL
1. Update `ZAPIER_WEBHOOK_URL` in send-zapier-webhook/index.ts
2. Edge functions auto-deploy on push
3. Test with test-zapier-webhook

### Adding New Fields
1. Add field to payload object in send-zapier-webhook
2. Update this documentation
3. Update Zap field mappings
4. Test with recent booking

### Monitoring Best Practices
- Check webhook monitor dashboard weekly
- Resolve or retry failed webhooks promptly
- Keep Zapier webhook history for audit trail
- Monitor Supabase edge function logs

## Support

### Logs to Check
1. **Edge Function Logs**: Supabase Dashboard → Functions → Logs
2. **Webhook Failures**: Admin dashboard at /admin/webhooks
3. **Zapier History**: Zapier Dashboard → Zap History

### Key Metrics
- Success rate (bookings sent vs failures)
- Average response time
- Most common error types
- Retry success rate

### Contact
For issues with:
- **Novara System**: Check Supabase logs and webhook_failures table
- **Zapier**: Check Zap history and webhook catch hook logs
- **External System**: Check destination system's API logs

## Advanced Configuration

### Customizing Payload Format
Edit the payload object in `send-zapier-webhook/index.ts`:

```typescript
const payload = {
  // Add your custom fields here
  "Custom Field": booking.custom_data,
  // Modify existing field format
  "Date": new Date(booking.service_date).toISOString(),
};
```

### Adding Webhooks to Other Events
To send webhooks for other events (cancellation, rescheduling):

```typescript
// After booking update
await supabase.functions.invoke('send-zapier-webhook', {
  body: { bookingId: booking.id }
});
```

### Filtering Bookings
To only send certain bookings, add conditions:

```typescript
// In send-zapier-webhook/index.ts
if (booking.total_estimate_cents < 10000) {
  // Skip small bookings
  return;
}
```

## Security Considerations

1. **Webhook URL**: Treat as a secret, don't expose publicly
2. **Data Sensitivity**: Webhook includes customer PII, ensure Zapier account security
3. **RLS Policies**: Only admins can view webhook_failures
4. **Authentication**: All webhook management functions require admin role

## Version History

### v1.0 (Current)
- Initial implementation
- Stripe payment trigger
- Automatic retry logic
- Admin monitoring dashboard
- Test utilities
