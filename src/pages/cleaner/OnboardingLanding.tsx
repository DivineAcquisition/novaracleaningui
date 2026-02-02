import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Sparkles, KeyRound, ArrowLeft, DollarSign, Calendar, Shield } from "lucide-react";
import logo from "@/assets/logo.png";

export default function OnboardingLanding() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsLoading(true);
    console.log("[LANDING] Sending verification code to:", email);

    try {
      const { error } = await supabase.functions.invoke('send-cleaner-verification-code', {
        body: { email, firstName: "" }
      });

      console.log("[LANDING] Send code response:", { error });

      if (error) {
        console.error("[LANDING] Failed to send code:", error);
        
        if (error.message?.includes("email")) {
          toast.error("Invalid email address. Please check and try again.");
        } else {
          toast.error(error.message || "Failed to send verification code");
        }
        return;
      }

      console.log("[LANDING] Verification code sent successfully");
      setStep('code');
      toast.success("Check your email for the 6-digit code!");
    } catch (error) {
      console.error("[LANDING] Email verification exception:", error);
      toast.error("Connection error. Please check your internet and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCodeVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (code.length !== 6) {
      toast.error("Please enter a valid 6-digit code");
      return;
    }

    setVerifying(true);
    console.log("[LANDING] Verifying code for email:", email);

    try {
      const { data, error } = await supabase.functions.invoke('verify-cleaner-code', {
        body: { email, code }
      });

      console.log("[LANDING] Verification response:", {
        hasTokens: !!data?.access_token && !!data?.refresh_token,
        error: error
      });

      if (error || !data?.access_token || !data?.refresh_token) {
        console.error("[LANDING] Verification failed:", error);
        
        if (error?.message?.includes("expired")) {
          toast.error("Code expired. Please request a new one.");
        } else if (error?.message?.includes("already used")) {
          toast.error("Code already used. Please request a new one.");
        } else {
          toast.error(error?.message || "Invalid code. Please try again.");
        }
        return;
      }

      console.log("[LANDING] Code verified, establishing session...");

      // Establish session directly with the tokens
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      if (sessionError) {
        console.error("[LANDING] Session establishment error:", sessionError);
        toast.error("Failed to establish session. Please request a new code.");
        return;
      }

      console.log("[LANDING] Session established successfully");
      toast.success("Email verified! Redirecting to onboarding...");
      
      // Small delay to ensure session is fully established
      setTimeout(() => {
        console.log("[LANDING] Navigating to /cleaner/onboarding");
        navigate("/cleaner/onboarding");
      }, 500);
      
    } catch (error) {
      console.error("[LANDING] Code verification exception:", error);
      toast.error("Connection error. Please check your internet and try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handleResendCode = async () => {
    setIsLoading(true);
    try {
      const { error } = await supabase.functions.invoke('send-cleaner-verification-code', {
        body: { email, firstName: "" }
      });
      
      if (error) {
        toast.error(error.message || "Failed to resend code");
      } else {
        toast.success("New code sent! Check your email.");
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseDifferentEmail = () => {
    setStep('email');
    setCode("");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center px-3 py-6 sm:px-4 sm:py-8">
      <div className="w-full max-w-sm space-y-4">
        {/* Logo and Title */}
        <div className="text-center">
          <img src={logo} alt="NovaraCleaning Logo" className="mx-auto w-12 h-12 sm:w-14 sm:h-14 rounded-xl mb-3 shadow-lavender" />
          <h1 className="text-xl sm:text-2xl font-bold mb-1">Become a Contractor</h1>
          <p className="text-sm text-muted-foreground">Join Novara Cleaning</p>
        </div>

        {/* Benefits - Only show on email step */}
        {step === 'email' && (
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-2 rounded-lg bg-primary/5">
              <DollarSign className="w-5 h-5 mx-auto text-primary mb-1" />
              <p className="text-xs font-medium">$18/hr</p>
            </div>
            <div className="p-2 rounded-lg bg-primary/5">
              <Calendar className="w-5 h-5 mx-auto text-primary mb-1" />
              <p className="text-xs font-medium">Flex Hours</p>
            </div>
            <div className="p-2 rounded-lg bg-primary/5">
              <Shield className="w-5 h-5 mx-auto text-primary mb-1" />
              <p className="text-xs font-medium">Weekly Pay</p>
            </div>
          </div>
        )}

        <Card className="shadow-lg border-primary/20">
          <CardHeader className="text-center space-y-1 pb-3 pt-4 px-4 sm:px-6">
            <div className="mx-auto w-10 h-10 bg-primary/10 rounded-full flex items-center justify-center">
              {step === 'code' ? (
                <KeyRound className="w-5 h-5 text-primary" />
              ) : (
                <Sparkles className="w-5 h-5 text-primary" />
              )}
            </div>
            <CardTitle className="text-lg sm:text-xl font-bold">
              {step === 'code' ? "Enter Code" : "Get Started"}
            </CardTitle>
            <CardDescription className="text-sm">
              {step === 'code'
                ? "Check your email for the 6-digit code"
                : "Enter your email to begin"
              }
            </CardDescription>
          </CardHeader>
          <CardContent className="px-4 sm:px-6 pb-4">
            {step === 'code' ? (
              <form onSubmit={handleCodeVerify} className="space-y-4">
                <div className="space-y-3">
                  <Label htmlFor="code" className="text-sm font-medium text-center block">
                    Verification Code
                  </Label>
                  <div className="flex justify-center">
                    <InputOTP maxLength={6} value={code} onChange={setCode}>
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                  </div>
                  <p className="text-xs text-muted-foreground text-center">
                    Sent to {email}
                  </p>
                </div>

                <Button
                  type="submit"
                  className="w-full h-10"
                  disabled={verifying || code.length !== 6}
                >
                  {verifying ? "Verifying..." : "Verify Code"}
                </Button>

                <div className="space-y-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleUseDifferentEmail}
                    className="w-full h-10"
                    disabled={verifying}
                  >
                    <ArrowLeft className="mr-2 h-4 w-4" />
                    Different Email
                  </Button>

                  <Button
                    type="button"
                    variant="ghost"
                    onClick={handleResendCode}
                    className="w-full h-9 text-sm"
                    disabled={isLoading || verifying}
                  >
                    {isLoading ? "Sending..." : "Resend Code"}
                  </Button>
                </div>
              </form>
            ) : (
              <form onSubmit={handleEmailSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="email" className="text-sm font-medium">
                    Email Address
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="your.email@example.com"
                      className="pl-9 h-10 text-sm"
                      disabled={isLoading}
                      autoFocus
                      required
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    We'll send a 6-digit verification code
                  </p>
                </div>

                <Button
                  type="submit"
                  className="w-full h-10"
                  disabled={isLoading || !email}
                >
                  {isLoading ? "Sending Code..." : "Continue"}
                </Button>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">
                      Already a contractor?
                    </span>
                  </div>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/cleaner/auth")}
                  className="w-full h-10"
                  disabled={isLoading}
                >
                  Sign In
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <div className="text-center text-xs text-muted-foreground">
          <Link to="/" className="text-primary hover:underline">
            ← Back to Home
          </Link>
        </div>
      </div>
    </div>
  );
}
