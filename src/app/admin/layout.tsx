"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Input } from "@/components/ui/input";
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
  ChevronRight,
  Menu,
  Bell,
  Search,
  Command,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Toaster } from "sonner";

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

function SidebarNav({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const [expandedItems, setExpandedItems] = useState<string[]>([]);

  useEffect(() => {
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

  return (
    <nav className="space-y-1 px-2">
      {navigation.map((item) => {
        const isExpanded = expandedItems.includes(item.name);
        const isActive = item.href
          ? pathname === item.href
          : item.children?.some((c) => pathname?.startsWith(c.href));
        const Icon = item.icon;

        if (item.children) {
          return (
            <Collapsible
              key={item.name}
              open={isExpanded}
              onOpenChange={() => toggleExpand(item.name)}
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant={isActive ? "secondary" : "ghost"}
                  className={cn(
                    "w-full justify-start",
                    isActive && "bg-secondary"
                  )}
                >
                  <Icon className="mr-2 h-4 w-4" />
                  {item.name}
                  <ChevronRight
                    className={cn(
                      "ml-auto h-4 w-4 transition-transform",
                      isExpanded && "rotate-90"
                    )}
                  />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-6 pt-1 space-y-1">
                {item.children.map((child) => (
                  <Button
                    key={child.href}
                    variant={pathname === child.href ? "secondary" : "ghost"}
                    className="w-full justify-start h-8 text-sm"
                    asChild
                    onClick={onNavigate}
                  >
                    <Link href={child.href}>{child.name}</Link>
                  </Button>
                ))}
              </CollapsibleContent>
            </Collapsible>
          );
        }

        return (
          <Button
            key={item.name}
            variant={isActive ? "secondary" : "ghost"}
            className="w-full justify-start"
            asChild
            onClick={onNavigate}
          >
            <Link href={item.href!}>
              <Icon className="mr-2 h-4 w-4" />
              {item.name}
            </Link>
          </Button>
        );
      })}
    </nav>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [sheetOpen, setSheetOpen] = useState(false);

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

  const handleLogout = async () => {
    await supabase.auth.signOut();
    router.push("/admin/login");
  };

  if (isAuthPage) {
    return (
      <>
        {children}
        <Toaster position="top-center" richColors />
      </>
    );
  }

  const userInitials = user?.email?.slice(0, 2).toUpperCase() || "AD";
  const userName = user?.email?.split("@")[0] || "Admin";

  return (
    <TooltipProvider>
      <div className="flex min-h-screen">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex lg:w-64 lg:flex-col lg:fixed lg:inset-y-0 border-r bg-card">
          <div className="flex h-14 items-center gap-2 border-b px-4">
            <Sparkles className="h-6 w-6 text-primary" />
            <div className="flex flex-col">
              <span className="font-semibold text-sm">NovaraCleaning</span>
              <span className="text-[10px] text-muted-foreground">Admin Portal</span>
            </div>
          </div>
          <ScrollArea className="flex-1 py-4">
            <SidebarNav />
          </ScrollArea>
        </aside>

        {/* Main Content */}
        <div className="flex flex-1 flex-col lg:pl-64">
          {/* Header */}
          <header className="sticky top-0 z-40 flex h-14 items-center gap-4 border-b bg-background px-4 lg:px-6">
            {/* Mobile Menu */}
            <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="lg:hidden">
                  <Menu className="h-5 w-5" />
                  <span className="sr-only">Toggle menu</span>
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-64 p-0">
                <div className="flex h-14 items-center gap-2 border-b px-4">
                  <Sparkles className="h-6 w-6 text-primary" />
                  <span className="font-semibold">NovaraCleaning</span>
                </div>
                <ScrollArea className="h-[calc(100vh-3.5rem)] py-4">
                  <SidebarNav onNavigate={() => setSheetOpen(false)} />
                </ScrollArea>
              </SheetContent>
            </Sheet>

            {/* Search */}
            <div className="hidden md:flex flex-1 max-w-md">
              <div className="relative w-full">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Search..."
                  className="pl-8 bg-muted/50"
                />
                <kbd className="pointer-events-none absolute right-2.5 top-2.5 hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
                  <Command className="h-3 w-3" />K
                </kbd>
              </div>
            </div>

            <div className="flex-1 lg:flex-none" />

            {/* Notifications */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="relative">
                  <Bell className="h-5 w-5" />
                  <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-destructive" />
                  <span className="sr-only">Notifications</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Notifications</TooltipContent>
            </Tooltip>

            {/* User Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2 px-2">
                  <Avatar className="h-7 w-7">
                    <AvatarFallback className="text-xs">{userInitials}</AvatarFallback>
                  </Avatar>
                  <span className="hidden md:inline text-sm font-medium">{userName}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium">{userName}</p>
                    <p className="text-xs text-muted-foreground">{user?.email}</p>
                  </div>
                </DropdownMenuLabel>
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
          </header>

          {/* Page Content */}
          <main className="flex-1 p-4 lg:p-6">
            {children}
          </main>
        </div>
      </div>
      <Toaster position="top-center" richColors />
    </TooltipProvider>
  );
}
