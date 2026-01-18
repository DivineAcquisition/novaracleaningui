/**
 * StripeConnectButton - Button component for starting Stripe Connect onboarding
 * 
 * Shows different states based on account status:
 * - No account: "Set Up Payouts"
 * - Pending: "Complete Setup"
 * - Active: "Payouts Active" (disabled)
 */

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { 
  Loader2, 
  CreditCard, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink,
  RefreshCw
} from 'lucide-react';
import { useStripeConnect, StripeAccountStatus } from '@/hooks/useStripeConnect';
import { cn } from '@/lib/utils';

interface StripeConnectButtonProps {
  cleanerId?: string;
  onStatusChange?: (status: StripeAccountStatus) => void;
  className?: string;
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'default' | 'sm' | 'lg';
  showStatus?: boolean;
  returnUrl?: string;
  refreshUrl?: string;
}

export function StripeConnectButton({
  cleanerId,
  onStatusChange,
  className,
  variant = 'default',
  size = 'default',
  showStatus = true,
  returnUrl,
  refreshUrl,
}: StripeConnectButtonProps) {
  const { startOnboarding, checkAccountStatus, isLoading } = useStripeConnect();
  const [status, setStatus] = useState<StripeAccountStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

  // Check account status on mount and after URL params indicate return from Stripe
  useEffect(() => {
    const checkStatus = async () => {
      setIsChecking(true);
      const accountStatus = await checkAccountStatus(cleanerId);
      setStatus(accountStatus);
      onStatusChange?.(accountStatus!);
      setIsChecking(false);
    };

    checkStatus();

    // Check if returning from Stripe
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'complete' || params.get('stripe') === 'refresh') {
      checkStatus();
      // Clean up URL
      const url = new URL(window.location.href);
      url.searchParams.delete('stripe');
      window.history.replaceState({}, '', url.toString());
    }
  }, [cleanerId, checkAccountStatus, onStatusChange]);

  const handleClick = async () => {
    await startOnboarding({
      cleaner_id: cleanerId,
      return_url: returnUrl,
      refresh_url: refreshUrl,
    });
  };

  const handleRefresh = async () => {
    setIsChecking(true);
    const accountStatus = await checkAccountStatus(cleanerId);
    setStatus(accountStatus);
    onStatusChange?.(accountStatus!);
    setIsChecking(false);
  };

  // Loading state
  if (isChecking) {
    return (
      <Button disabled className={className} variant={variant} size={size}>
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        Checking status...
      </Button>
    );
  }

  // Fully active account
  if (status?.payouts_enabled && status?.charges_enabled) {
    return (
      <div className={cn('flex items-center gap-2', className)}>
        {showStatus && (
          <Badge className="bg-green-500 text-white">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            Payouts Active
          </Badge>
        )}
        <Button 
          variant="ghost" 
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading}
        >
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
        </Button>
      </div>
    );
  }

  // Has account but not fully set up
  if (status?.has_account && !status?.payouts_enabled) {
    const hasPendingRequirements = (status.requirements?.currently_due?.length ?? 0) > 0;
    const isPendingVerification = (status.requirements?.pending_verification?.length ?? 0) > 0;

    return (
      <div className={cn('flex items-center gap-2', className)}>
        {showStatus && (
          <Badge variant="outline" className="border-amber-300 text-amber-700">
            <AlertCircle className="w-3 h-3 mr-1" />
            {isPendingVerification ? 'Verification Pending' : 'Setup Incomplete'}
          </Badge>
        )}
        <Button
          onClick={handleClick}
          disabled={isLoading || isPendingVerification}
          variant={variant}
          size={size}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : (
            <ExternalLink className="w-4 h-4 mr-2" />
          )}
          {isPendingVerification ? 'Waiting for Review' : 'Complete Setup'}
        </Button>
        <Button 
          variant="ghost" 
          size="sm"
          onClick={handleRefresh}
          disabled={isLoading}
        >
          <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
        </Button>
      </div>
    );
  }

  // No account
  return (
    <Button
      onClick={handleClick}
      disabled={isLoading}
      variant={variant}
      size={size}
      className={cn(
        'bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90',
        className
      )}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
      ) : (
        <CreditCard className="w-4 h-4 mr-2" />
      )}
      Set Up Payouts
    </Button>
  );
}

export default StripeConnectButton;
