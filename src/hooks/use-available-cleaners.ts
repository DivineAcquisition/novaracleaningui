"use client";

import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { isCleanerReadyForFirstJob } from '@/lib/cleaner-supplies';

export interface AvailableCleaner {
  id: string;
  first_name: string;
  last_name: string;
  avatar_url: string | null;
  average_rating: number | null;
  total_ratings: number | null;
  completed_bookings: number | null;
  service_zip_codes: string[] | null;
  skillset: string[] | null;
  status_today: string | null;
}

interface UseAvailableCleanersOptions {
  zipCode?: string;
  serviceDate?: string;
  preferPreviousCleaner?: boolean;
  customerEmail?: string;
}

export function useAvailableCleaners(options: UseAvailableCleanersOptions = {}) {
  const [cleaners, setCleaners] = useState<AvailableCleaner[]>([]);
  const [previousCleaners, setPreviousCleaners] = useState<AvailableCleaner[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const { zipCode, customerEmail, preferPreviousCleaner } = options;

  useEffect(() => {
    const fetchCleaners = async () => {
      setLoading(true);
      setError(null);

      try {
        // Fetch all available cleaners
        let query = supabase
          .from('cleaners')
          .select(`
            id,
            first_name,
            last_name,
            avatar_url,
            average_rating,
            total_ratings,
            completed_bookings,
            service_zip_codes,
            skillset,
            status_today,
            ob_agreement_signed,
            phone_verified,
            supply_checklist_submitted_at,
            ob_supplies_checklist_viewed,
            ob_dress_code_ack,
            ob_job_day_guides_ack,
            ob_training_complete
          `)
          .eq('approved', true)
          .eq('available_for_bookings', true)
          .order('average_rating', { ascending: false, nullsFirst: false });

        const { data: cleanersData, error: cleanersError } = await query;

        if (cleanersError) throw cleanersError;

        // Filter by zip code if provided
        let filteredCleaners = (cleanersData || []).filter((cleaner) =>
          isCleanerReadyForFirstJob(cleaner),
        );
        if (zipCode) {
          filteredCleaners = filteredCleaners.filter(
            (cleaner) =>
              !cleaner.service_zip_codes ||
              cleaner.service_zip_codes.length === 0 ||
              cleaner.service_zip_codes.includes(zipCode)
          );
        }

        setCleaners(filteredCleaners);

        // If customer email provided, fetch their previous cleaners
        if (customerEmail && preferPreviousCleaner) {
          const { data: previousBookings, error: bookingsError } = await supabase
            .from('bookings')
            .select('cleaner_id')
            .eq('email', customerEmail)
            .eq('status', 'completed')
            .not('cleaner_id', 'is', null)
            .order('completed_at', { ascending: false })
            .limit(5);

          if (!bookingsError && previousBookings) {
            const previousCleanerIds = [
              ...new Set(previousBookings.map((b) => b.cleaner_id).filter(Boolean)),
            ];

            if (previousCleanerIds.length > 0) {
              const previousCleanersList = filteredCleaners.filter((c) =>
                previousCleanerIds.includes(c.id)
              );
              setPreviousCleaners(previousCleanersList);
            }
          }
        }
      } catch (err) {
        console.error('Error fetching cleaners:', err);
        setError(err as Error);
      } finally {
        setLoading(false);
      }
    };

    fetchCleaners();
  }, [zipCode, customerEmail, preferPreviousCleaner]);

  return { cleaners, previousCleaners, loading, error };
}
