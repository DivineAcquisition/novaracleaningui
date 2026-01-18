import { useState, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { 
  CheckCircle2, 
  XCircle, 
  AlertCircle, 
  Loader2, 
  ExternalLink, 
  CreditCard,
  Clock,
  RefreshCw,
  Zap,
  DollarSign
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface StripeConnectStatusProps {
  cleaner: any;
  onRefresh: () => void;
  compact?: boolean;
}

interface StripeStatus {
  has_stripe_account: boolean;
  stripe_onboarding_complete: boolean;
  payouts_enabled: boolean;
  charges_enabled: boolean;
  status: string;
  message: string;
  requirements?: {
    pending_verification: string[];
    currently_due: string[];
    eventually_due: string[];
  };
}

export function StripeConnectStatus({ cleaner, onRefresh, compact = false }: StripeConnectStatusProps) {
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInitiating, setIsInitiating] = useState(false);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  useEffect(() => {
    checkStatus();
  }, [cleaner?.id]);

  const checkStatus = async () => {
    if (!cleaner?.id) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('check-cleaner-status');

      if (error) {
        console.error("[STRIPE STATUS] Error:", error);
        return;
      }

      if (data?.success !== false) {
        setStatus(data);
        setLastChecked(new Date());
        
        // If payouts just got enabled, refresh the parent
        if (data.payouts_enabled && !cleaner.payouts_enabled) {
          toast.success("Your payment account is now active!");
          onRefresh();
        }
      }
    } catch (err) {
      console.error("[STRIPE STATUS] Unexpected error:", err);
    } finally {
      setIsLoading(false);
    }
  };

  const initiateStripeConnect = async () => {
    setIsInitiating(true);
    try {
      const { data, error } = await supabase.functions.invoke('initiate-cleaner-stripe-connect');
      
      if (error) {
        toast.error("Failed to start payment setup. Please try again.");
        return;
      }
      
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err) {
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsInitiating(false);
    }
  };

  // Render states
  const renderStatus = () => {
    if (isLoading) {
      return (
        <div className="flex items-center gap-3 text-muted-foreground">
          <Loader2 className="w-5 h-5 animate-spin" />
          <span>Checking payment status...</span>
        </div>
      );
    }

    if (!status) {
      return (
        <div className="flex items-center gap-3 text-muted-foreground">
          <AlertCircle className="w-5 h-5" />
          <span>Unable to check status</span>
          <Button variant="ghost" size="sm" onClick={checkStatus}>
            <RefreshCw className="w-4 h-4 mr-1" />
            Retry
          </Button>
        </div>
      );
    }

    // No Stripe account
    if (!status.has_stripe_account) {
      return (
        <Card className={cn(
          "border-2 border-amber-200 bg-gradient-to-r from-amber-50 to-orange-50",
          compact && "border"
        )}>
          <CardContent className={cn("p-5", compact && "p-4")}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center flex-shrink-0">
                <CreditCard className="w-6 h-6 text-white" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-amber-800">Payment Setup Required</h3>
                  <Badge variant="outline" className="border-amber-300 text-amber-700 text-xs">
                    <Zap className="w-3 h-3 mr-1" />
                    2 min
                  </Badge>
                </div>
                <p className="text-sm text-amber-700">
                  Connect your bank account to receive instant payouts when you complete jobs.
                </p>
              </div>
              <Button 
                onClick={initiateStripeConnect}
                disabled={isInitiating}
                className="w-full sm:w-auto bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
              >
                {isInitiating ? (
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                ) : (
                  <DollarSign className="w-4 h-4 mr-2" />
                )}
                Set Up Payouts
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Stripe account exists but payouts not enabled
    if (!status.payouts_enabled) {
      const hasPendingItems = status.requirements?.currently_due?.length || 0;
      const isPendingVerification = status.requirements?.pending_verification?.length || 0;

      return (
        <Card className={cn(
          "border-2 border-blue-200 bg-gradient-to-r from-blue-50 to-indigo-50",
          compact && "border"
        )}>
          <CardContent className={cn("p-5", compact && "p-4")}>
            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-400 to-indigo-500 flex items-center justify-center flex-shrink-0">
                {isPendingVerification ? (
                  <Clock className="w-6 h-6 text-white" />
                ) : (
                  <AlertCircle className="w-6 h-6 text-white" />
                )}
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <h3 className="font-bold text-blue-800">
                    {isPendingVerification ? "Verification in Progress" : "Complete Your Setup"}
                  </h3>
                  <Badge variant="outline" className="border-blue-300 text-blue-700 text-xs">
                    {isPendingVerification ? "Under Review" : `${hasPendingItems} items needed`}
                  </Badge>
                </div>
                <p className="text-sm text-blue-700">{status.message}</p>
              </div>
              {hasPendingItems > 0 && (
                <Button 
                  onClick={initiateStripeConnect}
                  disabled={isInitiating}
                  variant="outline"
                  className="w-full sm:w-auto border-blue-300 text-blue-700 hover:bg-blue-100"
                >
                  {isInitiating ? (
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  ) : (
                    <ExternalLink className="w-4 h-4 mr-2" />
                  )}
                  Continue Setup
                </Button>
              )}
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={checkStatus}
                className="text-blue-600"
              >
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      );
    }

    // Fully enabled
    return (
      <Card className={cn(
        "border-2 border-green-200 bg-gradient-to-r from-green-50 to-emerald-50",
        compact && "border"
      )}>
        <CardContent className={cn("p-5", compact && "p-4")}>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-green-400 to-emerald-500 flex items-center justify-center flex-shrink-0">
              <CheckCircle2 className="w-6 h-6 text-white" />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-green-800">Payouts Active</h3>
                <Badge className="bg-green-500 text-white text-xs">
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                  Ready
                </Badge>
              </div>
              <p className="text-sm text-green-700">
                You'll receive automatic payouts when you complete jobs.
              </p>
            </div>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={checkStatus}
              className="text-green-600"
            >
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="space-y-2">
      {renderStatus()}
      {lastChecked && !isLoading && (
        <p className="text-xs text-muted-foreground text-right">
          Last checked: {lastChecked.toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
