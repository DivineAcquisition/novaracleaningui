"use client";

import {
  RiCheckboxCircleLine,
  RiKeyLine,
  RiMailLine,
  RiSparklingLine
} from "@remixicon/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export default function OnboardingLanding() {
  const router = useRouter();
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
        router.push("/cleaner/onboarding");
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
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <Card className="w-full max-w-sm border-border/50 shadow-lg">
        <CardHeader className="text-center space-y-2 pb-4 pt-5">
          <div className="mx-auto w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center">
            {step === 'code' ? (
              <RiKeyLine className="w-6 h-6 text-primary" />
            ) : (
              <RiSparklingLine className="w-6 h-6 text-primary" />
            )}
          </div>
          <CardTitle className="text-2xl font-bold">
            {step === 'code' ? "Verify Email" : "Join Our Team"}
          </CardTitle>
          <CardDescription className="text-sm">
            {step === 'code'
              ? "Enter the 6-digit code we sent"
              : "Start your journey as a Novara cleaner"
            }
          </CardDescription>
        </CardHeader>
        <CardContent className="px-5 pb-5">
          {step === 'code' ? (
            <form onSubmit={handleCodeVerify} className="space-y-4">
              <div className="space-y-3">
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
                className="w-full"
                size="lg"
                disabled={verifying || code.length !== 6}
              >
                {verifying ? "Verifying..." : "Verify Code"}
              </Button>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleUseDifferentEmail}
                  className="flex-1"
                  size="sm"
                  disabled={verifying}
                >
                  Change Email
                </Button>

                <Button
                  type="button"
                  variant="ghost"
                  onClick={handleResendCode}
                  className="flex-1"
                  size="sm"
                  disabled={isLoading || verifying}
                >
                  {isLoading ? "Sending..." : "Resend"}
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleEmailSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm">Email Address</Label>
                <div className="relative">
                  <RiMailLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your.email@example.com"
                    className="pl-9 h-10"
                    disabled={isLoading}
                    autoFocus
                    required
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  We'll send a verification code
                </p>
              </div>

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={isLoading || !email}
              >
                {isLoading ? "Sending Code..." : "Continue"}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-2 text-muted-foreground">
                    Already have an account?
                  </span>
                </div>
              </div>

              <Button
                type="button"
                variant="outline"
                onClick={() => router.push("/cleaner/auth")}
                className="w-full"
                size="sm"
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
