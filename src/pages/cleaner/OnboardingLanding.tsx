import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Mail, Sparkles, CheckCircle2 } from "lucide-react";

export default function OnboardingLanding() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email || !email.includes("@")) {
      toast.error("Please enter a valid email address");
      return;
    }

    setIsLoading(true);

    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email,
        options: {
          emailRedirectTo: `${window.location.origin}/cleaner/onboarding`,
          data: {
            onboarding: true,
            is_cleaner: true
          }
        }
      });

      if (error) {
        toast.error(error.message);
        return;
      }

      setEmailSent(true);
      toast.success("Check your email for the verification link!");
    } catch (error) {
      console.error("Email verification error:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResend = async () => {
    setEmailSent(false);
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            {emailSent ? (
              <CheckCircle2 className="w-8 h-8 text-primary" />
            ) : (
              <Sparkles className="w-8 h-8 text-primary" />
            )}
          </div>
          <CardTitle className="text-3xl font-bold">
            {emailSent ? "Check Your Email" : "Join Our Team"}
          </CardTitle>
          <CardDescription className="text-base">
            {emailSent 
              ? "We've sent you a verification link to continue"
              : "Enter your email to begin the onboarding process"
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {!emailSent ? (
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
                  We'll send you a secure link to verify your email
                </p>
              </div>

              <Button
                type="submit"
                className="w-full h-12 text-lg"
                disabled={isLoading || !email}
              >
                {isLoading ? "Sending..." : "Continue to Onboarding"}
              </Button>
            </form>
          ) : (
            <div className="space-y-6">
              <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 space-y-2">
                <p className="text-sm font-medium">📧 Verification link sent to:</p>
                <p className="text-sm text-muted-foreground break-all">{email}</p>
              </div>
              
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>Click the link in your email to continue with onboarding.</p>
                <p>The link is valid for 1 hour and can only be used once.</p>
              </div>

              <Button
                onClick={handleResend}
                variant="outline"
                className="w-full"
              >
                Use Different Email
              </Button>
            </div>
          )}

          <div className="mt-6 pt-6 border-t border-border/50 text-center">
            <p className="text-sm text-muted-foreground">
              Already have an account?{" "}
              <button
                onClick={() => navigate("/cleaner/auth")}
                className="text-primary hover:underline font-medium"
              >
                Sign in
              </button>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
