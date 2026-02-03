import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { 
  Sparkles, 
  KeyRound, 
  CheckCircle2, 
  Shield, 
  DollarSign, 
  Calendar, 
  Clock,
  ArrowRight,
  Loader2
} from "lucide-react";
import { cn } from "@/lib/utils";

const BENEFITS = [
  { icon: DollarSign, title: "Competitive Pay", desc: "$18-22/hr based on experience" },
  { icon: Calendar, title: "Flexible Schedule", desc: "Choose your own days & hours" },
  { icon: Clock, title: "Weekly Payouts", desc: "Fast, direct deposits via Stripe" },
  { icon: Shield, title: "Support & Training", desc: "We've got your back" },
];

export default function OnboardingLanding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'welcome' | 'pin' | 'email'>('welcome');
  const [pin, setPin] = useState("");
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [pinError, setPinError] = useState("");

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (pin.length !== 6) {
      setPinError("Please enter a valid 6-digit PIN");
      return;
    }

    setIsLoading(true);
    setPinError("");

    try {
      // Verify PIN against cleaner_onboarding_pins table
      const { data: pinData, error: pinError } = await supabase
        .from('cleaner_onboarding_pins')
        .select('*')
        .eq('pin_code', pin)
        .eq('is_active', true)
        .is('used_at', null)
        .single();

      if (pinError || !pinData) {
        setPinError("Invalid or expired PIN code. Please contact your recruiter.");
        setIsLoading(false);
        return;
      }

      // PIN is valid, move to email step
      toast.success("PIN verified! Enter your email to continue.");
      setStep('email');
    } catch (error) {
      console.error("PIN verification error:", error);
      setPinError("Error verifying PIN. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsLoading(true);

    try {
      // Send verification code
      const { error } = await supabase.functions.invoke('send-cleaner-verification-code', {
        body: { email, firstName: "", pin }
      });

      if (error) {
        if (error.message?.includes("email")) {
          toast.error("Invalid email address. Please check and try again.");
        } else {
          toast.error(error.message || "Failed to send verification code");
        }
        return;
      }

      // Mark PIN as used
      await supabase
        .from('cleaner_onboarding_pins')
        .update({ used_at: new Date().toISOString() })
        .eq('pin_code', pin);

      toast.success("Check your email for the verification link!");
      
      // Store email for the auth callback
      localStorage.setItem('cleaner_onboarding_email', email);
      
      // Navigate to the code verification page or wait for magic link
      navigate("/cleaner/auth?mode=verify&email=" + encodeURIComponent(email));
      
    } catch (error) {
      console.error("Email submission error:", error);
      toast.error("Connection error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  // Welcome screen with benefits
  if (step === 'welcome') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10">
        {/* Hero Section */}
        <div className="relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/20 to-purple-600/20 blur-3xl opacity-50" />
          
          <div className="relative max-w-lg mx-auto px-4 pt-12 pb-8 text-center">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-gradient-to-br from-primary to-purple-600 shadow-2xl mb-6">
              <Sparkles className="w-10 h-10 text-white" />
            </div>
            
            <h1 className="text-3xl md:text-4xl font-bold mb-3">
              Join the Novara Team
            </h1>
            <p className="text-muted-foreground text-lg mb-8">
              Earn great money, set your own schedule, and be part of something amazing.
            </p>
          </div>
        </div>

        {/* Benefits Grid */}
        <div className="max-w-lg mx-auto px-4 pb-8">
          <div className="grid grid-cols-2 gap-3 mb-8">
            {BENEFITS.map((benefit, index) => {
              const Icon = benefit.icon;
              return (
                <div 
                  key={index}
                  className="bg-card rounded-2xl p-4 border border-border/50 shadow-sm"
                >
                  <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center mb-3">
                    <Icon className="w-5 h-5 text-primary" />
                  </div>
                  <h3 className="font-semibold text-sm mb-1">{benefit.title}</h3>
                  <p className="text-xs text-muted-foreground">{benefit.desc}</p>
                </div>
              );
            })}
          </div>

          {/* CTA Card */}
          <Card className="border-2 border-primary/20 shadow-xl">
            <CardContent className="p-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center mx-auto mb-4">
                <KeyRound className="w-7 h-7 text-white" />
              </div>
              <h2 className="text-xl font-bold mb-2">Have a PIN Code?</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Enter the 6-digit PIN from your recruiter to start onboarding
              </p>
              <Button 
                size="lg" 
                className="w-full h-12 text-base font-semibold"
                onClick={() => setStep('pin')}
              >
                Enter PIN Code
                <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            </CardContent>
          </Card>

          {/* Already have account */}
          <div className="text-center mt-6">
            <p className="text-sm text-muted-foreground mb-2">Already on the team?</p>
            <Button 
              variant="link" 
              onClick={() => navigate("/cleaner/auth")}
              className="text-primary"
            >
              Sign in to your account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // PIN Entry screen
  if (step === 'pin') {
    return (
      <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center p-4">
        <Card className="w-full max-w-sm border-border/50 shadow-xl">
          <CardHeader className="text-center space-y-3 pb-4">
            <div className="mx-auto w-16 h-16 bg-gradient-to-br from-primary to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
              <KeyRound className="w-8 h-8 text-white" />
            </div>
            <CardTitle className="text-2xl font-bold">Enter Your PIN</CardTitle>
            <CardDescription className="text-base">
              Enter the 6-digit code from your recruiter
            </CardDescription>
          </CardHeader>
          
          <CardContent className="px-6 pb-6">
            <form onSubmit={handlePinSubmit} className="space-y-6">
              <div className="space-y-4">
                <div className="flex justify-center">
                  <InputOTP 
                    maxLength={6} 
                    value={pin} 
                    onChange={(value) => {
                      setPin(value);
                      setPinError("");
                    }}
                  >
                    <InputOTPGroup className="gap-2">
                      {[0, 1, 2, 3, 4, 5].map((index) => (
                        <InputOTPSlot 
                          key={index} 
                          index={index} 
                          className={cn(
                            "w-12 h-14 text-xl font-bold rounded-xl border-2",
                            pinError ? "border-destructive" : "border-border"
                          )}
                        />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                </div>
                
                {pinError && (
                  <p className="text-sm text-destructive text-center">{pinError}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-base font-semibold"
                disabled={isLoading || pin.length !== 6}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    Verify PIN
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => setStep('welcome')}
                disabled={isLoading}
              >
                Back
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Email Entry screen (after PIN verified)
  return (
    <div className="min-h-screen bg-gradient-to-br from-primary/5 via-background to-accent/10 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-border/50 shadow-xl">
        <CardHeader className="text-center space-y-3 pb-4">
          <div className="mx-auto w-16 h-16 bg-gradient-to-br from-green-500 to-emerald-600 rounded-2xl flex items-center justify-center shadow-lg">
            <CheckCircle2 className="w-8 h-8 text-white" />
          </div>
          <CardTitle className="text-2xl font-bold">PIN Verified!</CardTitle>
          <CardDescription className="text-base">
            Enter your email to complete registration
          </CardDescription>
        </CardHeader>
        
        <CardContent className="px-6 pb-6">
          <form onSubmit={handleEmailSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm font-medium">
                Email Address
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your.email@example.com"
                className="h-12 text-base"
                disabled={isLoading}
                autoFocus
                required
              />
              <p className="text-xs text-muted-foreground">
                We'll send you a verification link
              </p>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-base font-semibold"
              disabled={isLoading || !email}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  Continue
                  <ArrowRight className="w-5 h-5 ml-2" />
                </>
              )}
            </Button>

            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => {
                setStep('pin');
                setPin("");
              }}
              disabled={isLoading}
            >
              Use Different PIN
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
