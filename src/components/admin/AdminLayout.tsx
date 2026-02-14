import { ReactNode } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { NavLink } from "@/components/NavLink";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  SidebarFooter,
} from "@/components/ui/sidebar";
import {
  LayoutDashboard,
  CalendarCheck,
  Users,
  HardHat,
  MapPin,
  Truck,
  ClipboardPlus,
  Webhook,
  LogOut,
  Shield,
  Headset,
  BarChart3,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

const navItems = [
  { title: "Dashboard", url: "/admin/dashboard", icon: LayoutDashboard },
  { title: "Bookings", url: "/admin/bookings", icon: CalendarCheck },
  { title: "Customers", url: "/admin/customers", icon: Users },
  { title: "Cleaners", url: "/admin/cleaners", icon: HardHat },
  { title: "Directory", url: "/admin/directory", icon: MapPin },
  { title: "Dispatch", url: "/admin/dispatch", icon: Truck },
  { title: "Pipeline", url: "/admin/pipeline", icon: BarChart3 },
  { title: "Webhooks", url: "/admin/webhooks", icon: Webhook },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { user } = useAuth();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate("/admin/auth");
  };

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-slate-950">
        <Sidebar className="border-r border-white/10 bg-slate-900">
          <div className="p-4 flex items-center gap-2 border-b border-white/10">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold text-white">Novara Admin</span>
          </div>

          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel className="text-slate-500 text-xs uppercase tracking-wider">
                Navigation
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg text-slate-400 hover:text-white hover:bg-white/5 transition-colors"
                          activeClassName="bg-amber-500/10 text-amber-400 font-medium"
                        >
                          <item.icon className="h-4 w-4 shrink-0" />
                          <span>{item.title}</span>
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>

          <SidebarFooter className="border-t border-white/10 p-4">
            <p className="text-xs text-slate-500 truncate mb-2">
              {user?.email}
            </p>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start text-slate-400 hover:text-white hover:bg-white/5"
              onClick={handleSignOut}
            >
              <LogOut className="h-4 w-4 mr-2" />
              Sign Out
            </Button>
          </SidebarFooter>
        </Sidebar>

        <main className="flex-1 overflow-auto">
          <header className="h-14 border-b border-white/10 flex items-center px-4 bg-slate-900/50 backdrop-blur-sm sticky top-0 z-10">
            <SidebarTrigger className="text-slate-400 hover:text-white" />
          </header>
          <div className="p-6">{children}</div>
        </main>
      </div>
    </SidebarProvider>
  );
}
