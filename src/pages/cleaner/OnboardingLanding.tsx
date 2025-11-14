import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Lock, Sparkles } from "lucide-react";

export default function OnboardingLanding() {
  const navigate = useNavigate();
  const [pin, setPin] = useState("");
  const [isValidating, setIsValidating] = useState(false);

  const handlePinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (pin.length !== 4) {
      toast.error("PIN must be 4 digits");
      return;
    }

    setIsValidating(true);

    try {
      // Validate PIN against database
      const { data, error } = await supabase
        .from("cleaner_onboarding_pins")
        .select("*")
        .eq("pin_code", pin)
        .eq("is_active", true)
        .single();

      if (error || !data) {
        toast.error("Invalid PIN code. Please contact admin for access.");
        setPin("");
        return;
      }

      // PIN is valid, navigate to onboarding form
      toast.success("Access granted! Let's get started.");
      navigate("/cleaner/onboarding", { state: { pinValidated: true } });
    } catch (error) {
      console.error("PIN validation error:", error);
      toast.error("Something went wrong. Please try again.");
    } finally {
      setIsValidating(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/5 flex items-center justify-center p-4">
      <Card className="w-full max-w-md border-border/50 shadow-lg">
        <CardHeader className="text-center space-y-3">
          <div className="mx-auto w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold">Join Our Team</CardTitle>
          <CardDescription className="text-base">
            Enter your access code to begin the onboarding process
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePinSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="pin" className="text-sm font-medium">
                4-Digit Access Code
              </Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
                <Input
                  id="pin"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={4}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                  placeholder="Enter 4-digit code"
                  className="pl-10 text-center text-2xl tracking-widest font-semibold h-14"
                  disabled={isValidating}
                  autoFocus
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Contact your team lead if you need an access code
              </p>
            </div>

            <Button
              type="submit"
              className="w-full h-12 text-lg"
              disabled={isValidating || pin.length !== 4}
            >
              {isValidating ? "Validating..." : "Continue to Onboarding"}
            </Button>
          </form>

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
