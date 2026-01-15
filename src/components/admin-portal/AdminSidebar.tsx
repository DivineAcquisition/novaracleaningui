"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Calendar,
  Users,
  UserCog,
  Truck,
  CreditCard,
  MessageSquare,
  BarChart3,
  Settings,
  CalendarDays,
  BookOpen,
  DollarSign,
  Receipt,
  Mail,
  MessageCircle,
  TrendingUp,
  Activity,
  Cog,
  Tag,
  MapPin,
  Webhook,
  Crown,
  ChevronDown,
  LogOut,
  Sparkles,
  Shield,
  UserPlus,
  Key,
  PieChart,
  FileSpreadsheet,
  ClipboardList,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

const navigation = [
  {
    title: "Dashboard",
    url: "/portal",
    icon: LayoutDashboard,
  },
  {
    title: "Bookings",
    icon: Calendar,
    items: [
      { title: "All Bookings", url: "/portal/bookings" },
      { title: "Manual Intake", url: "/portal/bookings/intake" },
    ],
  },
  {
    title: "User Management",
    icon: Users,
    items: [
      { title: "Overview", url: "/portal/users" },
      { title: "Customers", url: "/portal/users/customers" },
      { title: "Cleaners", url: "/portal/users/cleaners" },
      { title: "Admins", url: "/portal/users/admins" },
      { title: "Roles", url: "/portal/users/roles" },
    ],
  },
  {
    title: "Dispatch",
    icon: Truck,
    items: [
      { title: "Queue", url: "/portal/dispatch" },
      { title: "Calendar", url: "/portal/dispatch/calendar" },
    ],
  },
  {
    title: "Memberships",
    icon: Crown,
    items: [
      { title: "Active Members", url: "/portal/memberships" },
      { title: "Credit Management", url: "/portal/memberships/credits" },
    ],
  },
  {
    title: "Payments",
    icon: CreditCard,
    items: [
      { title: "Overview", url: "/portal/payments" },
      { title: "Cleaner Payouts", url: "/portal/payments/payouts" },
      { title: "Refunds", url: "/portal/payments/refunds" },
    ],
  },
  {
    title: "Communications",
    icon: MessageSquare,
    items: [
      { title: "Message Center", url: "/portal/communications" },
      { title: "SMS Logs", url: "/portal/communications/sms" },
      { title: "Email Logs", url: "/portal/communications/emails" },
    ],
  },
  {
    title: "Metrics",
    icon: PieChart,
    items: [
      { title: "Dashboard", url: "/portal/metrics" },
      { title: "Customer Metrics", url: "/portal/metrics/customers" },
      { title: "Cleaner Metrics", url: "/portal/metrics/cleaners" },
      { title: "Revenue Analytics", url: "/portal/metrics/revenue" },
      { title: "Operations", url: "/portal/metrics/operations" },
      { title: "Data Exports", url: "/portal/metrics/exports" },
    ],
  },
  {
    title: "Audit Log",
    url: "/portal/audit",
    icon: ClipboardList,
  },
  {
    title: "Settings",
    icon: Settings,
    items: [
      { title: "General", url: "/portal/settings" },
      { title: "Pricing", url: "/portal/settings/pricing" },
      { title: "Service Zones", url: "/portal/settings/zones" },
      { title: "Promo Codes", url: "/portal/settings/promos" },
      { title: "Webhooks", url: "/portal/settings/webhooks" },
    ],
  },
];

export function AdminSidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  const handleSignOut = async () => {
    await signOut();
    window.location.href = "/portal/login";
  };

  return (
    <Sidebar variant="inset" collapsible="icon">
      <SidebarHeader className="border-b border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/portal">
                <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Sparkles className="size-4" />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">NovaraCleaning</span>
                  <span className="truncate text-xs text-muted-foreground">Admin Portal</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) =>
                item.items ? (
                  <Collapsible
                    key={item.title}
                    asChild
                    defaultOpen={item.items.some((subItem) =>
                      pathname.startsWith(subItem.url)
                    )}
                  >
                    <SidebarMenuItem>
                      <CollapsibleTrigger asChild>
                        <SidebarMenuButton
                          tooltip={item.title}
                          isActive={item.items.some((subItem) =>
                            pathname.startsWith(subItem.url)
                          )}
                        >
                          <item.icon className="size-4" />
                          <span>{item.title}</span>
                          <ChevronDown className="ml-auto size-4 transition-transform duration-200 group-data-[state=open]/collapsible:rotate-180" />
                        </SidebarMenuButton>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <SidebarMenuSub>
                          {item.items.map((subItem) => (
                            <SidebarMenuSubItem key={subItem.title}>
                              <SidebarMenuSubButton
                                asChild
                                isActive={pathname === subItem.url}
                              >
                                <Link href={subItem.url}>
                                  <span>{subItem.title}</span>
                                </Link>
                              </SidebarMenuSubButton>
                            </SidebarMenuSubItem>
                          ))}
                        </SidebarMenuSub>
                      </CollapsibleContent>
                    </SidebarMenuItem>
                  </Collapsible>
                ) : (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      tooltip={item.title}
                      isActive={pathname === item.url}
                    >
                      <Link href={item.url}>
                        <item.icon className="size-4" />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="border-t border-sidebar-border">
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <Avatar className="h-8 w-8 rounded-lg">
                    <AvatarImage
                      src={user?.user_metadata?.avatar_url}
                      alt={user?.email || "User"}
                    />
                    <AvatarFallback className="rounded-lg">
                      {user?.email?.slice(0, 2).toUpperCase() || "AD"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-semibold">
                      {user?.user_metadata?.full_name || "Admin User"}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user?.email}
                    </span>
                  </div>
                  <ChevronDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
                side="bottom"
                align="end"
                sideOffset={4}
              >
                <DropdownMenuItem asChild>
                  <Link href="/portal/settings">
                    <Settings className="mr-2 size-4" />
                    Settings
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOut className="mr-2 size-4" />
                  Log out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
