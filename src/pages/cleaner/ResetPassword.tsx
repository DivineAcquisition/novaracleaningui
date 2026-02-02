import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

const emailSchema = z.string().email("Please enter a valid email address");

export default function CleanerResetPassword() {
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      emailSchema.parse(email);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }
    
    setIsLoading(true);
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/update-password`,
    });
    
    if (error) {
      toast.error(error.message || "Failed to send reset email");
    } else {
      setEmailSent(true);
      toast.success("Password reset link sent! Check your email.");
    }
    
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center px-3 py-6 sm:px-4 sm:py-8">
      <Card className="max-w-sm w-full shadow-lg border-primary/20">
        <CardHeader className="text-center space-y-1 pb-3 pt-4 px-4 sm:px-6">
          <CardTitle className="text-xl sm:text-2xl font-bold">Reset Password</CardTitle>
          <CardDescription className="text-sm">
            {emailSent 
              ? "Check your email for the reset link"
              : "Enter your email to reset password"
            }
          </CardDescription>
        </CardHeader>
        
        <CardContent className="px-4 sm:px-6 pb-4">
          {emailSent ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center shadow-lavender">
                <CheckCircle2 className="w-6 h-6 text-white" />
              </div>
              <div className="space-y-2">
                <p className="font-medium text-sm">Email sent!</p>
                <p className="text-xs text-muted-foreground">
                  Reset link sent to <strong>{email}</strong>
                </p>
              </div>
              <Link to="/cleaner/auth">
                <Button variant="outline" className="w-full h-10">
                  <ArrowLeft className="mr-2 w-4 h-4" />
                  Back to Sign In
                </Button>
              </Link>
            </div>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="email" className="text-sm">Email</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9 h-10 text-sm"
                    disabled={isLoading}
                    required
                  />
                </div>
              </div>

              <Button
                type="submit"
                className="w-full h-10"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  "Send Reset Link"
                )}
              </Button>

              <Link to="/cleaner/auth">
                <Button variant="ghost" className="w-full h-10">
                  <ArrowLeft className="mr-2 w-4 h-4" />
                  Back to Sign In
                </Button>
              </Link>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
