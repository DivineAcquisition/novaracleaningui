import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Lock, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { SEO } from "@/components/SEO";

const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

export default function UpdatePassword() {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordUpdated, setPasswordUpdated] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) {
        toast.error("Invalid or expired reset link");
        navigate("/reset-password");
      }
    });
  }, [navigate]);

  const getPasswordStrength = (pwd: string) => {
    if (pwd.length === 0) return { strength: 0, label: "", color: "" };
    if (pwd.length < 6) return { strength: 25, label: "Weak", color: "bg-red-500" };
    if (pwd.length < 8) return { strength: 50, label: "Fair", color: "bg-orange-500" };
    if (pwd.length < 12) return { strength: 75, label: "Good", color: "bg-amber-500" };
    return { strength: 100, label: "Strong", color: "bg-emerald-500" };
  };

  const passwordStrength = getPasswordStrength(password);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      passwordSchema.parse(password);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }

    if (password !== confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    
    setIsLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    
    if (error) {
      toast.error(error.message || "Failed to update password");
      setIsLoading(false);
    } else {
      setPasswordUpdated(true);
      toast.success("Password updated successfully!");
      setTimeout(() => navigate("/account"), 2000);
    }
  };

  if (passwordUpdated) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4 py-6">
        <Card className="max-w-sm w-full shadow-xl border-0 overflow-hidden animate-scale-in">
          <div className="h-0.5 w-full" style={{ background: 'var(--gradient-primary)' }} />
          <CardContent className="pt-8 pb-8">
            <div className="space-y-4 text-center">
              <div className="mx-auto w-14 h-14 rounded-2xl flex items-center justify-center shadow-md" style={{ background: 'var(--gradient-primary)' }}>
                <CheckCircle2 className="w-7 h-7 text-white" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-bold tracking-tight">Password Updated!</h2>
                <p className="text-sm text-muted-foreground">Redirecting to your account...</p>
              </div>
              <Loader2 className="w-5 h-5 animate-spin mx-auto text-primary" />
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4 py-6">
      <SEO title="Update Password" description="Choose a new password for your Novara Cleaning account." noindex />
      <Card className="max-w-sm w-full shadow-xl border-0 overflow-hidden animate-scale-in">
        <div className="h-0.5 w-full" style={{ background: 'var(--gradient-primary)' }} />
        <CardHeader className="text-center space-y-1 pb-3 pt-6">
          <CardTitle className="text-xl font-bold tracking-tight">Update Password</CardTitle>
          <CardDescription className="text-sm">Choose a new password</CardDescription>
        </CardHeader>
        
        <CardContent className="px-6 pb-6">
          <form onSubmit={handleUpdatePassword} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground z-10" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Enter new password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 h-11 rounded-xl"
                  disabled={isLoading}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {password && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">Strength:</span>
                    <span className={cn(
                      "font-medium",
                      passwordStrength.strength <= 25 && "text-red-500",
                      passwordStrength.strength === 50 && "text-orange-500",
                      passwordStrength.strength === 75 && "text-amber-500",
                      passwordStrength.strength === 100 && "text-emerald-500",
                    )}>{passwordStrength.label}</span>
                  </div>
                  <div className="w-full bg-muted rounded-full h-1.5">
                    <div
                      className={cn("h-1.5 rounded-full transition-all duration-300", passwordStrength.color)}
                      style={{ width: `${passwordStrength.strength}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="confirm-password" className="text-sm">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 h-11 rounded-xl"
                  disabled={isLoading}
                  required
                />
              </div>
              {confirmPassword && password !== confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full h-11 rounded-xl bg-gradient-primary shadow-md"
              disabled={isLoading || password !== confirmPassword}
            >
              {isLoading ? (
                <><Loader2 className="mr-2 w-4 h-4 animate-spin" /> Updating...</>
              ) : (
                "Update Password"
              )}
            </Button>

            <p className="text-[11px] text-center text-muted-foreground">
              Min. 6 characters
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
