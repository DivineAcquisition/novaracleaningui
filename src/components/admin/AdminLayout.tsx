"use client";

// ─── AdminLayout (v3 — 2026-05-26) ──────────────────────────────────────
//
// Brand-aligned premium SaaS shell for /admin/*.
//   1. Dashboard          (live metrics + activity)
//   2. Bookings           (every booking, with cancel/reschedule/refund)
//   3. Cleaners           (directory + onboarding + management)
//   4. Internal Booking   (VA-driven booking submission, formerly "CSR Form")
//   5. Customers          (full account control)
//   6. Operational Map    (cleaner coverage × booking heatmap)
//   7. Messages           (manual SMS + email send)
//   8. Payroll            (Stripe Connect cleaner payouts)
//   9. Sales              (per-VA leads, bookings, revenue)
//  10. Team               (admins + VA portal access)
//
// Premium SaaS feel: Plus Jakarta Sans display font, lovable-style press
// buttons, sharper card density, emerald accent. Sidebar is light-gray on
// white, with a subtle gradient on the active item to read as a SaaS
// product, not an internal form.

import {
  RiDashboardLine,
  RiGroupLine,
  RiToolsLine,
  RiMapPin2Line,
  RiFileEditLine,
  RiBankCardLine,
  RiLineChartLine,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiCloseLine,
  RiShieldStarLine,
  RiCalendarCheckLine,
  RiChat3Line,
  RiTeamLine,
} from "@remixicon/react";
import { ReactNode, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface NavItem {
  title: string;
  url: string;
  icon: typeof RiDashboardLine;
  description: string;
}

const NAV_ITEMS: NavItem[] = [
  {
    title: "Dashboard",
    url: "/admin/dashboard",
    icon: RiDashboardLine,
    description: "Live metrics + activity",
  },
  {
    title: "Bookings",
    url: "/admin/bookings",
    icon: RiCalendarCheckLine,
    description: "Cancel · reschedule · refund",
  },
  {
    title: "Cleaners",
    url: "/admin/cleaners",
    icon: RiToolsLine,
    description: "Directory + onboarding",
  },
  {
    title: "Internal Booking",
    url: "/admin/csr",
    icon: RiFileEditLine,
    description: "VA booking submission",
  },
  {
    title: "Customers",
    url: "/admin/customers",
    icon: RiGroupLine,
    description: "Accounts, credits, billing",
  },
  {
    title: "Map",
    url: "/admin/map",
    icon: RiMapPin2Line,
    description: "Coverage × booking heatmap",
  },
  {
    title: "Messages",
    url: "/admin/messages",
    icon: RiChat3Line,
    description: "Manual SMS + email",
  },
  {
    title: "Payroll",
    url: "/admin/payroll",
    icon: RiBankCardLine,
    description: "Stripe Connect payouts",
  },
  {
    title: "Sales",
    url: "/admin/sales-tracker",
    icon: RiLineChartLine,
    description: "Per-VA leads & revenue",
  },
  {
    title: "Testimonials",
    url: "/admin/testimonials",
    icon: RiShieldStarLine,
    description: "Customer video reviews",
  },
  {
    title: "Team",
    url: "/admin/team",
    icon: RiTeamLine,
    description: "Admins & VA access",
  },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/admin/auth");
  };

  const active = NAV_ITEMS.find((n) => pathname?.startsWith(n.url));

  return (
    <div className="min-h-screen flex w-full bg-slate-50 text-slate-900 font-sans">
      {/* ─── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="hidden lg:flex w-64 flex-col border-r border-slate-200 bg-white shrink-0">
        <SidebarBrand />
        <SidebarNav pathname={pathname} />
        <SidebarFooter user={user} onSignOut={handleSignOut} />
      </aside>

      {/* ─── Mobile slide-over ───────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          "lg:hidden fixed inset-y-0 left-0 z-50 w-72 flex-col bg-white border-r border-slate-200 transition-transform",
          mobileOpen ? "translate-x-0 flex" : "-translate-x-full flex",
        )}
      >
        <div className="flex items-center justify-between p-4 border-b border-slate-200">
          <SidebarBrand compact />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMobileOpen(false)}
            className="text-slate-500"
          >
            <RiCloseLine className="w-5 h-5" />
          </Button>
        </div>
        <SidebarNav pathname={pathname} />
        <SidebarFooter user={user} onSignOut={handleSignOut} />
      </aside>

      {/* ─── Main column ─────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center gap-3 px-4 sm:px-6 border-b border-slate-200 bg-white/80 backdrop-blur sticky top-0 z-30">
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden text-slate-700"
            onClick={() => setMobileOpen(true)}
          >
            <RiMenuLine className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            {active ? (
              <>
                <span className="w-7 h-7 rounded-lg bg-violet-50 text-violet-700 inline-flex items-center justify-center shrink-0">
                  <active.icon className="w-4 h-4" />
                </span>
                <h1 className="font-jakarta text-sm font-semibold text-slate-900 truncate tracking-tight">
                  {active.title}
                </h1>
                <span className="hidden sm:inline text-xs text-slate-500 truncate">
                  · {active.description}
                </span>
              </>
            ) : (
              <h1 className="font-jakarta text-sm font-semibold text-slate-900">
                Admin
              </h1>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            <span className="hidden md:inline truncate max-w-[200px] tabular-nums">
              {user?.email}
            </span>
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}

// ─── Sidebar sub-components ──────────────────────────────────────────────

function SidebarBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-2.5 px-5 py-5 border-b border-slate-200",
        compact && "border-0 py-0",
      )}
    >
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-violet-700 flex items-center justify-center shadow-[0_4px_12px_-2px_rgba(16,163,74,0.4)]">
        <RiShieldStarLine className="w-5 h-5 text-white" />
      </div>
      <div className="leading-tight">
        <p className="font-jakarta text-sm font-bold text-slate-900 tracking-tight">
          Novara
        </p>
        <p className="text-[10px] text-slate-500 font-semibold tracking-[0.08em] uppercase">
          Admin Console
        </p>
      </div>
    </div>
  );
}

function SidebarNav({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
      <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.1em] text-slate-400 font-bold">
        Workspace
      </p>
      {NAV_ITEMS.map((item) => {
        const isActive = pathname?.startsWith(item.url) ?? false;
        return (
          <Link
            key={item.url}
            href={item.url}
            className={cn(
              "group flex items-center gap-3 px-3 py-2 rounded-lg transition-all duration-150 text-sm",
              isActive
                ? "bg-gradient-to-r from-violet-50 to-violet-50/40 text-violet-900 font-semibold shadow-[inset_0_0_0_1px_rgba(16,163,74,0.15)]"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/70",
            )}
          >
            <span
              className={cn(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                isActive
                  ? "bg-violet-600 text-white shadow-[0_2px_4px_-1px_rgba(16,163,74,0.45)]"
                  : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700",
              )}
            >
              <item.icon className="w-4 h-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="leading-tight tracking-tight">{item.title}</p>
              <p
                className={cn(
                  "text-[11px] leading-tight truncate",
                  isActive
                    ? "text-violet-700/70"
                    : "text-slate-400 group-hover:text-slate-500",
                )}
              >
                {item.description}
              </p>
            </div>
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarFooter({
  user,
  onSignOut,
}: {
  user: { email?: string | null } | null;
  onSignOut: () => void;
}) {
  return (
    <div className="border-t border-slate-200 p-3 space-y-2">
      <div className="px-3 py-2 rounded-lg bg-slate-50">
        <p className="text-[10px] uppercase tracking-wide text-slate-500 font-bold">
          Signed in
        </p>
        <p className="text-sm text-slate-900 font-medium truncate">
          {user?.email || "—"}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2 text-slate-700 border-slate-200 hover:bg-slate-100 hover:text-slate-900"
        onClick={onSignOut}
      >
        <RiLogoutBoxRLine className="w-4 h-4" />
        Sign out
      </Button>
    </div>
  );
}
