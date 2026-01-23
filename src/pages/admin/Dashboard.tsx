import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Headphones, Phone, Users, Truck, FileText, Settings, 
  Lock, ArrowRight, Shield, Webhook, UserCheck, XCircle,
  LayoutDashboard
} from "lucide-react";
import { cn } from "@/lib/utils";

// Admin credentials for quick access tools
const ADMIN_EMAIL = "contact@novaracleaning.com";
const ADMIN_PASSWORD = "Divine74!";

interface AdminTool {
  id: string;
  title: string;
  description: string;
  icon: React.ElementType;
  path: string;
  color: string;
  requiresSupabaseAuth: boolean;
  badge?: string;
}

const ADMIN_TOOLS: AdminTool[] = [
  {
    id: "va-sales",
    title: "VA Sales Portal",
    description: "Phone sales form for VAs with lead scoring, objection handling, and quick booking",
    icon: Headphones,
    path: "/admin/va-sales",
    color: "from-purple-500 to-pink-500",
    requiresSupabaseAuth: false,
    badge: "New",
  },
  {
    id: "intake",
    title: "Booking Intake",
    description: "Create bookings manually with full customer and service details",
    icon: Phone,
    path: "/admin/intake",
    color: "from-blue-500 to-cyan-500",
    requiresSupabaseAuth: false,
  },
  {
    id: "dispatch",
    title: "Dispatch Queue",
    description: "View and manage all bookings, assign cleaners, and track job status",
    icon: Truck,
    path: "/admin/dispatch",
    color: "from-green-500 to-emerald-500",
    requiresSupabaseAuth: true,
  },
  {
    id: "cleaners",
    title: "Cleaner Management",
    description: "Manage cleaner profiles, approvals, and performance metrics",
    icon: Users,
    path: "/admin/cleaners",
    color: "from-amber-500 to-orange-500",
    requiresSupabaseAuth: true,
  },
  {
    id: "directory",
    title: "Cleaner Directory",
    description: "Browse and search all cleaners with contact information",
    icon: UserCheck,
    path: "/admin/directory",
    color: "from-teal-500 to-green-500",
    requiresSupabaseAuth: true,
  },
  {
    id: "webhooks",
    title: "Webhook Monitor",
    description: "Monitor webhook deliveries and troubleshoot integration issues",
    icon: Webhook,
    path: "/admin/webhooks",
    color: "from-red-500 to-pink-500",
    requiresSupabaseAuth: true,
  },
  {
    id: "webhook-tester",
    title: "Webhook Tester",
    description: "Test webhook endpoints and simulate booking events",
    icon: Settings,
    path: "/admin/webhook-tester",
    color: "from-indigo-500 to-purple-500",
    requiresSupabaseAuth: true,
  },
];

export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showQuickLogin, setShowQuickLogin] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [isAuthenticated, setIsAuthenticated] = useState(() => {
    return sessionStorage.getItem("admin_dashboard_access") === "true";
  });

  const handleQuickLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    
    const emailMatch = adminEmail.trim().toLowerCase() === ADMIN_EMAIL.toLowerCase();
    const passwordMatch = adminPassword === ADMIN_PASSWORD;
    
    if (emailMatch && passwordMatch) {
      sessionStorage.setItem("admin_dashboard_access", "true");
      // Also set access for VA Sales and Intake
      sessionStorage.setItem("va_sales_access", "true");
      sessionStorage.setItem("intake_access", "true");
      setIsAuthenticated(true);
    } else {
      setLoginError("Invalid email or password.");
    }
  };

  const handleToolClick = (tool: AdminTool) => {
    if (tool.requiresSupabaseAuth && !user) {
      // Redirect to auth page, then back to the tool
      navigate(`/auth?redirect=${tool.path}`);
    } else {
      navigate(tool.path);
    }
  };

  // Show login screen if not authenticated
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center p-4">
        <Card className="w-full max-w-md shadow-card border-primary/20">
          <CardContent className="pt-8 pb-8">
            <div className="flex flex-col items-center space-y-6">
              <div className="w-20 h-20 rounded-full bg-gradient-primary flex items-center justify-center shadow-lg">
                <Shield className="w-10 h-10 text-white" />
              </div>
              
              <div className="text-center">
                <h1 className="text-2xl font-bold text-foreground mb-2 font-jakarta">
                  Novara Admin Portal
                </h1>
                <p className="text-sm text-muted-foreground">
                  Sign in to access admin tools
                </p>
              </div>

              <form onSubmit={handleQuickLogin} className="w-full space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="admin-email">Email</Label>
                  <Input
                    id="admin-email"
                    type="email"
                    value={adminEmail}
                    onChange={(e) => setAdminEmail(e.target.value)}
                    placeholder="contact@novaracleaning.com"
                    className="h-12"
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-password">Password</Label>
                  <Input
                    id="admin-password"
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    placeholder="Enter password"
                    className="h-12"
                  />
                </div>

                {loginError && (
                  <p className="text-sm text-destructive flex items-center gap-2">
                    <XCircle className="w-4 h-4" />
                    {loginError}
                  </p>
                )}

                <Button
                  type="submit"
                  disabled={!adminEmail || !adminPassword}
                  className="w-full bg-gradient-primary font-semibold"
                  size="lg"
                >
                  <Lock className="w-5 h-5 mr-2" />
                  Sign In
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-hero">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur-sm">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gradient-primary flex items-center justify-center">
                <LayoutDashboard className="w-5 h-5 text-white" />
              </div>
              <div>
                <h1 className="text-xl font-bold font-jakarta">Novara Admin</h1>
                <p className="text-xs text-muted-foreground">Management Dashboard</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {user ? (
                <Badge variant="secondary" className="bg-green-100 text-green-700">
                  <Shield className="w-3 h-3 mr-1" />
                  Logged in as Admin
                </Badge>
              ) : (
                <Button variant="outline" size="sm" onClick={() => navigate('/auth')}>
                  <Lock className="w-4 h-4 mr-2" />
                  Sign in for Full Access
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="container mx-auto px-4 py-8">
        {/* Quick Access Tools */}
        <div className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Quick Access Tools</h2>
          <p className="text-sm text-muted-foreground mb-6">
            These tools are available with your admin PIN or email login
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {ADMIN_TOOLS.filter(t => !t.requiresSupabaseAuth).map((tool) => {
              const Icon = tool.icon;
              return (
                <Card 
                  key={tool.id}
                  className="cursor-pointer hover:shadow-lg transition-all hover:border-primary/50 group"
                  onClick={() => handleToolClick(tool)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0",
                        tool.color
                      )}>
                        <Icon className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h3 className="font-semibold group-hover:text-primary transition-colors">
                            {tool.title}
                          </h3>
                          {tool.badge && (
                            <Badge className="bg-gradient-primary text-white text-xs">
                              {tool.badge}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {tool.description}
                        </p>
                      </div>
                      <ArrowRight className="w-5 h-5 text-muted-foreground group-hover:text-primary transition-colors flex-shrink-0" />
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>

        <Separator className="my-8" />

        {/* Full Admin Tools */}
        <div>
          <h2 className="text-lg font-semibold mb-4">Full Admin Tools</h2>
          <p className="text-sm text-muted-foreground mb-6">
            These tools require full admin authentication via Supabase
            {!user && (
              <Button variant="link" className="p-0 h-auto ml-1" onClick={() => navigate('/auth')}>
                Sign in here
              </Button>
            )}
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {ADMIN_TOOLS.filter(t => t.requiresSupabaseAuth).map((tool) => {
              const Icon = tool.icon;
              const isLocked = !user;
              return (
                <Card 
                  key={tool.id}
                  className={cn(
                    "cursor-pointer transition-all group",
                    isLocked 
                      ? "opacity-60 hover:opacity-80" 
                      : "hover:shadow-lg hover:border-primary/50"
                  )}
                  onClick={() => handleToolClick(tool)}
                >
                  <CardContent className="p-6">
                    <div className="flex items-start gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-lg bg-gradient-to-br flex items-center justify-center flex-shrink-0 relative",
                        tool.color
                      )}>
                        <Icon className="w-6 h-6 text-white" />
                        {isLocked && (
                          <div className="absolute -top-1 -right-1 w-5 h-5 bg-muted rounded-full flex items-center justify-center border-2 border-background">
                            <Lock className="w-3 h-3 text-muted-foreground" />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className={cn(
                          "font-semibold mb-1 transition-colors",
                          !isLocked && "group-hover:text-primary"
                        )}>
                          {tool.title}
                        </h3>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {tool.description}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
