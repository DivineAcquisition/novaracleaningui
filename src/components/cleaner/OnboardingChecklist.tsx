import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, ExternalLink, Phone, CreditCard, Calendar } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PhoneVerificationDialog } from "./PhoneVerificationDialog";

interface ChecklistItem {
  id: string;
  label: string;
  completed: boolean;
  icon: any;
  actionLabel: string;
  onAction: () => void;
}

interface OnboardingChecklistProps {
  cleaner: any;
  onRefresh: () => void;
}

export function OnboardingChecklist({ cleaner, onRefresh }: OnboardingChecklistProps) {
  const [isInitiatingStripe, setIsInitiatingStripe] = useState(false);
  const [showPhoneDialog, setShowPhoneDialog] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Check Stripe Connect status on mount and when returning from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const stripeStatus = params.get('stripe');
    if (stripeStatus === 'complete' || stripeStatus === 'refresh') {
      checkStripeStatus();
      // Clean up URL
      window.history.replaceState({}, '', '/cleaner/dashboard');
      
      if (stripeStatus === 'refresh') {
        // User needs to re-do Stripe onboarding
        toast.info("Please complete Stripe setup to receive payments");
      }
    }
  }, []);

  const checkStripeStatus = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('check-cleaner-status', {
        body: { cleanerId: cleaner.id }
      });

      if (error) throw error;

      if (data?.success) {
        toast.success("Stripe Connect setup complete!");
        onRefresh();
      }
    } catch (error) {
      console.error('Error checking Stripe status:', error);
    }
  };

  const handleStripeConnect = async () => {
    setIsInitiatingStripe(true);
    try {
      const { data, error } = await supabase.functions.invoke('initiate-cleaner-stripe-connect');

      if (error) throw error;

      if (data?.url) {
        window.open(data.url, '_blank');
        toast.info("Complete Stripe onboarding in the new tab");
      }
    } catch (error) {
      console.error('Error initiating Stripe Connect:', error);
      toast.error("Failed to start Stripe onboarding");
    } finally {
      setIsInitiatingStripe(false);
    }
  };

  const checklist: ChecklistItem[] = [
    {
      id: "stripe",
      label: "Complete Stripe Connect",
      completed: cleaner?.stripe_account_id && cleaner?.payouts_enabled,
      icon: CreditCard,
      actionLabel: "Setup Payouts",
      onAction: handleStripeConnect,
    },
    {
      id: "phone",
      label: "Verify Phone Number",
      completed: cleaner?.phone_verified,
      icon: Phone,
      actionLabel: "Verify Now",
      onAction: () => setShowPhoneDialog(true),
    },
    {
      id: "availability",
      label: "Set Availability",
      completed: cleaner?.available_for_bookings && cleaner?.preferred_work_days?.length > 0,
      icon: Calendar,
      actionLabel: "Set Schedule",
      onAction: () => window.location.href = "/cleaner/profile",
    },
  ];

  const completedCount = checklist.filter(item => item.completed).length;
  const progress = (completedCount / checklist.length) * 100;
  const allComplete = completedCount === checklist.length;

  if (isDismissed && allComplete) return null;

  return (
    <>
      <Card className="p-3 sm:p-4 mb-3 sm:mb-4 border-primary/20 bg-gradient-to-r from-primary/5 to-background">
        <div className="flex items-center justify-between mb-2 sm:mb-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm sm:text-base font-semibold truncate">
              {allComplete ? "✅ All Set!" : "Complete Setup"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {allComplete 
                ? "Ready for job offers" 
                : `${completedCount}/${checklist.length} done`
              }
            </p>
          </div>
          {allComplete && (
            <Button variant="ghost" size="sm" onClick={() => setIsDismissed(true)} className="h-7 px-2 text-xs">
              Dismiss
            </Button>
          )}
        </div>

        <Progress value={progress} className="mb-2 sm:mb-3 h-1.5" />

        <div className="space-y-1.5 sm:space-y-2">
          {checklist.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className="flex items-center justify-between p-2 rounded-lg bg-background/50 border gap-2"
              >
                <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1">
                  {item.completed ? (
                    <CheckCircle2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-green-500 flex-shrink-0" />
                  ) : (
                    <XCircle className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <Icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-muted-foreground flex-shrink-0" />
                  <span className={`text-xs sm:text-sm truncate ${item.completed ? "text-muted-foreground" : ""}`}>
                    {item.label}
                  </span>
                </div>

                {!item.completed && (
                  <Button
                    size="sm"
                    onClick={item.onAction}
                    disabled={item.id === "stripe" && isInitiatingStripe}
                    className="h-7 px-2 sm:px-3 text-xs flex-shrink-0"
                  >
                    <span className="hidden sm:inline">{item.actionLabel}</span>
                    <span className="sm:hidden">Setup</span>
                    {item.id === "stripe" && <ExternalLink className="ml-1 sm:ml-2 w-3 h-3" />}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      <PhoneVerificationDialog
        open={showPhoneDialog}
        onOpenChange={setShowPhoneDialog}
        phone={cleaner?.phone}
        onSuccess={onRefresh}
      />
    </>
  );
}
