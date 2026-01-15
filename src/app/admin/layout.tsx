"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sparkles,
  LayoutDashboard,
  Users,
  Calendar,
  Truck,
  Crown,
  CreditCard,
  BarChart3,
  MessageSquare,
  ClipboardList,
  Settings,
  LogOut,
  ChevronDown,
  ChevronRight,
  Menu,
  X,
  Bell,
  Search,
  Moon,
  Sun,
} from "lucide-react";
import { cn } from "@/lib/utils";

const navigation = [
  {
    name: "Dashboard",
    href: "/admin",
    icon: LayoutDashboard,
  },
  {
    name: "Users",
    icon: Users,
    children: [
      { name: "Overview", href: "/admin/users" },
      { name: "Customers", href: "/admin/users/customers" },
      { name: "Cleaners", href: "/admin/users/cleaners" },
      { name: "Admins", href: "/admin/users/admins" },
    ],
  },
  {
    name: "Bookings",
    icon: Calendar,
    children: [
      { name: "All Bookings", href: "/admin/bookings" },
      { name: "New Intake", href: "/admin/bookings/intake" },
    ],
  },
  {
    name: "Dispatch",
    icon: Truck,
    children: [
      { name: "Queue", href: "/admin/dispatch" },
      { name: "Calendar", href: "/admin/dispatch/calendar" },
    ],
  },
  {
    name: "Memberships",
    icon: Crown,
    children: [
      { name: "Active", href: "/admin/memberships" },
      { name: "Credits", href: "/admin/memberships/credits" },
    ],
  },
  {
    name: "Payments",
    icon: CreditCard,
    children: [
      { name: "Overview", href: "/admin/payments" },
      { name: "Payouts", href: "/admin/payments/payouts" },
      { name: "Refunds", href: "/admin/payments/refunds" },
    ],
  },
  {
    name: "Metrics",
    icon: BarChart3,
    children: [
      { name: "Dashboard", href: "/admin/metrics" },
      { name: "Customers", href: "/admin/metrics/customers" },
      { name: "Cleaners", href: "/admin/metrics/cleaners" },
      { name: "Revenue", href: "/admin/metrics/revenue" },
      { name: "Operations", href: "/admin/metrics/operations" },
      { name: "Exports", href: "/admin/metrics/exports" },
    ],
  },
  {
    name: "Communications",
    href: "/admin/communications",
    icon: MessageSquare,
  },
  {
    name: "Audit Log",
    href: "/admin/audit",
    icon: ClipboardList,
  },
  {
    name: "Settings",
    icon: Settings,
    children: [
      { name: "General", href: "/admin/settings" },
      { name: "Pricing", href: "/admin/settings/pricing" },
      { name: "Zones", href: "/admin/settings/zones" },
      { name: "Promos", href: "/admin/settings/promos" },
      { name: "Webhooks", href: "/admin/settings/webhooks" },
    ],
  },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [user, setUser] = useState<any>(null);
  const [isDark, setIsDark] = useState(false);

  // Don't apply layout to login/auth pages
  const isAuthPage = pathname?.includes("/login") || pathname?.includes("/unauthorized");

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => {
      setUser(session?.user);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    // Auto-expand parent items based on current path
    navigation.forEach((item) => {
      if (item.children?.some((child) => pathname?.startsWith(child.href))) {
        setExpandedItems((prev) =>
          prev.includes(item.name) ? prev : [...prev, item.name]
        );
      }
    });
  }, [pathname]);

  const toggleExpand = (name: string) => {
    setExpandedItems((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/admin/login");
  };

  if (isAuthPage) {
    return <>{children}</>;
  }

  const NavItem = ({ item }: { item: typeof navigation[0] }) => {
    const isExpanded = expandedItems.includes(item.name);
    const isActive = item.href ? pathname === item.href : item.children?.some((c) => pathname?.startsWith(c.href));
    const Icon = item.icon;

    if (item.children) {
      return (
        <div>
          <button
            onClick={() => toggleExpand(item.name)}
            className={cn(
              "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
              isActive
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Icon className="h-5 w-5 flex-shrink-0" />
            <span className="flex-1 text-left">{item.name}</span>
            <ChevronRight
              className={cn("h-4 w-4 transition-transform", isExpanded && "rotate-90")}
            />
          </button>
          {isExpanded && (
            <div className="ml-8 mt-1 space-y-1">
              {item.children.map((child) => (
                <Link
                  key={child.href}
                  href={child.href}
                  onClick={() => setSidebarOpen(false)}
                  className={cn(
                    "block px-3 py-1.5 rounded-lg text-sm transition-colors",
                    pathname === child.href
                      ? "bg-primary/10 text-primary font-medium"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {child.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      );
    }

    return (
      <Link
        href={item.href!}
        onClick={() => setSidebarOpen(false)}
        className={cn(
          "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors",
          isActive
            ? "bg-primary/10 text-primary"
            : "text-muted-foreground hover:bg-muted hover:text-foreground"
        )}
      >
        <Icon className="h-5 w-5 flex-shrink-0" />
        <span>{item.name}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed top-0 left-0 z-50 h-full w-64 bg-card border-r transition-transform lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex flex-col h-full">
          {/* Logo */}
          <div className="flex items-center gap-2 px-4 py-4 border-b">
            <Sparkles className="h-8 w-8 text-primary" />
            <div>
              <span className="font-bold text-lg">NovaraCleaning</span>
              <span className="text-xs text-muted-foreground block">Admin Portal</span>
            </div>
          </div>

          {/* Navigation */}
          <ScrollArea className="flex-1 px-3 py-4">
            <nav className="space-y-1">
              {navigation.map((item) => (
                <NavItem key={item.name} item={item} />
              ))}
            </nav>
          </ScrollArea>
        </div>
      </aside>

      {/* Main content */}
      <div className="lg:pl-64">
        {/* Top header */}
        <header className="sticky top-0 z-30 flex items-center justify-between h-16 px-4 border-b bg-background/95 backdrop-blur">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden"
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </Button>

            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-muted rounded-lg">
              <Search className="h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search... (⌘K)"
                className="bg-transparent border-none outline-none text-sm w-48"
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsDark(!isDark)}
            >
              {isDark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>

            <Button variant="ghost" size="icon" className="relative">
              <Bell className="h-5 w-5" />
              <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full" />
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback>
                      {user?.email?.slice(0, 2).toUpperCase() || "AD"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="hidden md:inline text-sm">
                    {user?.email?.split("@")[0] || "Admin"}
                  </span>
                  <ChevronDown className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>My Account</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/admin/settings">
                    <Settings className="mr-2 h-4 w-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {/* Page content */}
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
