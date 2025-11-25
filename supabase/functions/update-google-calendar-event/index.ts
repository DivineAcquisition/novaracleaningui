import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('Updating Google Calendar event...');

  try {
    const { bookingId, action } = await req.json();
    
    if (!bookingId) {
      throw new Error('Booking ID is required');
    }

    if (!action || !['reschedule', 'cancel'].includes(action)) {
      throw new Error('Action must be either "reschedule" or "cancel"');
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Fetch booking details
    const { data: booking, error: fetchError } = await supabaseClient
      .from('bookings')
      .select('*')
      .eq('id', bookingId)
      .single();

    if (fetchError || !booking) {
      throw new Error(`Booking not found: ${fetchError?.message}`);
    }

    if (!booking.google_calendar_event_id) {
      console.log('No Google Calendar event ID found for booking, skipping update');
      return new Response(
        JSON.stringify({
          success: true,
          message: 'No calendar event to update',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const calendarId = Deno.env.get('GOOGLE_CALENDAR_ID');
    const serviceAccountEmail = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const privateKey = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY');

    if (!calendarId || !serviceAccountEmail || !privateKey) {
      throw new Error('Missing Google Calendar credentials');
    }

    console.log('Generating JWT for Google Calendar API...');

    // Create JWT for Google Calendar API
    const now = Math.floor(Date.now() / 1000);
    const jwtHeader = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const jwtPayload = btoa(JSON.stringify({
      iss: serviceAccountEmail,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }));

    // Sign JWT with private key
    const encoder = new TextEncoder();
    const keyData = privateKey.replace(/\\n/g, '\n');
    const pemHeader = '-----BEGIN PRIVATE KEY-----';
    const pemFooter = '-----END PRIVATE KEY-----';
    const pemContents = keyData.substring(
      keyData.indexOf(pemHeader) + pemHeader.length,
      keyData.indexOf(pemFooter)
    ).trim();
    
    const binaryKey = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));
    const cryptoKey = await crypto.subtle.importKey(
      'pkcs8',
      binaryKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['sign']
    );

    const signature = await crypto.subtle.sign(
      'RSASSA-PKCS1-v1_5',
      cryptoKey,
      encoder.encode(`${jwtHeader}.${jwtPayload}`)
    );

    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    const jwt = `${jwtHeader}.${jwtPayload}.${signatureBase64}`;

    console.log('Exchanging JWT for access token...');

    // Exchange JWT for access token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('Token exchange failed:', errorText);
      throw new Error(`Failed to get access token: ${errorText}`);
    }

    const { access_token } = await tokenResponse.json();

    if (action === 'cancel') {
      console.log('Deleting calendar event...');
      
      // Delete the event
      const deleteResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${booking.google_calendar_event_id}`,
        {
          method: 'DELETE',
          headers: {
            Authorization: `Bearer ${access_token}`,
          },
        }
      );

      if (!deleteResponse.ok && deleteResponse.status !== 404) {
        const errorText = await deleteResponse.text();
        console.error('Event deletion failed:', errorText);
        throw new Error(`Failed to delete calendar event: ${errorText}`);
      }

      console.log(`Deleted Google Calendar event: ${booking.google_calendar_event_id}`);

      // Clear event ID from booking
      const { error: updateError } = await supabaseClient
        .from('bookings')
        .update({ google_calendar_event_id: null })
        .eq('id', bookingId);

      if (updateError) {
        console.error('Error clearing event ID from booking:', updateError);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Calendar event deleted',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (action === 'reschedule') {
      console.log('Updating calendar event...');

      // Parse booking time slot to get start/end times
      const [startTime, endTime] = booking.time_slot.split(' - ');
      
      // Format start and end datetime
      const startDateTime = new Date(`${booking.service_date}T${convertTo24Hour(startTime)}`);
      const endDateTime = new Date(`${booking.service_date}T${convertTo24Hour(endTime)}`);

      // Update event payload
      const eventPayload = {
        summary: `Booking #${booking.booking_number || booking.id.slice(0, 8)} - ${booking.first_name} ${booking.last_name} - ${booking.service_type}`,
        description: `
Service: ${booking.service_type}
Customer: ${booking.first_name} ${booking.last_name}
Phone: ${booking.phone}
Email: ${booking.email}
Address: ${booking.address}, ${booking.city}, ${booking.state} ${booking.zip_code}
${booking.add_ons?.length ? `Add-ons: ${booking.add_ons.join(', ')}` : ''}
${booking.team_notes ? `Team Notes: ${booking.team_notes}` : ''}
        `.trim(),
        location: `${booking.address}, ${booking.city}, ${booking.state} ${booking.zip_code}`,
        start: {
          dateTime: startDateTime.toISOString(),
          timeZone: 'America/New_York',
        },
        end: {
          dateTime: endDateTime.toISOString(),
          timeZone: 'America/New_York',
        },
      };

      const updateResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${booking.google_calendar_event_id}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(eventPayload),
        }
      );

      if (!updateResponse.ok) {
        const errorText = await updateResponse.text();
        console.error('Event update failed:', errorText);
        throw new Error(`Failed to update calendar event: ${errorText}`);
      }

      const event = await updateResponse.json();
      console.log(`Updated Google Calendar event: ${event.id}`);

      return new Response(
        JSON.stringify({
          success: true,
          eventId: event.id,
          eventLink: event.htmlLink,
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Invalid action' }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('Error in update-google-calendar-event:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});

// Helper function to convert 12-hour time to 24-hour format
function convertTo24Hour(time12h: string): string {
  const [time, modifier] = time12h.trim().split(' ');
  let [hours, minutes] = time.split(':');
  
  if (hours === '12') {
    hours = '00';
  }
  
  if (modifier?.toUpperCase() === 'PM') {
    hours = String(parseInt(hours, 10) + 12);
  }
  
  return `${hours.padStart(2, '0')}:${minutes}:00`;
}
