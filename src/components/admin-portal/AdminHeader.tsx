"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  Bell,
  Search,
  Command,
  Settings,
  LogOut,
  User,
  Moon,
  Sun,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Separator } from "@/components/ui/separator";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { useAuth } from "@/contexts/AuthContext";

const quickActions = [
  { title: "Dashboard", url: "/portal", group: "Navigation" },
  { title: "All Bookings", url: "/portal/bookings", group: "Navigation" },
  { title: "New Booking", url: "/portal/bookings/intake", group: "Actions" },
  { title: "Customers", url: "/portal/customers", group: "Navigation" },
  { title: "Cleaners", url: "/portal/cleaners", group: "Navigation" },
  { title: "Dispatch Queue", url: "/portal/dispatch", group: "Navigation" },
  { title: "Payments", url: "/portal/payments", group: "Navigation" },
  { title: "Reports", url: "/portal/reports", group: "Navigation" },
  { title: "Settings", url: "/portal/settings", group: "Settings" },
  { title: "Pricing", url: "/portal/settings/pricing", group: "Settings" },
  { title: "Promo Codes", url: "/portal/settings/promos", group: "Settings" },
];

const pathTitles: Record<string, string> = {
  "/portal": "Dashboard",
  "/portal/bookings": "Bookings",
  "/portal/bookings/intake": "Manual Intake",
  "/portal/customers": "Customers",
  "/portal/cleaners": "Cleaners",
  "/portal/cleaners/onboarding": "Onboarding",
  "/portal/dispatch": "Dispatch Queue",
  "/portal/dispatch/calendar": "Calendar",
  "/portal/memberships": "Memberships",
  "/portal/memberships/credits": "Credit Management",
  "/portal/payments": "Payments",
  "/portal/payments/payouts": "Cleaner Payouts",
  "/portal/payments/refunds": "Refunds",
  "/portal/communications": "Communications",
  "/portal/communications/sms": "SMS Logs",
  "/portal/communications/emails": "Email Logs",
  "/portal/reports": "Reports",
  "/portal/reports/revenue": "Revenue",
  "/portal/reports/operations": "Operations",
  "/portal/settings": "Settings",
  "/portal/settings/pricing": "Pricing",
  "/portal/settings/zones": "Service Zones",
  "/portal/settings/promos": "Promo Codes",
  "/portal/settings/webhooks": "Webhooks",
};

export function AdminHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { signOut } = useAuth();
  const [commandOpen, setCommandOpen] = useState(false);

  const getBreadcrumbs = () => {
    const segments = pathname.split("/").filter(Boolean);
    const breadcrumbs: { title: string; url: string }[] = [];

    let currentPath = "";
    for (const segment of segments) {
      currentPath += `/${segment}`;
      const title = pathTitles[currentPath] || segment.charAt(0).toUpperCase() + segment.slice(1);
      breadcrumbs.push({ title, url: currentPath });
    }

    return breadcrumbs;
  };

  const breadcrumbs = getBreadcrumbs();

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mr-2 h-4" />
        
        <Breadcrumb className="hidden md:flex">
          <BreadcrumbList>
            {breadcrumbs.map((crumb, index) => (
              <BreadcrumbItem key={crumb.url}>
                {index === breadcrumbs.length - 1 ? (
                  <BreadcrumbPage>{crumb.title}</BreadcrumbPage>
                ) : (
                  <>
                    <BreadcrumbLink href={crumb.url}>{crumb.title}</BreadcrumbLink>
                    <BreadcrumbSeparator />
                  </>
                )}
              </BreadcrumbItem>
            ))}
          </BreadcrumbList>
        </Breadcrumb>

        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="hidden w-64 justify-start gap-2 text-muted-foreground md:flex"
            onClick={() => setCommandOpen(true)}
          >
            <Search className="size-4" />
            <span>Search...</span>
            <kbd className="pointer-events-none ml-auto hidden h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium opacity-100 sm:flex">
              <span className="text-xs">⌘</span>K
            </kbd>
          </Button>

          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setCommandOpen(true)}>
            <Search className="size-4" />
          </Button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="relative">
                <Bell className="size-4" />
                <Badge className="absolute -right-1 -top-1 h-5 w-5 rounded-full p-0 text-xs">
                  3
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-80">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">New booking created</span>
                  <span className="text-xs text-muted-foreground">2 minutes ago</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">Cleaner declined job</span>
                  <span className="text-xs text-muted-foreground">15 minutes ago</span>
                </div>
              </DropdownMenuItem>
              <DropdownMenuItem>
                <div className="flex flex-col gap-1">
                  <span className="font-medium">Payment received</span>
                  <span className="text-xs text-muted-foreground">1 hour ago</span>
                </div>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <CommandDialog open={commandOpen} onOpenChange={setCommandOpen}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            {quickActions
              .filter((action) => action.group === "Navigation")
              .map((action) => (
                <CommandItem
                  key={action.url}
                  onSelect={() => {
                    router.push(action.url);
                    setCommandOpen(false);
                  }}
                >
                  {action.title}
                </CommandItem>
              ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Actions">
            {quickActions
              .filter((action) => action.group === "Actions")
              .map((action) => (
                <CommandItem
                  key={action.url}
                  onSelect={() => {
                    router.push(action.url);
                    setCommandOpen(false);
                  }}
                >
                  {action.title}
                </CommandItem>
              ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Settings">
            {quickActions
              .filter((action) => action.group === "Settings")
              .map((action) => (
                <CommandItem
                  key={action.url}
                  onSelect={() => {
                    router.push(action.url);
                    setCommandOpen(false);
                  }}
                >
                  {action.title}
                </CommandItem>
              ))}
          </CommandGroup>
        </CommandList>
      </CommandDialog>
    </>
  );
}
