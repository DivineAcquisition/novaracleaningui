"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  RiArrowRightLine,
  RiCalendarCheckLine,
  RiCoupon3Line,
  RiDashboardLine,
  RiSettings3Line,
  RiVipCrownLine,
} from "@remixicon/react";

import { WorkspaceShell } from "@/components/chrome/WorkspaceShell";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";
import { useMembershipCredits } from "@/hooks/use-membership-credits";
import { ADMIN_AUTH_URL, isStaffCustomerEmail } from "@/lib/staff-customer";
import { toast } from "sonner";

export function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { user, signOut } = useAuth();
  const { credits, hasCredits } = useMembershipCredits();
  const [staffBlocked, setStaffBlocked] = useState(false);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    void (async () => {
      if (!(await isStaffCustomerEmail(user.email))) return;
      if (cancelled) return;
      setStaffBlocked(true);
      toast.message("Staff accounts use the admin workspace, not the customer portal.");
      await signOut();
      window.location.assign(ADMIN_AUTH_URL);
    })();
    return () => {
      cancelled = true;
    };
    // signOut is recreated every AuthProvider render — depend on email only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const userName = user
    ? user.user_metadata?.full_name ||
      user.email
        ?.split("@")[0]
        ?.replace(/[._]/g, " ")
        .replace(/\b\w/g, (l: string) => l.toUpperCase()) ||
      user.email
    : null;

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  const navItems = [
    { title: "Dashboard", url: "/account", icon: RiDashboardLine, description: "Bookings · credits" },
    { title: "Membership", url: "/membership", icon: RiVipCrownLine, description: "Plans · pause · resume" },
    ...(hasCredits && credits
      ? [
          {
            title: "Use credit",
            url: "/portal/book",
            icon: RiCoupon3Line,
            description: "Book with a membership credit",
            badge: String(credits.credits_remaining),
          },
        ]
      : []),
    { title: "Settings", url: "/account#settings", icon: RiSettings3Line, description: "Password · billing" },
  ];

  if (staffBlocked) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 text-sm text-slate-500">
        Redirecting to the admin workspace…
      </div>
    );
  }

  return (
    <WorkspaceShell
      badge="Account"
      navItems={navItems}
      userLabel={userName}
      userSub={user?.email}
      onSignOut={handleSignOut}
      cta={
        <Button className="w-full justify-between" onClick={() => router.push("/portal/book")}>
          <span className="inline-flex items-center gap-2">
            <RiCalendarCheckLine className="w-4 h-4" />
            Book a cleaning
          </span>
          <RiArrowRightLine className="w-4 h-4 opacity-70" />
        </Button>
      }
    >
      {children}
    </WorkspaceShell>
  );
}
