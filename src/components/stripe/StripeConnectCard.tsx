/**
 * StripeConnectCard - Complete card component for cleaner's Stripe Connect status
 * 
 * Shows:
 * - Current account status with visual indicators
 * - Earnings summary
 * - Setup/Continue button
 * - Requirements if any
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  Clock,
  DollarSign,
  CreditCard,
  ExternalLink,
  RefreshCw,
  ArrowRight,
  Shield,
  Zap,
  TrendingUp,
} from 'lucide-react';
import { useStripeConnect, StripeAccountStatus } from '@/hooks/useStripeConnect';
import { cn } from '@/lib/utils';

interface StripeConnectCardProps {
  cleanerId?: string;
  totalEarnings?: number; // In cents
  lastPayoutAt?: string;
  className?: string;
  onStatusChange?: (status: StripeAccountStatus) => void;
}

export function StripeConnectCard({
  cleanerId,
  totalEarnings = 0,
  lastPayoutAt,
  className,
  onStatusChange,
}: StripeConnectCardProps) {
  const { startOnboarding, checkAccountStatus, formatAmount, isLoading } = useStripeConnect();
  const [status, setStatus] = useState<StripeAccountStatus | null>(null);
  const [isChecking, setIsChecking] = useState(true);

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
    if (params.has('stripe')) {
      checkStatus();
      // Clean URL
      const url = new URL(window.location.href);
      url.searchParams.delete('stripe');
      window.history.replaceState({}, '', url.toString());
    }
  }, [cleanerId, checkAccountStatus, onStatusChange]);

  const handleSetup = async () => {
    await startOnboarding({ cleaner_id: cleanerId });
  };

  const handleRefresh = async () => {
    setIsChecking(true);
    const accountStatus = await checkAccountStatus(cleanerId);
    setStatus(accountStatus);
    onStatusChange?.(accountStatus!);
    setIsChecking(false);
  };

  // Calculate onboarding progress
  const getOnboardingProgress = () => {
    if (!status) return 0;
    if (status.payouts_enabled && status.charges_enabled) return 100;
    if (status.has_account) {
      if (status.onboarding_complete) return 75;
      return 50;
    }
    return 0;
  };

  // Loading state
  if (isChecking) {
    return (
      <Card className={cn('overflow-hidden', className)}>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // Fully active account
  if (status?.payouts_enabled && status?.charges_enabled) {
    return (
      <Card className={cn('overflow-hidden border-green-200 bg-gradient-to-br from-green-50 to-emerald-50', className)}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-green-500 flex items-center justify-center">
                <CheckCircle2 className="w-5 h-5 text-white" />
              </div>
              <div>
                <CardTitle className="text-lg text-green-800">Payouts Active</CardTitle>
                <CardDescription className="text-green-600">
                  You're all set to receive payments
                </CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Earnings Summary */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white/60 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-green-700 mb-1">
                <TrendingUp className="w-4 h-4" />
                Total Earnings
              </div>
              <div className="text-2xl font-bold text-green-800">
                {formatAmount(totalEarnings)}
              </div>
            </div>
            <div className="bg-white/60 rounded-lg p-4">
              <div className="flex items-center gap-2 text-sm text-green-700 mb-1">
                <Clock className="w-4 h-4" />
                Last Payout
              </div>
              <div className="text-lg font-semibold text-green-800">
                {lastPayoutAt 
                  ? new Date(lastPayoutAt).toLocaleDateString()
                  : 'No payouts yet'
                }
              </div>
            </div>
          </div>

          {/* Features */}
          <div className="flex flex-wrap gap-2">
            <Badge variant="outline" className="border-green-300 text-green-700 bg-white/50">
              <Zap className="w-3 h-3 mr-1" />
              Instant Payouts
            </Badge>
            <Badge variant="outline" className="border-green-300 text-green-700 bg-white/50">
              <Shield className="w-3 h-3 mr-1" />
              Secure Transfers
            </Badge>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Has account but not fully set up
  if (status?.has_account) {
    const hasPendingRequirements = (status.requirements?.currently_due?.length ?? 0) > 0;
    const isPendingVerification = (status.requirements?.pending_verification?.length ?? 0) > 0;

    return (
      <Card className={cn('overflow-hidden border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50', className)}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-10 h-10 rounded-full bg-amber-500 flex items-center justify-center">
                {isPendingVerification ? (
                  <Clock className="w-5 h-5 text-white" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-white" />
                )}
              </div>
              <div>
                <CardTitle className="text-lg text-amber-800">
                  {isPendingVerification ? 'Verification in Progress' : 'Complete Your Setup'}
                </CardTitle>
                <CardDescription className="text-amber-600">
                  {isPendingVerification 
                    ? 'Stripe is reviewing your information'
                    : 'A few more steps to start receiving payouts'
                  }
                </CardDescription>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={isLoading}>
              <RefreshCw className={cn('w-4 h-4', isLoading && 'animate-spin')} />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-amber-700">Setup Progress</span>
              <span className="font-medium text-amber-800">{getOnboardingProgress()}%</span>
            </div>
            <Progress value={getOnboardingProgress()} className="h-2" />
          </div>

          {/* Requirements */}
          {hasPendingRequirements && (
            <div className="bg-white/60 rounded-lg p-3">
              <div className="text-sm font-medium text-amber-800 mb-2">
                Items Needed ({status.requirements?.currently_due?.length})
              </div>
              <ul className="text-sm text-amber-700 space-y-1">
                {status.requirements?.currently_due?.slice(0, 3).map((item, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <AlertCircle className="w-3 h-3" />
                    {item.replace(/_/g, ' ')}
                  </li>
                ))}
                {(status.requirements?.currently_due?.length ?? 0) > 3 && (
                  <li className="text-amber-600">
                    +{(status.requirements?.currently_due?.length ?? 0) - 3} more items
                  </li>
                )}
              </ul>
            </div>
          )}

          {/* Action Button */}
          <Button
            onClick={handleSetup}
            disabled={isLoading || isPendingVerification}
            className={cn(
              'w-full',
              isPendingVerification 
                ? 'bg-amber-500 hover:bg-amber-600'
                : 'bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90'
            )}
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : isPendingVerification ? (
              <Clock className="w-4 h-4 mr-2" />
            ) : (
              <ExternalLink className="w-4 h-4 mr-2" />
            )}
            {isPendingVerification ? 'Waiting for Review' : 'Continue Setup'}
          </Button>
        </CardContent>
      </Card>
    );
  }

  // No account - First time setup
  return (
    <Card className={cn('overflow-hidden border-2 border-dashed border-purple-200 bg-gradient-to-br from-purple-50/50 to-indigo-50/50', className)}>
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center">
            <CreditCard className="w-6 h-6 text-white" />
          </div>
          <div>
            <CardTitle className="text-xl">Set Up Your Payouts</CardTitle>
            <CardDescription>
              Connect your bank account to receive instant payments
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Benefits */}
        <div className="grid gap-3">
          <div className="flex items-center gap-3 text-sm">
            <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0">
              <DollarSign className="w-4 h-4 text-green-600" />
            </div>
            <div>
              <div className="font-medium">Earn $18-25/hour</div>
              <div className="text-muted-foreground text-xs">Plus tips from happy customers</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center flex-shrink-0">
              <Zap className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <div className="font-medium">Automatic Payouts</div>
              <div className="text-muted-foreground text-xs">Get paid instantly when jobs complete</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <div className="w-8 h-8 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-purple-600" />
            </div>
            <div>
              <div className="font-medium">Secure & Protected</div>
              <div className="text-muted-foreground text-xs">Powered by Stripe's secure platform</div>
            </div>
          </div>
        </div>

        {/* Setup Time Badge */}
        <div className="flex items-center justify-center">
          <Badge variant="outline" className="border-purple-200 text-purple-700">
            <Clock className="w-3 h-3 mr-1" />
            Takes about 2 minutes
          </Badge>
        </div>

        {/* CTA Button */}
        <Button
          onClick={handleSetup}
          disabled={isLoading}
          size="lg"
          className="w-full bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
        >
          {isLoading ? (
            <Loader2 className="w-5 h-5 mr-2 animate-spin" />
          ) : (
            <>
              Get Started
              <ArrowRight className="w-5 h-5 ml-2" />
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

export default StripeConnectCard;
