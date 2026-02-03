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
  Loader2,
  Mail,
  ArrowLeft
} from "lucide-react";
import { cn } from "@/lib/utils";

const BENEFITS = [
  { icon: DollarSign, title: "Great Pay", desc: "$18-22/hr" },
  { icon: Calendar, title: "Flexible", desc: "Your schedule" },
  { icon: Clock, title: "Weekly Pay", desc: "Direct deposit" },
  { icon: Shield, title: "Support", desc: "We help you" },
];

export default function OnboardingLanding() {
  const navigate = useNavigate();
  const [step, setStep] = useState<'welcome' | 'email' | 'verify'>('welcome');
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !email.includes("@")) {
      setError("Please enter a valid email address");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      // Send 6-digit verification code to email
      const { error: sendError } = await supabase.functions.invoke('send-cleaner-verification-code', {
        body: { email, firstName: "" }
      });

      if (sendError) {
        setError(sendError.message || "Failed to send verification code");
        return;
      }

      toast.success("Check your email for the 6-digit code!");
      setStep('verify');
    } catch (err) {
      console.error("Email send error:", err);
      setError("Connection error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCodeVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (code.length !== 6) {
      setError("Please enter all 6 digits");
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const { data, error: verifyError } = await supabase.functions.invoke('verify-cleaner-code', {
        body: { email, code }
      });

      if (verifyError || !data?.access_token || !data?.refresh_token) {
        if (verifyError?.message?.includes("expired")) {
          setError("Code expired. Please request a new one.");
        } else if (verifyError?.message?.includes("already used")) {
          setError("Code already used. Please request a new one.");
        } else {
          setError(verifyError?.message || "Invalid code. Please try again.");
        }
        return;
      }

      // Establish session with tokens
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      if (sessionError) {
        setError("Failed to establish session. Please try again.");
        return;
      }

      toast.success("Email verified! Redirecting...");
      setTimeout(() => navigate("/cleaner/onboarding"), 500);
      
    } catch (err) {
      console.error("Verification error:", err);
      setError("Connection error. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendCode = async () => {
    setIsLoading(true);
    setError("");
    try {
      const { error: sendError } = await supabase.functions.invoke('send-cleaner-verification-code', {
        body: { email, firstName: "" }
      });
      
      if (sendError) {
        setError(sendError.message || "Failed to resend code");
      } else {
        toast.success("New code sent!");
        setCode("");
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Welcome screen
  if (step === 'welcome') {
    return (
      <div className="min-h-screen bg-background">
        {/* Hero */}
        <div className="bg-gradient-to-br from-primary/10 via-background to-purple-500/10 px-4 pt-10 pb-6">
          <div className="max-w-sm mx-auto text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-gradient-to-br from-primary to-purple-600 shadow-lg mb-4">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-2xl font-bold mb-2">Join Novara</h1>
            <p className="text-sm text-muted-foreground">
              Start earning as a professional cleaner
            </p>
          </div>
        </div>

        <div className="max-w-sm mx-auto px-4 py-6 space-y-5">
          {/* Benefits */}
          <div className="grid grid-cols-2 gap-2.5">
            {BENEFITS.map((benefit, index) => {
              const Icon = benefit.icon;
              return (
                <div 
                  key={index}
                  className="bg-card rounded-xl p-3.5 border border-border shadow-sm"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center mb-2">
                    <Icon className="w-4 h-4 text-primary" />
                  </div>
                  <h3 className="font-semibold text-sm">{benefit.title}</h3>
                  <p className="text-xs text-muted-foreground">{benefit.desc}</p>
                </div>
              );
            })}
          </div>

          {/* CTA Card */}
          <Card className="border border-primary/20 shadow-md">
            <CardContent className="p-5 text-center">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center mx-auto mb-3">
                <Mail className="w-6 h-6 text-white" />
              </div>
              <h2 className="text-lg font-bold mb-1">Get Started</h2>
              <p className="text-xs text-muted-foreground mb-4">
                Enter your email to receive a verification code
              </p>
              <Button 
                className="w-full h-11 text-sm font-semibold border border-primary/20"
                onClick={() => setStep('email')}
              >
                Continue with Email
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </CardContent>
          </Card>

          {/* Sign in link */}
          <div className="text-center">
            <p className="text-xs text-muted-foreground mb-1">Already on the team?</p>
            <Button 
              variant="link" 
              onClick={() => navigate("/cleaner/auth")}
              className="text-primary text-sm h-auto p-0"
            >
              Sign in to your account
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Email Entry screen
  if (step === 'email') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-sm border border-border shadow-lg">
          <CardHeader className="text-center space-y-2 pb-3">
            <div className="mx-auto w-14 h-14 bg-gradient-to-br from-primary to-purple-600 rounded-xl flex items-center justify-center shadow-md">
              <Mail className="w-7 h-7 text-white" />
            </div>
            <CardTitle className="text-xl font-bold">Enter Your Email</CardTitle>
            <CardDescription className="text-sm">
              We'll send you a 6-digit verification code
            </CardDescription>
          </CardHeader>
          
          <CardContent className="px-5 pb-5">
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email Address
                </Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setError("");
                  }}
                  placeholder="your.email@example.com"
                  className={cn(
                    "h-11 text-sm border",
                    error ? "border-destructive" : "border-border"
                  )}
                  disabled={isLoading}
                  autoFocus
                  required
                />
                {error && (
                  <p className="text-xs text-destructive">{error}</p>
                )}
              </div>

              <Button
                type="submit"
                className="w-full h-11 text-sm font-semibold border border-primary/20"
                disabled={isLoading || !email}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    Send Code
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>

              <Button
                type="button"
                variant="ghost"
                className="w-full h-10 text-sm border border-border"
                onClick={() => setStep('welcome')}
                disabled={isLoading}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Code Verification screen
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border border-border shadow-lg">
        <CardHeader className="text-center space-y-2 pb-3">
          <div className="mx-auto w-14 h-14 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-md">
            <KeyRound className="w-7 h-7 text-white" />
          </div>
          <CardTitle className="text-xl font-bold">Enter Code</CardTitle>
          <CardDescription className="text-sm">
            Check <span className="font-medium text-foreground">{email}</span>
          </CardDescription>
        </CardHeader>
        
        <CardContent className="px-5 pb-5">
          <form onSubmit={handleCodeVerify} className="space-y-4">
            <div className="space-y-3">
              <div className="flex justify-center">
                <InputOTP 
                  maxLength={6} 
                  value={code} 
                  onChange={(value) => {
                    setCode(value);
                    setError("");
                  }}
                >
                  <InputOTPGroup className="gap-1.5">
                    {[0, 1, 2, 3, 4, 5].map((index) => (
                      <InputOTPSlot 
                        key={index} 
                        index={index} 
                        className={cn(
                          "w-10 h-12 text-lg font-bold rounded-lg border",
                          error ? "border-destructive" : "border-border"
                        )}
                      />
                    ))}
                  </InputOTPGroup>
                </InputOTP>
              </div>
              
              {error && (
                <p className="text-xs text-destructive text-center">{error}</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-11 text-sm font-semibold border border-primary/20"
              disabled={isLoading || code.length !== 6}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Verifying...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                  Verify & Continue
                </>
              )}
            </Button>

            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                className="flex-1 h-10 text-xs border border-border"
                onClick={() => {
                  setStep('email');
                  setCode("");
                  setError("");
                }}
                disabled={isLoading}
              >
                Change Email
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="flex-1 h-10 text-xs border border-border"
                onClick={handleResendCode}
                disabled={isLoading}
              >
                {isLoading ? "..." : "Resend Code"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
