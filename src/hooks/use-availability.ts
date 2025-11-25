import { useState, useEffect, useRef } from "react";
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
  google_calendar_event_id?: string | null;
  blocked_by_google?: boolean | null;
  last_synced_at?: string | null;
}

export function useAvailability(startDate: Date, endDate: Date) {
  const [availability, setAvailability] = useState<AvailabilitySlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);
  const isFetchingRef = useRef(false);

  const syncWithGoogleCalendar = async () => {
    try {
      setSyncing(true);
      console.log('Triggering Google Calendar sync...');

      const { data, error: syncError } = await supabase.functions.invoke('sync-google-calendar');

      if (syncError) {
        console.error('Sync error:', syncError);
        throw syncError;
      }

      console.log('Sync result:', data);
      setLastSyncTime(new Date());
      
      // Refresh availability after sync
      await fetchAvailability();
    } catch (err) {
      console.error('Error syncing with Google Calendar:', err);
      setError(err as Error);
    } finally {
      setSyncing(false);
    }
  };

  const fetchAvailability = async () => {
    if (isFetchingRef.current) {
      console.log('Fetch already in progress, skipping...');
      return;
    }

    try {
      isFetchingRef.current = true;
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
      isFetchingRef.current = false;
    }
  };

  useEffect(() => {
    fetchAvailability();
    // Remove automatic sync on mount to prevent flickering
    // syncWithGoogleCalendar can be called manually when needed

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
    refetch: fetchAvailability,
    syncWithGoogleCalendar,
    syncing,
    lastSyncTime
  };
}
