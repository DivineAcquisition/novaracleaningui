import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Headphones, Shield, Lock, XCircle, Loader2, Eye, EyeOff,
  Phone, Users, ArrowRight, CheckCircle
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

// VA credentials
const VA_EMAIL = "contact@novaracleaning.com";
const VA_PASSWORD = "Divine74!";

export default function AdminAuth() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/admin";
  
  // Tab state
  const [activeTab, setActiveTab] = useState<"va" | "manager">("va");
  
  // VA Login state
  const [vaEmail, setVaEmail] = useState("");
  const [vaPassword, setVaPassword] = useState("");
  const [vaError, setVaError] = useState("");
  const [vaLoading, setVaLoading] = useState(false);
  const [showVaPassword, setShowVaPassword] = useState(false);
  
  // Manager Login state
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [managerError, setManagerError] = useState("");
  const [managerLoading, setManagerLoading] = useState(false);
  const [showManagerPassword, setShowManagerPassword] = useState(false);

  const handleVALogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setVaError("");
    setVaLoading(true);
    
    // Simulate brief loading for UX
    await new Promise(resolve => setTimeout(resolve, 500));
    
    const emailMatch = vaEmail.trim().toLowerCase() === VA_EMAIL.toLowerCase();
    const passwordMatch = vaPassword === VA_PASSWORD;
    
    if (emailMatch && passwordMatch) {
      // Set session storage for all VA tools
      sessionStorage.setItem("admin_dashboard_access", "true");
      sessionStorage.setItem("va_sales_access", "true");
      sessionStorage.setItem("intake_access", "true");
      
      toast.success("Welcome! Redirecting to admin dashboard...");
      
      // Redirect to the intended destination or admin dashboard
      setTimeout(() => {
        navigate(redirectTo, { replace: true });
      }, 500);
    } else {
      setVaError("Invalid email or password. Please check your credentials.");
    }
    
    setVaLoading(false);
  };

  const handleManagerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setManagerError("");
    setManagerLoading(true);
    
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        email: managerEmail.trim(),
        password: managerPassword,
      });
      
      if (error) {
        throw error;
      }
      
      if (data.user) {
        // Check if user has admin role
        const { data: roleData } = await supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", data.user.id)
          .eq("role", "admin")
          .single();
        
        if (!roleData) {
          // Sign out if not admin
          await supabase.auth.signOut();
          setManagerError("You don't have admin access. Please contact support.");
          setManagerLoading(false);
          return;
        }
        
        // Also grant VA access for managers
        sessionStorage.setItem("admin_dashboard_access", "true");
        sessionStorage.setItem("va_sales_access", "true");
        sessionStorage.setItem("intake_access", "true");
        
        toast.success("Welcome, Admin! Redirecting...");
        
        setTimeout(() => {
          navigate(redirectTo, { replace: true });
        }, 500);
      }
    } catch (error: any) {
      console.error("Login error:", error);
      if (error.message?.includes("Invalid login credentials")) {
        setManagerError("Invalid email or password.");
      } else if (error.message?.includes("Email not confirmed")) {
        setManagerError("Please verify your email address first.");
      } else {
        setManagerError(error.message || "Login failed. Please try again.");
      }
    } finally {
      setManagerLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo & Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-primary flex items-center justify-center shadow-lg mb-4">
            <Shield className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold font-jakarta text-foreground">
            Novara Admin Portal
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in to access admin tools
          </p>
        </div>

        <Card className="shadow-card border-primary/20">
          <CardContent className="pt-6">
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "va" | "manager")}>
              <TabsList className="grid grid-cols-2 w-full mb-6">
                <TabsTrigger 
                  value="va" 
                  className="data-[state=active]:bg-gradient-primary data-[state=active]:text-white"
                >
                  <Headphones className="w-4 h-4 mr-2" />
                  VA Login
                </TabsTrigger>
                <TabsTrigger 
                  value="manager"
                  className="data-[state=active]:bg-gradient-primary data-[state=active]:text-white"
                >
                  <Shield className="w-4 h-4 mr-2" />
                  Manager
                </TabsTrigger>
              </TabsList>

              {/* VA Login Tab */}
              <TabsContent value="va" className="space-y-4">
                <div className="bg-accent/50 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center flex-shrink-0">
                      <Phone className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Virtual Assistant Access</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Access to VA Sales Portal and Booking Intake forms
                      </p>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleVALogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="va-email">Email</Label>
                    <Input
                      id="va-email"
                      type="email"
                      value={vaEmail}
                      onChange={(e) => setVaEmail(e.target.value)}
                      placeholder="Enter your VA email"
                      className="h-11"
                      disabled={vaLoading}
                      autoFocus
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="va-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="va-password"
                        type={showVaPassword ? "text" : "password"}
                        value={vaPassword}
                        onChange={(e) => setVaPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="h-11 pr-10"
                        disabled={vaLoading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowVaPassword(!showVaPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showVaPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {vaError && (
                    <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                      <XCircle className="w-4 h-4 flex-shrink-0" />
                      {vaError}
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={!vaEmail || !vaPassword || vaLoading}
                    className="w-full h-11 bg-gradient-primary font-semibold"
                  >
                    {vaLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        Sign In as VA
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </form>

                <div className="pt-4">
                  <p className="text-xs text-center text-muted-foreground">
                    VA access includes: Sales Portal, Booking Intake
                  </p>
                </div>
              </TabsContent>

              {/* Manager Login Tab */}
              <TabsContent value="manager" className="space-y-4">
                <div className="bg-accent/50 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-500 to-orange-500 flex items-center justify-center flex-shrink-0">
                      <Users className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <p className="font-medium text-sm">Manager / Admin Access</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Full access to all admin tools including dispatch and cleaner management
                      </p>
                    </div>
                  </div>
                </div>

                <form onSubmit={handleManagerLogin} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="manager-email">Email</Label>
                    <Input
                      id="manager-email"
                      type="email"
                      value={managerEmail}
                      onChange={(e) => setManagerEmail(e.target.value)}
                      placeholder="Enter your admin email"
                      className="h-11"
                      disabled={managerLoading}
                    />
                  </div>
                  
                  <div className="space-y-2">
                    <Label htmlFor="manager-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="manager-password"
                        type={showManagerPassword ? "text" : "password"}
                        value={managerPassword}
                        onChange={(e) => setManagerPassword(e.target.value)}
                        placeholder="Enter your password"
                        className="h-11 pr-10"
                        disabled={managerLoading}
                      />
                      <button
                        type="button"
                        onClick={() => setShowManagerPassword(!showManagerPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showManagerPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  {managerError && (
                    <div className="flex items-center gap-2 text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                      <XCircle className="w-4 h-4 flex-shrink-0" />
                      {managerError}
                    </div>
                  )}

                  <Button
                    type="submit"
                    disabled={!managerEmail || !managerPassword || managerLoading}
                    className="w-full h-11 bg-gradient-primary font-semibold"
                  >
                    {managerLoading ? (
                      <>
                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                        Signing in...
                      </>
                    ) : (
                      <>
                        Sign In as Manager
                        <ArrowRight className="w-4 h-4 ml-2" />
                      </>
                    )}
                  </Button>
                </form>

                <div className="pt-4 space-y-2">
                  <p className="text-xs text-center text-muted-foreground">
                    Manager access includes all features: Dispatch, Cleaners, Webhooks, and more
                  </p>
                  <div className="flex justify-center">
                    <Button 
                      variant="link" 
                      className="text-xs h-auto p-0"
                      onClick={() => navigate('/reset-password')}
                    >
                      Forgot password?
                    </Button>
                  </div>
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Access Level Comparison */}
        <Card className="mt-6 bg-muted/30 border-muted">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Access Levels</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-start gap-3">
              <Badge variant="secondary" className="bg-purple-100 text-purple-700 mt-0.5">VA</Badge>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">
                  VA Sales Portal, Booking Intake
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex items-start gap-3">
              <Badge variant="secondary" className="bg-amber-100 text-amber-700 mt-0.5">Manager</Badge>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground">
                  All VA features + Dispatch, Cleaner Management, Webhooks, Directory
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Footer */}
        <p className="text-xs text-center text-muted-foreground mt-6">
          Need help? Contact support@novaracleaning.com
        </p>
      </div>
    </div>
  );
}
