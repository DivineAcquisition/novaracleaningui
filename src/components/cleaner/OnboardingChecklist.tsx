import { useState, useEffect } from "react";
import { CheckCircle2, XCircle, ExternalLink, Phone, CreditCard, Calendar, DollarSign, Zap } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { PhoneVerificationDialog } from "./PhoneVerificationDialog";
import { PayoutOnboardingWizard } from "./PayoutOnboardingWizard";

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
  const [showPhoneDialog, setShowPhoneDialog] = useState(false);
  const [showPayoutWizard, setShowPayoutWizard] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);

  // Check Stripe Connect status on mount and when returning from Stripe
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('stripe') === 'complete') {
      checkStripeStatus();
      // Clean up URL
      window.history.replaceState({}, '', '/cleaner/dashboard');
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

  const handleOpenPayoutWizard = () => {
    setShowPayoutWizard(true);
  };

  const checklist: ChecklistItem[] = [
    {
      id: "stripe",
      label: "Set Up Instant Payouts",
      completed: cleaner?.stripe_account_id && cleaner?.payouts_enabled,
      icon: CreditCard,
      actionLabel: "Setup Payouts",
      onAction: handleOpenPayoutWizard,
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
  const payoutsNotSetup = !cleaner?.stripe_account_id || !cleaner?.payouts_enabled;

  if (isDismissed && allComplete) return null;

  return (
    <>
      {/* Prominent Payout Setup Banner (only if payouts not set up) */}
      {payoutsNotSetup && (
        <Card className="p-4 mb-4 border-2 border-green-500/30 bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20">
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex-shrink-0">
              <div className="w-12 h-12 bg-gradient-to-br from-green-400 to-emerald-600 rounded-full flex items-center justify-center shadow-lg">
                <DollarSign className="w-6 h-6 text-white" />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="text-base font-bold text-green-800 dark:text-green-200">
                  Get Paid Instantly! 💸
                </h3>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded-full">
                  <Zap className="w-3 h-3" />
                  2 min setup
                </span>
              </div>
              <p className="text-sm text-green-700 dark:text-green-300">
                Set up your payout account to receive payments automatically when you complete jobs.
              </p>
            </div>
            <Button 
              onClick={handleOpenPayoutWizard}
              className="bg-gradient-to-r from-green-500 to-emerald-600 hover:from-green-600 hover:to-emerald-700 text-white shadow-md w-full sm:w-auto"
            >
              Set Up Now
              <ExternalLink className="ml-2 w-4 h-4" />
            </Button>
          </div>
        </Card>
      )}

      {/* Standard Checklist */}
      <Card className="p-4 mb-4 border-primary/20 bg-gradient-to-r from-primary/5 to-background">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-base font-semibold">
              {allComplete ? "✅ All Set!" : "Complete Your Setup"}
            </h3>
            <p className="text-xs text-muted-foreground">
              {allComplete 
                ? "You're ready to receive job offers" 
                : `${completedCount} of ${checklist.length} steps complete`
              }
            </p>
          </div>
          {allComplete && (
            <Button variant="ghost" size="sm" onClick={() => setIsDismissed(true)}>
              Dismiss
            </Button>
          )}
        </div>

        <Progress value={progress} className="mb-3 h-2" />

        <div className="space-y-2">
          {checklist.map((item) => {
            const Icon = item.icon;
            return (
              <div
                key={item.id}
                className={`flex items-center justify-between p-2 rounded-lg bg-background/50 border ${
                  item.id === "stripe" && !item.completed ? "border-green-300 bg-green-50/50" : ""
                }`}
              >
                <div className="flex items-center gap-2">
                  {item.completed ? (
                    <CheckCircle2 className="w-4 h-4 text-green-500" />
                  ) : (
                    <XCircle className="w-4 h-4 text-muted-foreground" />
                  )}
                  <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                  <span className={`text-sm ${item.completed ? "text-muted-foreground" : ""}`}>
                    {item.label}
                  </span>
                  {item.id === "stripe" && !item.completed && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded font-medium">
                      Required for payouts
                    </span>
                  )}
                </div>

                {!item.completed && (
                  <Button
                    size="sm"
                    onClick={item.onAction}
                    variant={item.id === "stripe" ? "default" : "outline"}
                    className={item.id === "stripe" ? "bg-green-600 hover:bg-green-700" : ""}
                  >
                    {item.actionLabel}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Payout Onboarding Wizard */}
      <PayoutOnboardingWizard
        open={showPayoutWizard}
        onOpenChange={setShowPayoutWizard}
        cleaner={cleaner}
        onComplete={onRefresh}
      />

      <PhoneVerificationDialog
        open={showPhoneDialog}
        onOpenChange={setShowPhoneDialog}
        phone={cleaner?.phone}
        onSuccess={onRefresh}
      />
    </>
  );
}
