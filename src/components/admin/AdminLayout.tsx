"use client";

// ─── AdminLayout (v3 — 2026-05-26) ──────────────────────────────────────
//
// Brand-aligned premium SaaS shell for /admin/*.
//   1. Dashboard          (live metrics + activity)
//   2. Bookings           (every booking, with cancel/reschedule/refund)
//   2a. Needs Attention   (at-risk bookings, delay cascades, backup cover)
//   3. Cleaners           (directory + onboarding + management)
//   4. Dispatch           (staff jobs, offers, re-dispatch)
//   5. Internal Booking   (VA-driven booking submission, formerly "CSR Form")
//   6. Commercial         (walkthrough → proposal → billing → dispatch; STR under its own tab)
//   8. Customers          (full account control)
//   9. Operational Map    (cleaner coverage × booking heatmap)
//  10. Payroll            (Stripe Connect cleaner payouts)
//  11. Team               (admins + VA portal access)
//
// Premium SaaS feel: Plus Jakarta Sans display font, lovable-style press
// buttons, sharper card density, emerald accent. Sidebar is light-gray on
// white, with a subtle gradient on the active item to read as a SaaS
// product, not an internal form.

import {
  RiAlarmWarningLine,
  RiDashboardLine,
  RiGroupLine,
  RiToolsLine,
  RiMapPin2Line,
  RiFileEditLine,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiCloseLine,
  RiCalendarCheckLine,
  RiTeamLine,
  RiUserStarLine,
  RiRocket2Line,
  RiHotelLine,
  RiRepeatLine,
  RiGroup2Line,
  RiMoneyDollarCircleLine,
  RiShieldCheckLine,
  RiFileChartLine,
  RiFileList3Line,
  RiPriceTag3Line,
  RiRefreshLine,
  RiMailSendLine,
  RiRobot2Line,
} from "@remixicon/react";
import { ReactNode, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { BrandAtmosphere } from "@/components/brand/atmosphere";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useAdminRole } from "@/hooks/use-admin-role";

// Brand ramp — Novara purple as a precise accent on a clean Coss-style shell.
const RAMP = BRAND.gradient;

interface NavItem {
  title: string;
  url: string;
  icon: typeof RiDashboardLine;
  description: string;
  // Hidden from VAs. Finance, roles, and commercial surfaces are admin-only;
  // VAs keep the operational set (bookings, dispatch, internal booking,
  // recurring, QC, crews, customers, cleaners, map). Route-level guards in the
  // page files (requiredRole="admin_strict") back this up server-side.
  adminOnly?: boolean;
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
    // One place for running today: at-risk bookings and coverage, staffing,
    // the coverage map, and the sync health that explains a missing booking.
    // These were four sidebar entries, which meant working a single late job
    // took you across three of them.
    title: "Operations",
    url: "/admin/operations",
    icon: RiAlarmWarningLine,
    description: "Needs attention · dispatch · map · sync health",
  },
  {
    title: "Cleaners",
    url: "/admin/cleaners",
    icon: RiToolsLine,
    description: "Directory · applicants · crews",
  },
  {
    title: "Internal Booking",
    url: "/admin/csr",
    icon: RiFileEditLine,
    description: "VA booking submission",
  },
  {
    title: "Proposals",
    url: "/admin/proposals",
    icon: RiMailSendLine,
    description: "Requests · onsite docs · send · pipeline",
  },
  {
    title: "Quotes",
    url: "/admin/quotes",
    icon: RiFileList3Line,
    description: "Saved quotes · send checklists",
    adminOnly: true,
  },
  {
    title: "Pricing",
    url: "/admin/pricing",
    icon: RiPriceTag3Line,
    description: "Zones · demand-reactive · guardrails · audit",
    adminOnly: true,
  },
  {
    title: "Commercial",
    url: "/admin/commercial",
    icon: RiHotelLine,
    description: "Walkthrough · proposal · billing · dispatch · STR",
    adminOnly: true,
  },
  {
    title: "Customers",
    url: "/admin/customers",
    icon: RiGroupLine,
    description: "Accounts, credits, billing",
  },
  {
    title: "Recurring",
    url: "/admin/recurring",
    icon: RiRepeatLine,
    description: "Memberships hub · recurring cleans · cadence",
  },
  {
    title: "Payroll",
    url: "/admin/payroll",
    icon: RiMoneyDollarCircleLine,
    description: "Payouts · extra pay · expenses & reimbursements",
    adminOnly: true,
  },
  {
    title: "Quality Control",
    url: "/admin/qc",
    icon: RiShieldCheckLine,
    description: "Job documentation · issues · dispute packets",
  },
  {
    title: "VA Performance",
    url: "/admin/va-performance",
    icon: RiUserStarLine,
    description: "Verified actuals vs EOD · flags · revenue per VA hour",
    adminOnly: true,
  },
  {
    title: "Weekly Report",
    url: "/admin/weekly-report",
    icon: RiFileChartLine,
    description: "Sales · retention · growth PDF",
    adminOnly: true,
  },
  {
    title: "Team",
    url: "/admin/team",
    icon: RiTeamLine,
    description: "Admins & VA access",
    adminOnly: true,
  },
  {
    title: "AI Models",
    url: "/admin/model-control",
    icon: RiRobot2Line,
    description: "Model routing by tier · response log",
    adminOnly: true,
  },
];

// Segment-aware active check so prefix-colliding routes (e.g. /admin/partner vs
// /admin/partner-accounts) don't both light up — match exact or a full segment.
function isNavActive(pathname: string | null, url: string): boolean {
  if (!pathname) return false;
  return pathname === url || pathname.startsWith(`${url}/`);
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const { isAdmin } = useAdminRole();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Hide admin-only items from VAs. Until the role resolves, treat the user as
  // NOT a full admin so restricted items never flash for a VA.
  const navItems = isAdmin ? NAV_ITEMS : NAV_ITEMS.filter((n) => !n.adminOnly);

  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/admin/auth");
  };

  const active = NAV_ITEMS.find((n) => isNavActive(pathname, n.url));

  return (
    <div className="relative min-h-screen flex w-full bg-background text-foreground font-sans">
      <BrandAtmosphere />
      {/* ─── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="relative z-10 hidden lg:flex w-64 flex-col border-r border-[color:var(--hairline)] bg-card/70 backdrop-blur-xl shrink-0">
        <SidebarBrand />
        <SidebarNav pathname={pathname} items={navItems} />
        <SidebarFooter user={user} onSignOut={handleSignOut} />
      </aside>

      {/* ─── Mobile slide-over ───────────────────────────────────────── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside
        className={cn(
          "lg:hidden fixed inset-y-0 left-0 z-50 w-72 flex-col bg-card/95 backdrop-blur-xl border-r border-[color:var(--hairline)] transition-transform",
          mobileOpen ? "translate-x-0 flex" : "-translate-x-full flex",
        )}
      >
        <div className="flex items-center justify-between p-4 border-b border-[color:var(--hairline)]">
          <SidebarBrand compact />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setMobileOpen(false)}
            className="text-muted-foreground"
          >
            <RiCloseLine className="w-5 h-5" />
          </Button>
        </div>
        <SidebarNav pathname={pathname} items={navItems} />
        <SidebarFooter user={user} onSignOut={handleSignOut} />
      </aside>

      {/* ─── Main column ─────────────────────────────────────────────── */}
      <main className="relative z-10 flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center gap-3 px-4 sm:px-6 border-b border-[color:var(--hairline)] bg-background/80 backdrop-blur-xl sticky top-0 z-30 hairline-glow">
          <Button
            variant="ghost"
            size="sm"
            className="lg:hidden text-foreground"
            onClick={() => setMobileOpen(true)}
          >
            <RiMenuLine className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            {active ? (
              <>
                <span className="w-7 h-7 rounded-lg text-primary inline-flex items-center justify-center shrink-0 bg-brand-50">
                  <active.icon className="w-4 h-4" />
                </span>
                <h1 className="font-heading text-sm font-semibold text-foreground truncate tracking-tight">
                  {active.title}
                </h1>
                <span className="hidden sm:inline text-xs text-muted-foreground truncate">
                  · {active.description}
                </span>
              </>
            ) : (
              <h1 className="font-heading text-sm font-semibold text-foreground">
                Admin
              </h1>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
            <span className="hidden md:inline truncate max-w-[200px] font-mono tabular-nums">
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
        "relative flex items-center gap-2 overflow-hidden px-5 py-5 border-b border-[color:var(--hairline)]",
        compact && "border-0 py-0",
      )}
    >
      {!compact && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: "radial-gradient(120% 100% at 0% 0%, rgba(92,15,254,0.08), transparent 70%)" }}
        />
      )}
      <img src="/novara-email-logo.png" alt="Novara" className="relative h-[22px] w-auto" />
      <span className="relative rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.12em] text-primary bg-brand-50">
        Admin
      </span>
    </div>
  );
}

function SidebarNav({ pathname, items }: { pathname: string | null; items: NavItem[] }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
      <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">
        Workspace
      </p>
      {items.map((item) => {
        const isActive = isNavActive(pathname, item.url);
        return (
          <Link
            key={item.url}
            href={item.url}
            className={cn(
              "group relative flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-150 text-sm",
              isActive
                ? "bg-brand-50 text-primary font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.9)] ring-1 ring-primary/10"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/70",
            )}
          >
            {isActive && (
              <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full" style={{ background: RAMP }} />
            )}
            <span
              className={cn(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                isActive
                  ? "text-white shadow-[0_2px_6px_-1px_rgba(92,15,254,0.5)]"
                  : "bg-muted text-muted-foreground group-hover:bg-brand-50 group-hover:text-primary",
              )}
              style={isActive ? { background: RAMP } : undefined}
            >
              <item.icon className="w-4 h-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="leading-tight tracking-tight">{item.title}</p>
              <p
                className={cn(
                  "text-[11px] leading-tight truncate",
                  isActive
                    ? "text-primary/70"
                    : "text-muted-foreground/80 group-hover:text-muted-foreground",
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
    <div className="border-t border-[color:var(--hairline)] p-3 space-y-2">
      <div className="px-3 py-2 rounded-lg surface-sunken">
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">
          Signed in
        </p>
        <p className="text-sm text-foreground font-medium truncate">
          {user?.email || "—"}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="w-full justify-start gap-2"
        onClick={onSignOut}
      >
        <RiLogoutBoxRLine className="w-4 h-4" />
        Sign out
      </Button>
    </div>
  );
}
