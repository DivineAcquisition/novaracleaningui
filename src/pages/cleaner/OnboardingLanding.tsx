import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Sparkles, CheckCircle2, KeyRound } from "lucide-react";

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

    try {
      const { error } = await supabase.functions.invoke('send-cleaner-verification-code', {
        body: { email, firstName: "" }
      });

      if (error) {
        toast.error(error.message || "Failed to send verification code");
        return;
      }

      setStep('code');
      toast.success("Check your email for the 6-digit code!");
    } catch (error) {
      console.error("Email verification error:", error);
      toast.error("Something went wrong. Please try again.");
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

    try {
      const { data, error } = await supabase.functions.invoke('verify-cleaner-code', {
        body: { email, code }
      });

      if (error || !data?.access_token || !data?.refresh_token) {
        toast.error(error?.message || "Invalid or expired code");
        console.error("Verification error:", error);
        return;
      }

      console.log("Code verified, establishing session...");

      // Establish session directly with the tokens
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      if (sessionError) {
        toast.error("Failed to establish session. Please try again.");
        console.error("Session error:", sessionError);
        return;
      }

      console.log("Session established successfully");
      toast.success("Email verified! Redirecting to onboarding...");
      
      // Small delay to ensure session is fully established
      setTimeout(() => {
        navigate("/cleaner/onboarding");
      }, 500);
      
    } catch (error) {
      console.error("Code verification error:", error);
      toast.error("Something went wrong. Please try again.");
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
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            {step === 'code' ? (
              <KeyRound className="w-8 h-8 text-primary" />
            ) : (
              <Sparkles className="w-8 h-8 text-primary" />
            )}
          </div>
          <CardTitle className="text-3xl font-bold">
            {step === 'code' ? "Enter Verification Code" : "Join Our Team"}
          </CardTitle>
          <CardDescription className="text-base">
            {step === 'code'
              ? "Enter the 6-digit code sent to your email"
              : "Enter your email to begin the onboarding process"
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'code' ? (
            <form onSubmit={handleCodeVerify} className="space-y-6">
              <div className="space-y-4">
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
                  Sent to {email}. Expires in 15 minutes.
                </p>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-lg"
                disabled={verifying || code.length !== 6}
              >
                {verifying ? "Verifying..." : "Verify Code"}
              </Button>

              <div className="space-y-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleUseDifferentEmail}
                  className="w-full"
                  disabled={verifying}
                >
                  Use Different Email
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleResendCode}
                  className="w-full"
                  disabled={isLoading || verifying}
                >
                  {isLoading ? "Sending..." : "Resend Code"}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleEmailSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sm font-medium">
                  Email Address
                </Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your.email@example.com"
                    className="pl-10 h-12"
                    disabled={isLoading}
                    autoFocus
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  We'll send you a 6-digit verification code
                </p>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-lg"
                disabled={isLoading || !email}
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <span className="animate-spin">⏳</span>
                    Sending Code...
                  </span>
                ) : (
                  "Continue"
                )}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">
                    Already have an account?
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => navigate("/cleaner/auth")}
                className="w-full"
                disabled={isLoading}
              >
                Sign In
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
