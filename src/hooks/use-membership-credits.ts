"use client";

import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';

export interface MembershipCredits {
  credits_remaining: number;
  credits_per_month: number;
  credits_used: number;
  membership_plan: string;
  current_period_end: string;
}

export function useMembershipCredits() {
  const { user, subscription } = useAuth();
  const [credits, setCredits] = useState<MembershipCredits | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCredits = async () => {
      if (!user || !subscription?.subscribed || !subscription?.customer_id) {
        setCredits(null);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('membership_credits')
          .select('*')
          .eq('customer_id', subscription.customer_id)
          .single();

        if (error) {
          console.error('Error fetching credits:', error);
          setCredits(null);
        } else {
          setCredits(data);
        }
      } catch (err) {
        console.error('Error:', err);
        setCredits(null);
      } finally {
        setLoading(false);
      }
    };

    fetchCredits();
  }, [user, subscription]);

  return { credits, loading, hasCredits: (credits?.credits_remaining || 0) > 0 };
}
