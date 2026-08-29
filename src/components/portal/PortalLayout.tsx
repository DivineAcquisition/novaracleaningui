"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/contexts/AuthContext";
import { useMembershipCredits } from "@/hooks/use-membership-credits";
import { BrandAtmosphere } from "@/components/brand/atmosphere";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  RiDashboardLine,
  RiCalendarCheckLine,
  RiVipCrownLine,
  RiSettings3Line,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiCloseLine,
  RiCoupon3Line,
  RiHomeLine,
  RiArrowRightLine,
} from "@remixicon/react";

const logo = "/novara-logo.png";

interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string;
}

function SidebarContent({
  navItems,
  pathname,
  userName,
  userEmail,
  userInitials,
  onSignOut,
  onClose,
}: {
  navItems: NavItem[];
  pathname: string;
  userName: string;
  userEmail: string;
  userInitials: string;
  onSignOut: () => void;
  onClose?: () => void;
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Brand */}
      <div className="px-5 pt-6 pb-4">
        <Link href="/" className="flex items-center gap-2.5 group" onClick={onClose}>
          <img
            src={logo}
            alt="Novara"
            className="w-9 h-9 rounded-xl shadow-sm transition-transform group-hover:scale-105"
          />
          <div>
            <span className="text-base font-bold tracking-tight block leading-tight">
              Novara
            </span>
            <span className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
              Control Center
            </span>
          </div>
        </Link>
      </div>

      <Separator className="mx-4 w-auto" />

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        {navItems.map((item) => {
          const isActive =
            pathname === item.href ||
            (item.href !== "/account" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-150",
                isActive
                  ? "bg-brand-50 text-primary shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
              )}
            >
              <item.icon
                className={cn(
                  "w-[18px] h-[18px] flex-shrink-0",
                  isActive ? "text-primary" : ""
                )}
              />
              <span className="flex-1">{item.label}</span>
              {item.badge && (
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px] h-5 px-1.5 font-semibold",
                    isActive
                      ? "bg-primary/15 text-primary border-primary/20"
                      : ""
                  )}
                >
                  {item.badge}
                </Badge>
              )}
            </Link>
          );
        })}

        <div className="pt-2">
          <Separator className="mb-3" />
          <Link
            href="/portal/book"
            onClick={onClose}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium bg-gradient-primary text-white shadow-md hover:shadow-lg transition-shadow"
          >
            <RiCalendarCheckLine className="w-[18px] h-[18px]" />
            <span className="flex-1">Book a Cleaning</span>
            <RiArrowRightLine className="w-4 h-4 opacity-70" />
          </Link>
        </div>
      </nav>

      {/* User Footer */}
      <div className="mt-auto border-t border-border/50 px-4 py-4">
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center text-xs font-bold text-primary-foreground flex-shrink-0"
            style={{ background: "var(--gradient-primary)" }}
          >
            {userInitials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate leading-tight">
              {userName}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {userEmail}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-muted-foreground hover:text-destructive flex-shrink-0"
            onClick={onSignOut}
          >
            <RiLogoutBoxRLine className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { credits, hasCredits } = useMembershipCredits();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  const userName =
    user?.user_metadata?.full_name ||
    user?.email
      ?.split("@")[0]
      ?.replace(/[._]/g, " ")
      .replace(/\b\w/g, (l: string) => l.toUpperCase()) ||
    "User";
  const userEmail = user?.email || "";
  const userInitials = userName
    .split(" ")
    .map((n: string) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);

  const navItems: NavItem[] = [
    { label: "Dashboard", href: "/account", icon: RiDashboardLine },
    {
      label: "Membership",
      href: "/membership",
      icon: RiVipCrownLine,
    },
    ...(hasCredits && credits
      ? [
          {
            label: "Use Credit",
            href: "/portal/book",
            icon: RiCoupon3Line,
            badge: `${credits.credits_remaining}`,
          },
        ]
      : []),
    { label: "Settings", href: "/account#settings", icon: RiSettings3Line },
  ];

  return (
    <div className="relative min-h-screen bg-background flex">
      <BrandAtmosphere />
      {/* Desktop Sidebar */}
      <aside className="relative z-10 hidden lg:flex lg:w-[260px] lg:flex-col border-r border-[color:var(--hairline)] bg-card/70 backdrop-blur-xl flex-shrink-0 sticky top-0 h-screen">
        <SidebarContent
          navItems={navItems}
          pathname={pathname}
          userName={userName}
          userEmail={userEmail}
          userInitials={userInitials}
          onSignOut={handleSignOut}
        />
      </aside>

      {/* Main Content */}
      <div className="relative z-10 flex-1 flex flex-col min-w-0">
        {/* Mobile Header */}
        <header className="lg:hidden sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
          <div className="flex items-center justify-between px-4 h-14">
            <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <RiMenuLine className="w-5 h-5" />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-[280px] p-0">
                <SidebarContent
                  navItems={navItems}
                  pathname={pathname}
                  userName={userName}
                  userEmail={userEmail}
                  userInitials={userInitials}
                  onSignOut={handleSignOut}
                  onClose={() => setMobileOpen(false)}
                />
              </SheetContent>
            </Sheet>

            <Link href="/" className="flex items-center gap-2">
              <img src={logo} alt="Novara" className="w-8 h-8 rounded-xl" />
              <span className="font-bold text-sm">Novara</span>
            </Link>

            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold text-primary-foreground"
              style={{ background: "var(--gradient-primary)" }}
            >
              {userInitials}
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
