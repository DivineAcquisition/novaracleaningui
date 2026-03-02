import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  RiLoader4Line, RiMailLine, RiLockLine, RiSparklingLine, RiArrowLeftLine,
  RiShieldCheckLine, RiStarLine, RiCheckboxCircleLine
} from "@remixicon/react";
import logo from "@/assets/logo.png";
import { z } from "zod";
import { SEO } from "@/components/SEO";

const emailSchema = z.string().email("Please enter a valid email address");
const passwordSchema = z.string().min(6, "Password must be at least 6 characters");

export default function Auth() {
  const navigate = useNavigate();
  const { user, signIn, signUp, signInWithGoogle } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    const guestEmail = localStorage.getItem('guestBookingEmail');
    if (guestEmail) {
      setEmail(guestEmail);
      localStorage.removeItem('guestBookingEmail');
    }
  }, []);

  useEffect(() => {
    if (user) {
      navigate("/account", { replace: true });
    }
  }, [user, navigate]);

  const validateInputs = () => {
    try {
      emailSchema.parse(email);
      passwordSchema.parse(password);
      return true;
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
      }
      return false;
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateInputs()) return;
    
    setIsLoading(true);
    const { error } = await signIn(email, password);
    
    if (error) {
      if (error.message.includes("Invalid login credentials")) {
        toast.error("Invalid email or password");
      } else {
        toast.error(error.message || "Failed to sign in");
      }
    } else {
      toast.success("Welcome back!");
      navigate("/account");
    }
    setIsLoading(false);
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateInputs()) return;
    
    setIsLoading(true);
    const { data, error } = await signUp(email, password);
    
    if (error) {
      if (error.message.includes("already registered")) {
        toast.error("This email is already registered. Please sign in instead.");
      } else {
        toast.error(error.message || "Failed to sign up");
      }
    } else if (data?.user?.identities?.length === 0) {
      toast.error("This email is already registered. Please sign in or reset your password.");
    } else if (data?.user && !data?.session) {
      toast.success("Account created! Please check your email to verify your account.");
    } else if (data?.session) {
      toast.success("Account created successfully!");
      navigate("/account");
    }
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen flex">
      <SEO title="Sign In" description="Sign in to your Novara Cleaning account to manage bookings, track membership credits, and schedule cleanings." />
      {/* Left Panel - Branding (hidden on mobile) */}
      <div className="hidden lg:flex lg:w-[45%] relative overflow-hidden items-center justify-center p-12" style={{ background: 'var(--gradient-primary)' }}>
        <div className="absolute inset-0 opacity-10">
          <div className="absolute top-20 left-10 w-72 h-72 rounded-full bg-white/20 blur-3xl" />
          <div className="absolute bottom-20 right-10 w-96 h-96 rounded-full bg-white/10 blur-3xl" />
        </div>
        <div className="relative z-10 max-w-md text-white space-y-8">
          <div className="flex items-center gap-3">
            <img src={logo} alt="Novara" className="w-12 h-12 rounded-xl shadow-lg" />
            <span className="text-2xl font-bold">NovaraCleaning</span>
          </div>
          <div className="space-y-4">
            <h2 className="text-3xl font-bold leading-tight">
              Your home deserves the best care.
            </h2>
            <p className="text-white/80 text-lg leading-relaxed">
              Sign in to manage bookings, track credits, and keep your home sparkling.
            </p>
          </div>
          <div className="space-y-4 pt-4">
            {[
              { icon: RiShieldCheckLine, text: "Google Guaranteed & fully insured" },
              { icon: RiStarLine, text: "4.9 average rating from 500+ cleans" },
              { icon: RiCheckboxCircleLine, text: "Satisfaction guaranteed or we reclean free" },
            ].map((item, i) => (
              <div key={i} className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-white/15 flex items-center justify-center">
                  <item.icon className="w-4 h-4" />
                </div>
                <span className="text-sm text-white/90">{item.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right Panel - Auth Form */}
      <div className="flex-1 flex items-center justify-center p-4 sm:p-8 bg-background">
        <div className="w-full max-w-[400px] animate-fade-in">
          {/* Mobile: Back + Logo */}
          <div className="flex items-center justify-between mb-6 lg:hidden">
            <Button variant="ghost" size="sm" onClick={() => navigate("/")} className="text-muted-foreground -ml-2">
              <RiArrowLeftLine className="w-4 h-4 mr-1" /> Home
            </Button>
            <img src={logo} alt="Novara" className="w-8 h-8 rounded-lg" />
          </div>

          {/* Desktop: Logo + Header */}
          <div className="hidden lg:block mb-8">
            <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sign in to manage your bookings and account
            </p>
          </div>

          {/* Mobile: Header */}
          <div className="lg:hidden text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl shadow-lg mb-4" style={{ background: 'var(--gradient-primary)' }}>
              <img src={logo} alt="Novara" className="w-9 h-9 rounded-lg" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Sign in to manage your bookings
            </p>
          </div>

          <Card className="border-0 shadow-xl bg-card/80 backdrop-blur-sm">
            <CardContent className="p-6">
              {/* Google Button */}
              <Button
                type="button"
                variant="outline"
                className="w-full h-11 mb-5 font-medium rounded-xl border-border/80 hover:bg-muted/50"
                onClick={signInWithGoogle}
                disabled={isLoading}
              >
                <svg className="w-5 h-5 mr-2" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                </svg>
                Continue with Google
              </Button>
              
              {/* Divider */}
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-border/60" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-card px-3 text-xs text-muted-foreground uppercase tracking-wider">
                    or
                  </span>
                </div>
              </div>

              {/* Tabs */}
              <Tabs defaultValue="signin" className="w-full">
                <TabsList className="grid w-full grid-cols-2 mb-5 h-10 p-1 bg-muted/50 rounded-xl">
                  <TabsTrigger value="signin" className="text-sm font-medium rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                    Sign In
                  </TabsTrigger>
                  <TabsTrigger value="signup" className="text-sm font-medium rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm">
                    Create Account
                  </TabsTrigger>
                </TabsList>
                
                <TabsContent value="signin" className="mt-0">
                  <form onSubmit={handleSignIn} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signin-email" className="text-sm font-medium">
                        Email
                      </Label>
                      <div className="relative">
                        <RiMailLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          id="signin-email"
                          type="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-10 h-11 bg-background/50 rounded-xl"
                          disabled={isLoading}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <Label htmlFor="signin-password" className="text-sm font-medium">
                          Password
                        </Label>
                        <Link 
                          to="/reset-password" 
                          className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                        >
                          Forgot password?
                        </Link>
                      </div>
                      <div className="relative">
                        <RiLockLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          id="signin-password"
                          type="password"
                          placeholder="Enter your password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-10 h-11 bg-background/50 rounded-xl"
                          disabled={isLoading}
                          required
                        />
                      </div>
                    </div>

                    <Button
                      type="submit"
                      className="w-full h-11 rounded-xl bg-gradient-primary shadow-md"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <RiLoader4Line className="mr-2 w-4 h-4 animate-spin" />
                          Signing in...
                        </>
                      ) : (
                        "Sign In"
                      )}
                    </Button>
                  </form>
                </TabsContent>
                
                <TabsContent value="signup" className="mt-0">
                  <form onSubmit={handleSignUp} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="signup-email" className="text-sm font-medium">
                        Email
                      </Label>
                      <div className="relative">
                        <RiMailLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          id="signup-email"
                          type="email"
                          placeholder="you@example.com"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="pl-10 h-11 bg-background/50 rounded-xl"
                          disabled={isLoading}
                          required
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="signup-password" className="text-sm font-medium">
                        Password
                      </Label>
                      <div className="relative">
                        <RiLockLine className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                        <Input
                          id="signup-password"
                          type="password"
                          placeholder="Create a password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          className="pl-10 h-11 bg-background/50 rounded-xl"
                          disabled={isLoading}
                          required
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Must be at least 6 characters
                      </p>
                    </div>

                    <Button
                      type="submit"
                      className="w-full h-11 rounded-xl bg-gradient-primary shadow-md"
                      disabled={isLoading}
                    >
                      {isLoading ? (
                        <>
                          <RiLoader4Line className="mr-2 w-4 h-4 animate-spin" />
                          Creating account...
                        </>
                      ) : (
                        <>
                          <RiSparklingLine className="mr-2 w-4 h-4" />
                          Create Account
                        </>
                      )}
                    </Button>
                  </form>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>

          {/* Footer */}
          <div className="mt-6 text-center space-y-3">
            <p className="text-xs text-muted-foreground">
              Are you a cleaner?{" "}
              <Link to="/cleaner/auth" className="text-primary hover:underline font-medium">
                Cleaner Portal
              </Link>
            </p>
            <p className="text-[11px] text-muted-foreground/70">
              By continuing, you agree to our Terms of Service and Privacy Policy
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
