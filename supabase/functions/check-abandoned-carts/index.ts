import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const handler = async (req: Request): Promise<Response> => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const now = new Date();
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
    const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    console.log("Checking for abandoned carts...");
    console.log(`Looking for first reminders (created before ${twoHoursAgo.toISOString()})`);
    console.log(`Looking for second reminders (created before ${twentyFourHoursAgo.toISOString()})`);

    // Find carts needing FIRST reminder (2+ hours old, 0 reminders sent)
    const { data: firstReminderCarts, error: firstError } = await supabase
      .from("abandoned_carts")
      .select("*")
      .is("converted_at", null)
      .eq("reminder_count", 0)
      .lt("created_at", twoHoursAgo.toISOString())
      .limit(50);

    if (firstError) {
      console.error("Error fetching first reminder carts:", firstError);
    }

    console.log(`Found ${firstReminderCarts?.length || 0} carts needing first reminder`);

    // Find carts needing SECOND reminder (24+ hours old, 1 reminder sent)
    const { data: secondReminderCarts, error: secondError } = await supabase
      .from("abandoned_carts")
      .select("*")
      .is("converted_at", null)
      .eq("reminder_count", 1)
      .lt("created_at", twentyFourHoursAgo.toISOString())
      .limit(50);

    if (secondError) {
      console.error("Error fetching second reminder carts:", secondError);
    }

    console.log(`Found ${secondReminderCarts?.length || 0} carts needing second reminder`);

    const results = {
      firstReminders: { attempted: 0, success: 0, failed: 0 },
      secondReminders: { attempted: 0, success: 0, failed: 0 },
    };

    // Sync abandoned carts to GHL as cold leads (second reminder = truly cold)
    for (const cart of secondReminderCarts || []) {
      if (cart.email && !cart.email.includes('@placeholder')) {
        fetch(`${supabaseUrl}/functions/v1/sync-contact-to-ghl`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${supabaseAnonKey}` },
          body: JSON.stringify({
            event: 'abandoned_cart',
            contactData: { firstName: cart.first_name, lastName: cart.last_name, email: cart.email, phone: cart.phone, zipCode: cart.zip_code },
            bookingData: { serviceType: cart.service_type, homeSizeId: cart.home_size, source: 'Website' },
            notes: `Abandoned cart at step: ${cart.last_step}. Session: ${cart.session_id || 'none'}`,
          }),
        }).catch(err => console.error('GHL abandoned cart sync failed:', err));
      }
    }

    // Send first reminders
    for (const cart of firstReminderCarts || []) {
      results.firstReminders.attempted++;
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/send-abandoned-cart-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            cartId: cart.id,
            isSecondReminder: false,
          }),
        });

        if (response.ok) {
          results.firstReminders.success++;
          console.log(`First reminder sent for cart ${cart.id}`);
        } else {
          results.firstReminders.failed++;
          console.error(`Failed to send first reminder for cart ${cart.id}:`, await response.text());
        }

        if (cart.phone) {
          try {
            const resumeUrl = cart.session_id
              ? `https://try.novaracleaning.com/book/zip?session=${cart.session_id}`
              : "https://try.novaracleaning.com/book/checkout";
            const smsMsg = `Hi ${cart.first_name || 'there'}! You're almost done booking your Novara cleaning. Complete your booking & save $30: ${resumeUrl}`;

            await fetch(`${supabaseUrl}/functions/v1/send-sms-notification`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseAnonKey}`,
              },
              body: JSON.stringify({
                toPhone: cart.phone,
                message: smsMsg,
                type: "reminder",
              }),
            });
            console.log(`First SMS reminder sent for cart ${cart.id}`);
          } catch (smsErr) {
            console.error(`SMS first reminder failed for cart ${cart.id}:`, smsErr);
          }
        }
      } catch (error) {
        results.firstReminders.failed++;
        console.error(`Error sending first reminder for cart ${cart.id}:`, error);
      }
    }

    // Send second reminders
    for (const cart of secondReminderCarts || []) {
      results.secondReminders.attempted++;
      try {
        const response = await fetch(`${supabaseUrl}/functions/v1/send-abandoned-cart-email`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${supabaseAnonKey}`,
          },
          body: JSON.stringify({
            cartId: cart.id,
            isSecondReminder: true,
          }),
        });

        if (response.ok) {
          results.secondReminders.success++;
          console.log(`Second reminder sent for cart ${cart.id}`);
        } else {
          results.secondReminders.failed++;
          console.error(`Failed to send second reminder for cart ${cart.id}:`, await response.text());
        }

        if (cart.phone) {
          try {
            const resumeUrl = cart.session_id
              ? `https://try.novaracleaning.com/book/zip?session=${cart.session_id}`
              : "https://try.novaracleaning.com/book/checkout";
            const smsMsg = `⚠️ Last chance ${cart.first_name || ''}! Your Novara cleaning quote expires soon. Finish booking & save $30: ${resumeUrl}`;

            await fetch(`${supabaseUrl}/functions/v1/send-sms-notification`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${supabaseAnonKey}`,
              },
              body: JSON.stringify({
                toPhone: cart.phone,
                message: smsMsg,
                type: "reminder",
              }),
            });
            console.log(`Second SMS reminder sent for cart ${cart.id}`);
          } catch (smsErr) {
            console.error(`SMS second reminder failed for cart ${cart.id}:`, smsErr);
          }
        }
      } catch (error) {
        results.secondReminders.failed++;
        console.error(`Error sending second reminder for cart ${cart.id}:`, error);
      }
    }

    console.log("Abandoned cart check complete:", results);

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        timestamp: now.toISOString(),
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in check-abandoned-carts:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

serve(handler);
