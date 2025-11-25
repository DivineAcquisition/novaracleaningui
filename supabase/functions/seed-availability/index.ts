import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface TimeSlot {
  label: string;
  startTime: string;
  endTime: string;
}

const TIME_SLOTS: TimeSlot[] = [
  { label: "8:00 AM - 10:00 AM", startTime: "08:00", endTime: "10:00" },
  { label: "10:00 AM - 12:00 PM", startTime: "10:00", endTime: "12:00" },
  { label: "12:00 PM - 2:00 PM", startTime: "12:00", endTime: "14:00" },
  { label: "2:00 PM - 4:00 PM", startTime: "14:00", endTime: "16:00" },
  { label: "4:00 PM - 6:00 PM", startTime: "16:00", endTime: "18:00" },
];

serve(async (req) => {
  // Handle CORS
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    // Check authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("No authorization header");
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace("Bearer ", "")
    );

    if (authError || !user) {
      throw new Error("Unauthorized");
    }

    // Check if user is admin
    const { data: roleData, error: roleError } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .eq("role", "admin")
      .maybeSingle();

    if (roleError || !roleData) {
      throw new Error("Admin access required");
    }

    const { days = 60, maxCapacity = 3 } = await req.json();

    console.log(`Seeding availability for ${days} days with capacity ${maxCapacity}`);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const slots = [];

    for (let i = 0; i < days; i++) {
      const currentDate = new Date(today);
      currentDate.setDate(today.getDate() + i);
      
      const dayOfWeek = currentDate.getDay();
      
      // Skip weekends (0 = Sunday, 6 = Saturday)
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue;
      }

      const dateString = currentDate.toISOString().split("T")[0];

      for (const timeSlot of TIME_SLOTS) {
        slots.push({
          service_date: dateString,
          time_slot: timeSlot.label,
          start_time: timeSlot.startTime,
          end_time: timeSlot.endTime,
          max_capacity: maxCapacity,
          current_bookings: 0,
        });
      }
    }

    console.log(`Inserting ${slots.length} availability slots`);

    // Insert slots with conflict handling
    const { data, error } = await supabase
      .from("availability_slots")
      .upsert(slots, { 
        onConflict: "service_date,start_time",
        ignoreDuplicates: false 
      })
      .select();

    if (error) {
      console.error("Error inserting slots:", error);
      throw error;
    }

    console.log(`Successfully seeded ${data?.length || 0} availability slots`);

    return new Response(
      JSON.stringify({ 
        success: true, 
        count: data?.length || 0,
        message: `Seeded ${data?.length || 0} availability slots` 
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { 
        status: errorMessage.includes("Unauthorized") || errorMessage.includes("Admin") ? 403 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});
