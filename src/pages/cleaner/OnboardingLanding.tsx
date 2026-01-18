import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { 
  Mail, 
  Sparkles, 
  CheckCircle2, 
  KeyRound, 
  ArrowRight, 
  Shield, 
  DollarSign, 
  Clock, 
  Users,
  Loader2,
  RefreshCw,
  ChevronLeft
} from "lucide-react";
import logo from "@/assets/logo.png";

const BENEFITS = [
  {
    icon: DollarSign,
    title: "Instant Payouts",
    description: "Get paid automatically when jobs are completed"
  },
  {
    icon: Clock,
    title: "Flexible Schedule",
    description: "Work when you want, set your own availability"
  },
  {
    icon: Shield,
    title: "Secure Platform",
    description: "Background-checked team members only"
  },
  {
    icon: Users,
    title: "Growing Network",
    description: "Join a community of professional cleaners"
  }
];

export default function OnboardingLanding() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [code, setCode] = useState(["", "", "", "", "", ""]);
  const [verifying, setVerifying] = useState(false);
  const [resendCountdown, setResendCountdown] = useState(0);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Resend countdown timer
  useEffect(() => {
    if (resendCountdown > 0) {
      const timer = setTimeout(() => setResendCountdown(resendCountdown - 1), 1000);
      return () => clearTimeout(timer);
    }
  }, [resendCountdown]);

  // Auto-focus first OTP input when entering code step
  useEffect(() => {
    if (step === 'code' && inputRefs.current[0]) {
      inputRefs.current[0].focus();
    }
  }, [step]);

  const validateEmail = (email: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const trimmedEmail = email.trim().toLowerCase();
    
    if (!trimmedEmail) {
      toast.error("Please enter your email address");
      return;
    }

    if (!validateEmail(trimmedEmail)) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsLoading(true);
    console.log("[ONBOARDING] Sending verification code to:", trimmedEmail);

    try {
      const { data, error } = await supabase.functions.invoke('send-cleaner-verification-code', {
        body: { email: trimmedEmail, firstName: "" }
      });

      console.log("[ONBOARDING] Send code response:", { data, error });

      // Check for invocation error
      if (error) {
        console.error("[ONBOARDING] Function invocation error:", error);
        toast.error("Unable to connect to server. Please try again.");
        return;
      }

      // Check response success flag
      if (data?.success === false) {
        console.error("[ONBOARDING] Server returned error:", data?.error);
        toast.error(data?.error || "Failed to send verification code. Please try again.");
        return;
      }

      console.log("[ONBOARDING] Verification code sent successfully");
      setStep('code');
      setResendCountdown(60);
      
      // Show debug code if available (only in development)
      if (data?.testCode) {
        console.log("[ONBOARDING] Test code:", data.testCode);
        toast.success(`Code sent! (Debug: ${data.testCode})`);
      } else {
        toast.success(data?.message || "Verification code sent! Check your email.");
      }
    } catch (error) {
      console.error("[ONBOARDING] Email verification exception:", error);
      toast.error("Connection error. Please check your internet and try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCodeChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, '').slice(-1);
    
    const newCode = [...code];
    newCode[index] = digit;
    setCode(newCode);

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all digits are entered
    if (digit && index === 5) {
      const fullCode = newCode.join('');
      if (fullCode.length === 6) {
        handleCodeVerify(fullCode);
      }
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !code[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (pasted.length === 6) {
      const newCode = pasted.split('');
      setCode(newCode);
      inputRefs.current[5]?.focus();
      handleCodeVerify(pasted);
    }
  };

  const handleCodeVerify = async (codeString?: string) => {
    const fullCode = codeString || code.join('');
    
    if (fullCode.length !== 6) {
      toast.error("Please enter the complete 6-digit code");
      return;
    }

    setVerifying(true);
    console.log("[ONBOARDING] Verifying code for email:", email);

    try {
      const { data, error } = await supabase.functions.invoke('verify-cleaner-code', {
        body: { email: email.trim().toLowerCase(), code: fullCode }
      });

      console.log("[ONBOARDING] Verification response:", {
        success: data?.success,
        hasTokens: !!data?.access_token && !!data?.refresh_token,
        error: error || data?.error
      });

      // Check for invocation error
      if (error) {
        console.error("[ONBOARDING] Function invocation error:", error);
        setCode(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        toast.error("Unable to connect to server. Please try again.");
        return;
      }

      // Check response success flag
      if (data?.success === false || !data?.access_token || !data?.refresh_token) {
        console.error("[ONBOARDING] Verification failed:", data?.error);
        setCode(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        toast.error(data?.error || "Invalid code. Please try again.");
        return;
      }

      console.log("[ONBOARDING] Code verified, establishing session...");

      // Establish session directly with the tokens
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: data.access_token,
        refresh_token: data.refresh_token,
      });

      if (sessionError) {
        console.error("[ONBOARDING] Session establishment error:", sessionError);
        toast.error("Failed to establish session. Please request a new code.");
        return;
      }

      console.log("[ONBOARDING] Session established successfully");
      toast.success("Email verified! Let's complete your profile.");
      
      // Navigate to onboarding
      setTimeout(() => {
        navigate("/cleaner/onboarding");
      }, 500);
      
    } catch (error) {
      console.error("[ONBOARDING] Code verification exception:", error);
      toast.error("Connection error. Please check your internet and try again.");
    } finally {
      setVerifying(false);
    }
  };

  const handleResendCode = async () => {
    if (resendCountdown > 0) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('send-cleaner-verification-code', {
        body: { email: email.trim().toLowerCase(), firstName: "" }
      });
      
      if (error) {
        toast.error("Unable to connect to server. Please try again.");
      } else if (data?.success === false) {
        toast.error(data?.error || "Failed to resend code");
      } else {
        setResendCountdown(60);
        setCode(["", "", "", "", "", ""]);
        inputRefs.current[0]?.focus();
        if (data?.testCode) {
          toast.success(`New code sent! (Debug: ${data.testCode})`);
        } else {
          toast.success(data?.message || "New code sent! Check your email.");
        }
      }
    } catch {
      toast.error("Failed to resend code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUseDifferentEmail = () => {
    setStep('email');
    setCode(["", "", "", "", "", ""]);
    setResendCountdown(0);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[#5500FF]/5 via-background to-[#8F7BFD]/10">
      {/* Header */}
      <header className="container mx-auto px-4 py-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Novara" className="w-10 h-10 rounded-xl" />
            <span className="text-xl font-bold">Novara Cleaning</span>
          </div>
          <Button 
            variant="ghost" 
            onClick={() => navigate("/cleaner/auth")}
            className="text-muted-foreground"
          >
            Already have an account?
          </Button>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 md:py-16">
        <div className="grid lg:grid-cols-2 gap-12 items-center max-w-6xl mx-auto">
          
          {/* Left Side - Hero Content */}
          <div className="space-y-8">
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#5500FF]/10 text-[#5500FF] text-sm font-medium">
                <Sparkles className="w-4 h-4" />
                Join Our Growing Team
              </div>
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight">
                Start Earning as a
                <span className="block bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] bg-clip-text text-transparent">
                  Professional Cleaner
                </span>
              </h1>
              <p className="text-lg md:text-xl text-muted-foreground max-w-lg">
                Join Novara Cleaning and enjoy flexible schedules, competitive pay, and instant payouts. 
                Get started in just 5 minutes.
              </p>
            </div>

            {/* Benefits Grid */}
            <div className="grid grid-cols-2 gap-4">
              {BENEFITS.map((benefit, index) => (
                <div 
                  key={index}
                  className="flex items-start gap-3 p-4 rounded-xl bg-card/50 backdrop-blur border border-border/50"
                >
                  <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#5500FF] to-[#8F7BFD] flex items-center justify-center flex-shrink-0">
                    <benefit.icon className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm">{benefit.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{benefit.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Side - Form Card */}
          <div className="lg:pl-8">
            <Card className="shadow-2xl border-[#5500FF]/20 overflow-hidden">
              {/* Card Header with Gradient */}
              <div className="bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] p-6 text-white">
                <div className="flex items-center gap-3 mb-2">
                  {step === 'code' ? (
                    <KeyRound className="w-8 h-8" />
                  ) : (
                    <Mail className="w-8 h-8" />
                  )}
                  <h2 className="text-2xl font-bold">
                    {step === 'code' ? "Enter Code" : "Get Started"}
                  </h2>
                </div>
                <p className="text-white/80">
                  {step === 'code'
                    ? `Enter the 6-digit code sent to ${email}`
                    : "Enter your email to begin the application"
                  }
                </p>
              </div>

              <CardContent className="p-6">
                {step === 'code' ? (
                  <div className="space-y-6">
                    {/* OTP Input */}
                    <div className="space-y-3">
                      <Label className="text-sm font-medium text-center block">
                        Verification Code
                      </Label>
                      <div className="flex justify-center gap-2" onPaste={handlePaste}>
                        {code.map((digit, index) => (
                          <Input
                            key={index}
                            ref={(el) => (inputRefs.current[index] = el)}
                            type="text"
                            inputMode="numeric"
                            maxLength={1}
                            value={digit}
                            onChange={(e) => handleCodeChange(index, e.target.value)}
                            onKeyDown={(e) => handleKeyDown(index, e)}
                            className="w-12 h-14 text-center text-2xl font-bold border-2 focus:border-[#5500FF] focus:ring-[#5500FF]"
                            disabled={verifying}
                          />
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground text-center">
                        Code expires in 15 minutes
                      </p>
                    </div>

                    {/* Verify Button */}
                    <Button
                      onClick={() => handleCodeVerify()}
                      className="w-full h-12 text-lg bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
                      disabled={verifying || code.join('').length !== 6}
                    >
                      {verifying ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Verifying...
                        </>
                      ) : (
                        <>
                          Verify & Continue
                          <ArrowRight className="ml-2 w-5 h-5" />
                        </>
                      )}
                    </Button>

                    {/* Action Buttons */}
                    <div className="space-y-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={handleUseDifferentEmail}
                        className="w-full"
                        disabled={verifying}
                      >
                        <ChevronLeft className="mr-2 w-4 h-4" />
                        Use Different Email
                      </Button>

                      <Button
                        type="button"
                        variant="ghost"
                        onClick={handleResendCode}
                        className="w-full"
                        disabled={isLoading || verifying || resendCountdown > 0}
                      >
                        <RefreshCw className={`mr-2 w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        {resendCountdown > 0 
                          ? `Resend in ${resendCountdown}s` 
                          : "Resend Code"
                        }
                      </Button>
                    </div>
                  </div>
                ) : (
                  <form onSubmit={handleEmailSubmit} className="space-y-6">
                    {/* Email Input */}
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
                          className="pl-10 h-12 text-base"
                          disabled={isLoading}
                          autoFocus
                          required
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        We'll send you a 6-digit verification code
                      </p>
                    </div>

                    {/* Submit Button */}
                    <Button
                      type="submit"
                      className="w-full h-12 text-lg bg-gradient-to-r from-[#5500FF] to-[#8F7BFD] hover:opacity-90"
                      disabled={isLoading || !email.trim()}
                    >
                      {isLoading ? (
                        <>
                          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                          Sending Code...
                        </>
                      ) : (
                        <>
                          Continue
                          <ArrowRight className="ml-2 w-5 h-5" />
                        </>
                      )}
                    </Button>

                    {/* Divider */}
                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs uppercase">
                        <span className="bg-card px-2 text-muted-foreground">
                          Already a cleaner?
                        </span>
                      </div>
                    </div>

                    {/* Sign In Link */}
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => navigate("/cleaner/auth")}
                      className="w-full"
                      disabled={isLoading}
                    >
                      Sign In to Your Account
                    </Button>
                  </form>
                )}

                {/* Trust Badges */}
                <div className="mt-6 pt-6 border-t border-border">
                  <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Shield className="w-4 h-4 text-[#5500FF]" />
                      <span>Secure</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <CheckCircle2 className="w-4 h-4 text-[#5500FF]" />
                      <span>Verified</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Users className="w-4 h-4 text-[#5500FF]" />
                      <span>500+ Cleaners</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="container mx-auto px-4 py-8 mt-auto">
        <div className="text-center text-sm text-muted-foreground">
          <p>© {new Date().getFullYear()} Novara Cleaning. All rights reserved.</p>
          <p className="mt-1">
            Questions? Contact us at{" "}
            <a href="mailto:hello@novaracleaning.com" className="text-[#5500FF] hover:underline">
              hello@novaracleaning.com
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}
