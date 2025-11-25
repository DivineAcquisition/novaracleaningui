// This file updates create-payment-intent and verify-payment functions to integrate with availability system
// Instructions: Manually update these edge functions to call reserve_time_slot() before payment
// and release_time_slot() on failure

/*
In create-payment-intent/index.ts, before creating the payment intent, add:

// Reserve the time slot
const serviceDate = bookingData.serviceDate;
const startTime = bookingData.startTime; // Need to add this to booking data
const endTime = bookingData.endTime; // Need to add this to booking data

const { data: reserved, error: reserveError } = await supabase
  .rpc('reserve_time_slot', {
    _date: serviceDate,
    _start_time: startTime,
    _end_time: endTime
  });

if (!reserved || reserveError) {
  return new Response(
    JSON.stringify({ error: "This time slot just filled up. Please select another time." }),
    { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
}

In verify-payment/index.ts, on payment failure, add:

// Release the time slot
await supabase.rpc('release_time_slot', {
  _date: booking.service_date,
  _start_time: booking.start_time
});

In cancel-booking/index.ts, when cancelling, add:

// Release the time slot
await supabase.rpc('release_time_slot', {
  _date: booking.service_date,
  _start_time: booking.start_time
});
*/
