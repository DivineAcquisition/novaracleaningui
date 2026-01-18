import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import {
  DollarSign,
  Zap,
  Shield,
  Clock,
  CheckCircle2,
  ArrowRight,
  ExternalLink,
  Loader2,
  CreditCard,
  Building2,
  BadgeCheck,
  Sparkles,
  ChevronLeft,
  AlertCircle,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface PayoutOnboardingWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cleaner: any;
  onComplete: () => void;
}

type Step = "intro" | "benefits" | "requirements" | "connect" | "verifying" | "complete";

const STEPS: Step[] = ["intro", "benefits", "requirements", "connect", "verifying", "complete"];

export function PayoutOnboardingWizard({
  open,
  onOpenChange,
  cleaner,
  onComplete,
}: PayoutOnboardingWizardProps) {
  const [currentStep, setCurrentStep] = useState<Step>("intro");
  const [isConnecting, setIsConnecting] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [stripeStatus, setStripeStatus] = useState<"pending" | "complete" | "error">("pending");

  // Check if cleaner already has payouts enabled
  useEffect(() => {
    if (cleaner?.payouts_enabled) {
      setCurrentStep("complete");
      setStripeStatus("complete");
    }
  }, [cleaner]);

  // Poll for Stripe completion when on verifying step
  useEffect(() => {
    let pollInterval: NodeJS.Timeout;

    if (currentStep === "verifying" && !cleaner?.payouts_enabled) {
      setIsVerifying(true);
      
      pollInterval = setInterval(async () => {
        try {
          const { data, error } = await supabase.functions.invoke('check-cleaner-status', {
            body: { cleanerId: cleaner.id }
          });

          if (data?.payoutsEnabled) {
            setStripeStatus("complete");
            setCurrentStep("complete");
            setIsVerifying(false);
            clearInterval(pollInterval);
            onComplete();
          }
        } catch (error) {
          console.error("Error checking status:", error);
        }
      }, 3000);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [currentStep, cleaner?.id, cleaner?.payouts_enabled, onComplete]);

  const handleStripeConnect = async () => {
    setIsConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('initiate-cleaner-stripe-connect');

      if (error) throw error;

      if (data?.url) {
        // Open Stripe in new tab
        window.open(data.url, '_blank');
        toast.info("Complete your setup in the new tab, then return here");
        setCurrentStep("verifying");
      }
    } catch (error) {
      console.error('Error initiating Stripe Connect:', error);
      toast.error("Failed to start payout setup. Please try again.");
      setStripeStatus("error");
    } finally {
      setIsConnecting(false);
    }
  };

  const goToStep = (step: Step) => {
    setCurrentStep(step);
  };

  const nextStep = () => {
    const currentIndex = STEPS.indexOf(currentStep);
    if (currentIndex < STEPS.length - 1) {
      setCurrentStep(STEPS[currentIndex + 1]);
    }
  };

  const prevStep = () => {
    const currentIndex = STEPS.indexOf(currentStep);
    if (currentIndex > 0) {
      setCurrentStep(STEPS[currentIndex - 1]);
    }
  };

  const getStepIndex = () => STEPS.indexOf(currentStep);
  const progress = ((getStepIndex() + 1) / STEPS.length) * 100;

  const renderStep = () => {
    switch (currentStep) {
      case "intro":
        return <IntroStep onNext={nextStep} cleanerName={cleaner?.first_name} />;
      case "benefits":
        return <BenefitsStep onNext={nextStep} onBack={prevStep} />;
      case "requirements":
        return <RequirementsStep onNext={nextStep} onBack={prevStep} />;
      case "connect":
        return (
          <ConnectStep
            onConnect={handleStripeConnect}
            onBack={prevStep}
            isConnecting={isConnecting}
          />
        );
      case "verifying":
        return <VerifyingStep onRetry={handleStripeConnect} isVerifying={isVerifying} />;
      case "complete":
        return <CompleteStep onClose={() => onOpenChange(false)} />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader className="sr-only">
          <DialogTitle>Payout Setup</DialogTitle>
          <DialogDescription>Set up your payout account to receive instant payments</DialogDescription>
        </DialogHeader>

        {/* Progress indicator */}
        {currentStep !== "complete" && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-muted-foreground">
                Step {getStepIndex() + 1} of {STEPS.length}
              </span>
              <span className="text-xs font-medium">
                {Math.round(progress)}% complete
              </span>
            </div>
            <Progress value={progress} className="h-1.5" />
          </div>
        )}

        <AnimatePresence mode="wait">
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.2 }}
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

// Step Components

function IntroStep({ onNext, cleanerName }: { onNext: () => void; cleanerName?: string }) {
  return (
    <div className="text-center space-y-6 py-4">
      <div className="mx-auto w-20 h-20 bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] rounded-full flex items-center justify-center shadow-lg">
        <DollarSign className="w-10 h-10 text-white" />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold">
          Get Paid Instantly{cleanerName ? `, ${cleanerName}` : ""}! 💸
        </h2>
        <p className="text-muted-foreground">
          Set up your payout account in just 2 minutes and start receiving payments 
          directly to your bank account the moment you complete a job.
        </p>
      </div>

      <div className="flex items-center justify-center gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Clock className="w-4 h-4" />
          <span>2 min setup</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Shield className="w-4 h-4" />
          <span>Secure</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Zap className="w-4 h-4" />
          <span>Instant payouts</span>
        </div>
      </div>

      <Button onClick={onNext} size="lg" className="w-full">
        Let's Get Started
        <ArrowRight className="ml-2 w-4 h-4" />
      </Button>
    </div>
  );
}

function BenefitsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const benefits = [
    {
      icon: Zap,
      title: "Instant Payouts",
      description: "Get paid automatically as soon as you check out of a job",
      color: "text-yellow-500",
      bgColor: "bg-yellow-50",
    },
    {
      icon: Shield,
      title: "Secure & Protected",
      description: "Powered by Stripe, the world's most trusted payment platform",
      color: "text-blue-500",
      bgColor: "bg-blue-50",
    },
    {
      icon: CreditCard,
      title: "Direct to Your Bank",
      description: "Money goes straight to your bank account, typically in 1-2 days",
      color: "text-[#5500FF]",
      bgColor: "bg-violet-50",
    },
    {
      icon: BadgeCheck,
      title: "Transparent Earnings",
      description: "Track every payout with detailed breakdowns in your dashboard",
      color: "text-purple-500",
      bgColor: "bg-purple-50",
    },
  ];

  return (
    <div className="space-y-6 py-2">
      <div className="text-center space-y-2">
        <Badge variant="secondary" className="mb-2">
          <Sparkles className="w-3 h-3 mr-1" />
          Why Set Up Payouts?
        </Badge>
        <h2 className="text-xl font-bold">Benefits of Instant Payouts</h2>
      </div>

      <div className="grid gap-3">
        {benefits.map((benefit, index) => (
          <Card key={index} className="p-4 border-l-4 border-l-primary/50">
            <div className="flex items-start gap-3">
              <div className={`p-2 rounded-lg ${benefit.bgColor}`}>
                <benefit.icon className={`w-5 h-5 ${benefit.color}`} />
              </div>
              <div>
                <h3 className="font-semibold text-sm">{benefit.title}</h3>
                <p className="text-xs text-muted-foreground">{benefit.description}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ChevronLeft className="mr-2 w-4 h-4" />
          Back
        </Button>
        <Button onClick={onNext} className="flex-1">
          Continue
          <ArrowRight className="ml-2 w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function RequirementsStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const requirements = [
    {
      icon: Building2,
      title: "Bank Account",
      description: "US bank account (checking or savings)",
      status: "required",
    },
    {
      icon: BadgeCheck,
      title: "Basic Info",
      description: "Name, address, date of birth, SSN last 4",
      status: "required",
    },
    {
      icon: CreditCard,
      title: "ID Verification",
      description: "Stripe may ask for photo ID in some cases",
      status: "sometimes",
    },
  ];

  return (
    <div className="space-y-6 py-2">
      <div className="text-center space-y-2">
        <Badge variant="outline" className="mb-2">
          <CheckCircle2 className="w-3 h-3 mr-1" />
          Quick Checklist
        </Badge>
        <h2 className="text-xl font-bold">What You'll Need</h2>
        <p className="text-sm text-muted-foreground">
          Have these ready for a smooth setup
        </p>
      </div>

      <div className="space-y-3">
        {requirements.map((req, index) => (
          <Card key={index} className="p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-muted">
                <req.icon className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">{req.title}</h3>
                  {req.status === "required" ? (
                    <Badge variant="default" className="text-[10px] py-0">Required</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px] py-0">Sometimes</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">{req.description}</p>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-4 bg-blue-50 border-blue-200">
        <div className="flex gap-3">
          <Shield className="w-5 h-5 text-blue-600 flex-shrink-0" />
          <div>
            <h4 className="text-sm font-semibold text-blue-800">Your Data is Safe</h4>
            <p className="text-xs text-blue-700">
              Novara never sees your banking info. All data is encrypted and 
              securely handled by Stripe.
            </p>
          </div>
        </div>
      </Card>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1">
          <ChevronLeft className="mr-2 w-4 h-4" />
          Back
        </Button>
        <Button onClick={onNext} className="flex-1">
          I'm Ready
          <ArrowRight className="ml-2 w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}

function ConnectStep({
  onConnect,
  onBack,
  isConnecting,
}: {
  onConnect: () => void;
  onBack: () => void;
  isConnecting: boolean;
}) {
  return (
    <div className="space-y-6 py-2">
      <div className="text-center space-y-2">
        <div className="mx-auto w-16 h-16 bg-[#635BFF] rounded-2xl flex items-center justify-center shadow-lg mb-4">
          <svg viewBox="0 0 60 25" className="w-10 h-10" fill="white">
            <path d="M59.64 14.28h-8.06c.19 1.93 1.6 2.55 3.2 2.55 1.64 0 2.96-.37 4.05-.95v3.32a8.33 8.33 0 0 1-4.56 1.1c-4.01 0-6.83-2.5-6.83-7.48 0-4.19 2.39-7.52 6.3-7.52 3.92 0 5.96 3.28 5.96 7.5 0 .4-.02 1.04-.06 1.48zm-5.92-5.62c-1.03 0-2.17.73-2.17 2.58h4.25c0-1.85-1.07-2.58-2.08-2.58zM40.95 20.3c-1.44 0-2.32-.6-2.9-1.04l-.02 4.63-4.12.87V5.57h3.76l.1 1.03a4.17 4.17 0 0 1 3.39-1.4c3.02 0 5.15 2.73 5.15 7.23 0 4.95-2.12 7.87-5.36 7.87zm-.7-11.35c-1.02 0-1.73.43-2.17 1.08v5.59c.43.6 1.1 1.02 2.13 1.02 1.62 0 2.7-1.4 2.7-3.87 0-2.37-1.05-3.82-2.66-3.82zM28.24 5.57h4.13v14.44h-4.13V5.57zm0-5.35L32.37 0v3.5l-4.13.87V.22zM19.38 5.57h4.12v14.44h-4.12V5.57zm0-5.35L23.5 0v3.5l-4.12.87V.22zM14.91 5.57h-2.71V2.2l-4.06.86v2.51H5.93v3.36h2.21v6.54c0 3.16 1.5 4.82 5.22 4.82 1.14 0 2.19-.2 2.79-.53v-3.3c-.42.1-1.1.18-1.58.18-1.15 0-1.61-.51-1.61-1.67v-6.04h2.95V5.57zM4.06 8.03v11.98H0V8.03h4.06z" />
          </svg>
        </div>
        <h2 className="text-xl font-bold">Connect with Stripe</h2>
        <p className="text-sm text-muted-foreground">
          Click below to securely set up your payout account with Stripe Express.
          This opens in a new tab.
        </p>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-primary">1</span>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Click the button below</h4>
            <p className="text-xs text-muted-foreground">
              A new tab will open with Stripe's secure onboarding
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-primary">2</span>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Complete the Stripe form</h4>
            <p className="text-xs text-muted-foreground">
              Enter your bank account and verify your identity
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <span className="text-sm font-bold text-primary">3</span>
          </div>
          <div>
            <h4 className="text-sm font-semibold">Return here when done</h4>
            <p className="text-xs text-muted-foreground">
              We'll verify your setup automatically
            </p>
          </div>
        </div>
      </Card>

      <div className="flex gap-3">
        <Button variant="outline" onClick={onBack} className="flex-1" disabled={isConnecting}>
          <ChevronLeft className="mr-2 w-4 h-4" />
          Back
        </Button>
        <Button
          onClick={onConnect}
          disabled={isConnecting}
          className="flex-1 bg-[#635BFF] hover:bg-[#5851EA]"
        >
          {isConnecting ? (
            <>
              <Loader2 className="mr-2 w-4 h-4 animate-spin" />
              Opening Stripe...
            </>
          ) : (
            <>
              Connect with Stripe
              <ExternalLink className="ml-2 w-4 h-4" />
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

function VerifyingStep({
  onRetry,
  isVerifying,
}: {
  onRetry: () => void;
  isVerifying: boolean;
}) {
  return (
    <div className="space-y-6 py-4 text-center">
      <div className="mx-auto w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center">
        {isVerifying ? (
          <Loader2 className="w-10 h-10 text-primary animate-spin" />
        ) : (
          <AlertCircle className="w-10 h-10 text-yellow-500" />
        )}
      </div>

      <div className="space-y-2">
        <h2 className="text-xl font-bold">
          {isVerifying ? "Verifying Your Setup..." : "Complete Stripe Setup"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {isVerifying
            ? "Please complete the Stripe onboarding in the other tab. We'll detect when you're done!"
            : "It looks like Stripe setup wasn't completed. Click below to try again."}
        </p>
      </div>

      {isVerifying && (
        <Card className="p-4 bg-blue-50 border-blue-200 text-left">
          <div className="flex gap-3">
            <Clock className="w-5 h-5 text-blue-600 flex-shrink-0" />
            <div>
              <h4 className="text-sm font-semibold text-blue-800">Taking a while?</h4>
              <p className="text-xs text-blue-700">
                Make sure you complete all steps in the Stripe tab. If the tab closed, 
                click "Try Again" below.
              </p>
            </div>
          </div>
        </Card>
      )}

      <Button onClick={onRetry} variant={isVerifying ? "outline" : "default"} className="w-full">
        {isVerifying ? "Open Stripe Again" : "Try Again"}
        <ExternalLink className="ml-2 w-4 h-4" />
      </Button>
    </div>
  );
}

function CompleteStep({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-6 py-4 text-center">
      <div className="mx-auto w-20 h-20 bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] rounded-full flex items-center justify-center shadow-lg">
        <CheckCircle2 className="w-10 h-10 text-white" />
      </div>

      <div className="space-y-2">
        <h2 className="text-2xl font-bold">You're All Set! 🎉</h2>
        <p className="text-muted-foreground">
          Your payout account is now connected. You'll receive payments automatically 
          when you complete jobs!
        </p>
      </div>

      <Card className="p-4 bg-violet-50 border-violet-200 text-left">
        <h4 className="text-sm font-semibold text-violet-800 mb-2">What happens next?</h4>
        <ul className="text-xs space-y-1 text-violet-700">
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Complete a job and check out
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Payment is automatically processed
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Money arrives in your bank (1-2 business days)
          </li>
        </ul>
      </Card>

      <Button onClick={onClose} size="lg" className="w-full">
        Start Accepting Jobs
        <ArrowRight className="ml-2 w-4 h-4" />
      </Button>
    </div>
  );
}

export default PayoutOnboardingWizard;
