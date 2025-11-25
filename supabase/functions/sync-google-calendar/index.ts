import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface GoogleCalendarEvent {
  id: string;
  summary: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  console.log('Starting Google Calendar sync...');

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

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
      scope: 'https://www.googleapis.com/auth/calendar.readonly',
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

    console.log('Fetching events from Google Calendar...');

    // Fetch events from Google Calendar (next 30 days)
    const now30Days = new Date();
    now30Days.setDate(now30Days.getDate() + 30);
    
    const calendarResponse = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?` +
      `timeMin=${new Date().toISOString()}&` +
      `timeMax=${now30Days.toISOString()}&` +
      `singleEvents=true&` +
      `orderBy=startTime`,
      {
        headers: { Authorization: `Bearer ${access_token}` },
      }
    );

    if (!calendarResponse.ok) {
      const errorText = await calendarResponse.text();
      console.error('Calendar fetch failed:', errorText);
      throw new Error(`Failed to fetch calendar events: ${errorText}`);
    }

    const { items: events } = await calendarResponse.json();
    console.log(`Found ${events?.length || 0} events in Google Calendar`);

    if (!events || events.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No events to sync',
          eventsProcessed: 0,
          slotsBlocked: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Process each event and block corresponding slots
    let slotsBlocked = 0;
    
    for (const event of events as GoogleCalendarEvent[]) {
      const startTime = event.start.dateTime || event.start.date;
      const endTime = event.end.dateTime || event.end.date;
      
      if (!startTime || !endTime) continue;

      const startDate = new Date(startTime);
      const endDate = new Date(endTime);
      
      // Format times for database query
      const serviceDate = startDate.toISOString().split('T')[0];
      const startTimeFormatted = startDate.toTimeString().slice(0, 8);
      const endTimeFormatted = endDate.toTimeString().slice(0, 8);

      console.log(`Processing event: ${event.summary} on ${serviceDate} ${startTimeFormatted}-${endTimeFormatted}`);

      // Find matching availability slots
      const { data: slots, error: fetchError } = await supabaseClient
        .from('availability_slots')
        .select('*')
        .eq('service_date', serviceDate)
        .gte('start_time', startTimeFormatted)
        .lte('end_time', endTimeFormatted);

      if (fetchError) {
        console.error('Error fetching slots:', fetchError);
        continue;
      }

      // Block each matching slot
      for (const slot of slots || []) {
        const { error: updateError } = await supabaseClient
          .from('availability_slots')
          .update({
            current_bookings: slot.max_capacity,
            blocked_by_google: true,
            google_calendar_event_id: event.id,
            last_synced_at: new Date().toISOString(),
          })
          .eq('id', slot.id);

        if (updateError) {
          console.error('Error updating slot:', updateError);
        } else {
          slotsBlocked++;
          console.log(`Blocked slot ${slot.id} for ${slot.time_slot}`);
        }
      }
    }

    console.log(`Sync complete: ${events.length} events processed, ${slotsBlocked} slots blocked`);

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Calendar sync completed',
        eventsProcessed: events.length,
        slotsBlocked,
        lastSyncedAt: new Date().toISOString(),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in sync-google-calendar:', error);
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
