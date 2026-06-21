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
  const { user } = useAuth();
  const [credits, setCredits] = useState<MembershipCredits | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCredits = async () => {
      // Look up credits by the signed-in user's email rather than gating on
      // the async `subscription` check. The Stripe subscription probe can
      // lag (or briefly report not-subscribed on first paint), which used
      // to hide a member's credits and bounce them out of the portal.
      // membership_credits is the source of truth and is keyed by email.
      if (!user?.email) {
        setCredits(null);
        setLoading(false);
        return;
      }

      try {
        const { data, error } = await supabase
          .from('membership_credits')
          .select('*')
          .eq('email', user.email)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

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
  }, [user]);

  return { credits, loading, hasCredits: (credits?.credits_remaining || 0) > 0 };
}
