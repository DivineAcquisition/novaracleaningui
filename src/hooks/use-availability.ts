import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RealtimeChannel } from "@supabase/supabase-js";

export interface AvailabilitySlot {
  id: string;
  service_date: string;
  time_slot: string;
  start_time: string;
  end_time: string;
  max_capacity: number;
  current_bookings: number;
  is_available: boolean;
}

export function useAvailability(startDate: Date, endDate: Date) {
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const fetchAvailability = async () => {
    try {
      setLoading(true);
      setError(null);

      const startDateStr = startDate.toISOString().split("T")[0];
      const endDateStr = endDate.toISOString().split("T")[0];

      const { data, error: fetchError } = await supabase
        .from("availability_slots")
        .select("*")
        .gte("service_date", startDateStr)
        .lte("service_date", endDateStr)
        .order("service_date", { ascending: true })
        .order("start_time", { ascending: true });

      if (fetchError) throw fetchError;

      setAvailability(data || []);
    } catch (err) {
      console.error("Error fetching availability:", err);
      setError(err as Error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAvailability();

    // Subscribe to real-time updates
    let channel: RealtimeChannel;

    const startDateStr = startDate.toISOString().split("T")[0];
    const endDateStr = endDate.toISOString().split("T")[0];

    channel = supabase
      .channel("availability-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "availability_slots",
          filter: `service_date=gte.${startDateStr},service_date=lte.${endDateStr}`,
        },
        (payload) => {
          console.log("Availability change detected:", payload);
          fetchAvailability();
        }
      )
      .subscribe();

    return () => {
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  }, [startDate, endDate]);

  return { 
    availability, 
    loading, 
    error,
    refetch: fetchAvailability 
  };
}
