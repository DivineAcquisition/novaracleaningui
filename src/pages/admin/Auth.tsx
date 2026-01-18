import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  Lock,
  Mail,
  Eye,
  EyeOff,
  AlertCircle,
  Loader2,
  Building2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import logo from "@/assets/logo.png";

// Allowed admin emails
const ALLOWED_ADMIN_EMAILS = ["contact@novaracleaning.com"];
const ALLOWED_DOMAIN = "@novaracleaning.com";

export default function AdminAuth() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);

  // Check if already authenticated as admin
  useEffect(() => {
    checkExistingAuth();
  }, []);

  const checkExistingAuth = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (user && isAllowedAdmin(user.email)) {
        // Check if user has admin role
        const { data: roleCheck } = await supabase
          .from("user_roles")
          .select("*")
          .eq("user_id", user.id)
          .eq("role", "admin")
          .maybeSingle();

        if (roleCheck) {
          navigate("/admin/cleaners");
          return;
        }
      }
    } catch (error) {
      console.error("Auth check error:", error);
    } finally {
      setIsCheckingAuth(false);
    }
  };

  const isAllowedAdmin = (email: string | undefined): boolean => {
    if (!email) return false;
    return ALLOWED_ADMIN_EMAILS.includes(email.toLowerCase());
  };

  const isValidDomain = (email: string): boolean => {
    return email.toLowerCase().endsWith(ALLOWED_DOMAIN);
  };

  const handleEmailChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setEmail(value);
    setError("");

    // Show warning if email doesn't match allowed domain
    if (value && !value.includes("@")) {
      // Still typing, don't show error yet
    } else if (value && !isValidDomain(value)) {
      setError("Admin access requires a @novaracleaning.com email");
    } else if (value && isValidDomain(value) && !isAllowedAdmin(value)) {
      setError("This email is not authorized for admin access");
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    // Validate email domain
    if (!isValidDomain(email)) {
      setError("Admin access requires a @novaracleaning.com email");
      return;
    }

    // Validate allowed admin
    if (!isAllowedAdmin(email)) {
      setError("This email is not authorized for admin access. Contact IT if you need access.");
      return;
    }

    setIsLoading(true);

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.toLowerCase(),
        password,
      });

      if (signInError) {
        if (signInError.message.includes("Invalid login credentials")) {
          setError("Invalid email or password");
        } else {
          setError(signInError.message);
        }
        return;
      }

      if (data.user) {
        // Verify admin role exists
        const { data: roleCheck } = await supabase
          .from("user_roles")
          .select("*")
          .eq("user_id", data.user.id)
          .eq("role", "admin")
          .maybeSingle();

        if (!roleCheck) {
          // User exists but doesn't have admin role
          await supabase.auth.signOut();
          setError("Your account does not have admin privileges. Contact IT for access.");
          return;
        }

        toast.success("Welcome to the Admin Dashboard");
        navigate("/admin/cleaners");
      }
    } catch (err) {
      console.error("Sign in error:", err);
      setError("An unexpected error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  if (isCheckingAuth) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 animate-spin text-white" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex flex-col">
      {/* Header */}
      <header className="container max-w-6xl mx-auto px-4 py-6">
        <div className="flex items-center justify-center gap-3">
          <img src={logo} alt="Novara" className="w-10 h-10 rounded-xl" />
          <div className="flex items-center gap-2">
            <span className="text-2xl font-bold text-white">NovaraCleaning</span>
            <Badge className="bg-red-500/20 text-red-400 border-red-500/30">
              <Shield className="w-3 h-3 mr-1" />
              Admin
            </Badge>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex items-center justify-center px-4 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-md"
        >
          <Card className="border-slate-700 bg-slate-800/50 backdrop-blur-xl shadow-2xl">
            <CardHeader className="text-center space-y-4 pb-2">
              <div className="mx-auto w-16 h-16 rounded-2xl bg-gradient-to-br from-red-500 to-orange-600 flex items-center justify-center shadow-lg">
                <Lock className="w-8 h-8 text-white" />
              </div>
              <div>
                <CardTitle className="text-2xl text-white">Admin Portal</CardTitle>
                <CardDescription className="text-slate-400">
                  Restricted access for authorized personnel only
                </CardDescription>
              </div>
            </CardHeader>

            <CardContent className="space-y-6 pt-4">
              {/* Security Notice */}
              <Alert className="bg-slate-700/50 border-slate-600">
                <Building2 className="h-4 w-4 text-slate-400" />
                <AlertDescription className="text-slate-300 text-sm">
                  This portal is restricted to NovaraCleaning staff with @novaracleaning.com email addresses.
                </AlertDescription>
              </Alert>

              <form onSubmit={handleSignIn} className="space-y-4">
                {/* Email Field */}
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-slate-300">
                    Company Email
                  </Label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="email"
                      type="email"
                      placeholder="you@novaracleaning.com"
                      value={email}
                      onChange={handleEmailChange}
                      className="pl-10 bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-primary focus:ring-primary"
                      required
                      disabled={isLoading}
                    />
                  </div>
                </div>

                {/* Password Field */}
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-slate-300">
                    Password
                  </Label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <Input
                      id="password"
                      type={showPassword ? "text" : "password"}
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="pl-10 pr-10 bg-slate-700/50 border-slate-600 text-white placeholder:text-slate-500 focus:border-primary focus:ring-primary"
                      required
                      disabled={isLoading}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                    >
                      {showPassword ? (
                        <EyeOff className="w-4 h-4" />
                      ) : (
                        <Eye className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Error Message */}
                {error && (
                  <Alert variant="destructive" className="bg-red-500/10 border-red-500/30">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                {/* Submit Button */}
                <Button
                  type="submit"
                  className="w-full h-12 bg-gradient-to-r from-red-500 to-orange-600 hover:from-red-600 hover:to-orange-700 text-white font-semibold"
                  disabled={isLoading || !email || !password}
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                      Authenticating...
                    </>
                  ) : (
                    <>
                      <Shield className="mr-2 w-4 h-4" />
                      Access Admin Dashboard
                    </>
                  )}
                </Button>
              </form>

              {/* Help Text */}
              <div className="text-center text-sm text-slate-500">
                <p>
                  Need access?{" "}
                  <a href="mailto:contact@novaracleaning.com" className="text-primary hover:underline">
                    Contact IT Support
                  </a>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Security Footer */}
          <div className="mt-6 text-center">
            <div className="flex items-center justify-center gap-2 text-slate-500 text-sm">
              <Shield className="w-4 h-4" />
              <span>256-bit SSL Encrypted Connection</span>
            </div>
          </div>
        </motion.div>
      </main>

      {/* Footer */}
      <footer className="container max-w-6xl mx-auto px-4 py-6 border-t border-slate-800">
        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-slate-500">
          <span>© {new Date().getFullYear()} NovaraCleaning - Internal Use Only</span>
          <div className="flex items-center gap-4">
            <span className="text-xs">admin.novaracleaning.com</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
