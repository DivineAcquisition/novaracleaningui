/**
 * useStripeConnect - React hook for Stripe Connect operations
 * 
 * Provides easy access to all Stripe Connect functionality:
 * - Creating/managing connect accounts
 * - Checking account status
 * - Processing payouts
 * - Fetching connected accounts for admin
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

// Types
export interface StripeAccountStatus {
  has_account: boolean;
  account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  onboarding_complete: boolean;
  requirements?: {
    currently_due: string[];
    eventually_due: string[];
    pending_verification: string[];
  };
}

export interface ConnectedAccount {
  cleaner_id: string;
  name: string;
  email: string;
  phone: string | null;
  stripe_account_id: string | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  onboarding_complete: boolean;
  status: string;
  created_at: string;
  stripe_details?: {
    type: string;
    country: string;
    default_currency: string;
    requirements?: {
      currently_due: string[];
      eventually_due: string[];
      pending_verification: string[];
    };
  };
}

export interface PayoutResult {
  success: boolean;
  payout_id?: string;
  transfer_id?: string;
  amount?: number;
  amount_formatted?: string;
  status?: string;
  error?: string;
  code?: string;
}

export interface CreateAccountResult {
  success: boolean;
  account_id?: string;
  onboarding_url?: string;
  existing_account?: boolean;
  error?: string;
}

// Hook
export function useStripeConnect() {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Create or get onboarding link for a Stripe Connect account
   */
  const createConnectAccount = useCallback(async (
    options?: {
      cleaner_id?: string;
      return_url?: string;
      refresh_url?: string;
    }
  ): Promise<CreateAccountResult> => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-connect-account', {
        body: options || {}
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to create connect account');
      }

      if (!data.success) {
        throw new Error(data.error || 'Unknown error');
      }

      return {
        success: true,
        account_id: data.account_id,
        onboarding_url: data.onboarding_url,
        existing_account: data.existing_account,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create account';
      setError(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Start Stripe Connect onboarding flow
   * Redirects to Stripe's hosted onboarding
   */
  const startOnboarding = useCallback(async (
    options?: {
      cleaner_id?: string;
      return_url?: string;
      refresh_url?: string;
    }
  ): Promise<boolean> => {
    const result = await createConnectAccount(options);

    if (result.success && result.onboarding_url) {
      window.location.href = result.onboarding_url;
      return true;
    }

    toast.error(result.error || 'Failed to start onboarding');
    return false;
  }, [createConnectAccount]);

  /**
   * Check the status of a cleaner's Stripe Connect account
   */
  const checkAccountStatus = useCallback(async (
    cleanerId?: string
  ): Promise<StripeAccountStatus | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke('check-cleaner-status', {
        body: cleanerId ? { cleanerId } : {}
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to check status');
      }

      return {
        has_account: data.has_stripe_account ?? false,
        account_id: data.stripe_account_id ?? null,
        charges_enabled: data.charges_enabled ?? false,
        payouts_enabled: data.payouts_enabled ?? false,
        onboarding_complete: data.stripe_onboarding_complete ?? false,
        requirements: data.requirements,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to check status';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Fetch all connected accounts for admin dashboard
   */
  const fetchConnectedAccounts = useCallback(async (
    options?: {
      include_stripe_details?: boolean;
      status?: 'active' | 'pending' | 'all';
      limit?: number;
      offset?: number;
    }
  ): Promise<{
    accounts: ConnectedAccount[];
    summary: { total: number; active: number; pending: number };
  } | null> => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (options?.include_stripe_details) params.set('include_stripe_details', 'true');
      if (options?.status) params.set('status', options.status);
      if (options?.limit) params.set('limit', String(options.limit));
      if (options?.offset) params.set('offset', String(options.offset));

      const { data, error: fnError } = await supabase.functions.invoke('connected-accounts', {
        body: {},
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to fetch accounts');
      }

      if (!data.success) {
        throw new Error(data.error || 'Unknown error');
      }

      return {
        accounts: data.accounts || [],
        summary: data.summary || { total: 0, active: 0, pending: 0 },
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to fetch accounts';
      setError(errorMessage);
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Process a payout to a cleaner
   */
  const processPayout = useCallback(async (
    cleanerId: string,
    amountCents: number,
    options?: {
      booking_id?: string;
      description?: string;
      metadata?: Record<string, string>;
    }
  ): Promise<PayoutResult> => {
    setIsLoading(true);
    setError(null);

    try {
      if (amountCents < 100) {
        throw new Error('Minimum payout is $1.00');
      }

      const { data, error: fnError } = await supabase.functions.invoke('payout', {
        body: {
          cleaner_id: cleanerId,
          amount: amountCents,
          ...options
        }
      });

      if (fnError) {
        throw new Error(fnError.message || 'Failed to process payout');
      }

      if (!data.success) {
        return {
          success: false,
          error: data.error,
          code: data.code,
        };
      }

      toast.success(`Payout of ${data.amount_formatted} sent successfully!`);

      return {
        success: true,
        payout_id: data.payout_id,
        transfer_id: data.transfer_id,
        amount: data.amount,
        amount_formatted: data.amount_formatted,
        status: data.status,
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to process payout';
      setError(errorMessage);
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Format cents to dollars string
   */
  const formatAmount = useCallback((cents: number): string => {
    return `$${(cents / 100).toFixed(2)}`;
  }, []);

  /**
   * Parse dollar string to cents
   */
  const parseToCents = useCallback((dollarString: string): number => {
    const cleaned = dollarString.replace(/[$,]/g, '');
    const dollars = parseFloat(cleaned);
    return Math.round(dollars * 100);
  }, []);

  return {
    // State
    isLoading,
    error,

    // Account Management
    createConnectAccount,
    startOnboarding,
    checkAccountStatus,

    // Admin
    fetchConnectedAccounts,

    // Payouts
    processPayout,

    // Utilities
    formatAmount,
    parseToCents,
  };
}

export default useStripeConnect;
