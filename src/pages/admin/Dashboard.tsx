import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { 
  Headphones, Phone, Users, Truck, Settings, 
  Lock, ArrowRight, Shield, Webhook, UserCheck,
  LayoutDashboard, LogOut
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  
  // Check for session storage authentication (VA/Quick login)
  const isQuickAuthenticated = sessionStorage.getItem("admin_dashboard_access") === "true";

  // Redirect to auth if not authenticated at all
  useEffect(() => {
    if (!isQuickAuthenticated) {
      navigate('/admin/auth', { replace: true });
    }
  }, [isQuickAuthenticated, navigate]);

  const handleToolClick = (tool: AdminTool) => {
    if (tool.requiresSupabaseAuth && !user) {
      // Redirect to admin auth page with manager tab, then back to the tool
      navigate(`/admin/auth?redirect=${tool.path}`);
    } else {
      navigate(tool.path);
    }
  };

  const handleLogout = () => {
    sessionStorage.removeItem("admin_dashboard_access");
    sessionStorage.removeItem("va_sales_access");
    sessionStorage.removeItem("intake_access");
    navigate('/admin/auth', { replace: true });
  };

  if (!isQuickAuthenticated) {
    return null;
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
                  Manager Access
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-purple-100 text-purple-700">
                  <Headphones className="w-3 h-3 mr-1" />
                  VA Access
                </Badge>
              )}
              <Button variant="ghost" size="sm" onClick={handleLogout}>
                <LogOut className="w-4 h-4 mr-2" />
                Sign Out
              </Button>
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
            Available with your current login
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
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Full Admin Tools</h2>
            {!user && (
              <Button 
                variant="outline" 
                size="sm" 
                onClick={() => navigate('/admin/auth?redirect=/admin')}
              >
                <Lock className="w-4 h-4 mr-2" />
                Sign in as Manager
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            {user 
              ? "You have full access to all admin tools" 
              : "These tools require Manager/Admin authentication"
            }
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
