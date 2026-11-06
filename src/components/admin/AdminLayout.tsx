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
//   6. Accounts           (clients · STR · portfolio · compliance · commercial jobs)
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
  RiLineChartLine,
  RiPriceTag3Line,
  RiRefreshLine,
  RiMailLine,
  RiMailSendLine,
  RiSparklingLine,
} from "@/components/icons";
import { ReactNode, useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AdminCommandMenu } from "@/components/admin/AdminCommandMenu";
import { cn } from "@/lib/utils";
import { useAdminRole } from "@/hooks/use-admin-role";
import { OpsAssistantProvider, useOpsAssistant } from "@/components/ops-assistant/OpsAssistantProvider";
import { OpsAssistantPanel, OpsAssistantToggle } from "@/components/ops-assistant/OpsAssistantPanel";

// Brand ramp — Novara purple as a precise accent on a clean Coss-style shell.

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
    description: "Offers · send · agreement · payment",
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
    title: "Accounts",
    url: "/admin/accounts",
    icon: RiHotelLine,
    description: "Clients · STR · portfolio · compliance",
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
    description: "Payouts · extra pay · pay rates",
    adminOnly: true,
  },
  {
    title: "P&L",
    url: "/admin/pnl",
    icon: RiLineChartLine,
    description: "Collected · pipeline · ads · contribution",
    adminOnly: true,
  },
  {
    title: "Quality Control",
    url: "/admin/qc",
    icon: RiShieldCheckLine,
    description: "Job documentation · issues · Stripe evidence",
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
    title: "Email",
    url: "/admin/email",
    icon: RiMailLine,
    description: "Types, footers, consent, and the delivery log",
    adminOnly: true,
  },
  {
    title: "Assistant",
    url: "/admin/assistant",
    icon: RiSparklingLine,
    description: "Policy · review queue · assistant health",
    adminOnly: true,
  },
  {
    title: "Compliance",
    url: "/admin/compliance",
    icon: RiShieldCheckLine,
    description: "Acceptances · wording · privacy requests",
    adminOnly: true,
  },
  {
    title: "Intake",
    url: "/admin/intake",
    icon: RiUserStarLine,
    description: "Applications · onboarding · Lead Field Cleaner",
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
    <OpsAssistantProvider surface="workspace">
    <div className="admin-theme relative min-h-screen flex w-full bg-background text-foreground font-sans antialiased">
      {/* ─── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="sticky top-0 z-10 hidden h-screen lg:flex w-64 flex-col border-r border-[color:var(--hairline)] bg-card shrink-0">
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
          "lg:hidden fixed inset-y-0 left-0 z-50 w-72 flex-col bg-card border-r border-[color:var(--hairline)] shadow-[0_24px_60px_-20px_rgba(11,10,17,0.35)] transition-transform",
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
      <AdminMain
        active={active}
        user={user}
        pages={navItems.map((item) => ({ title: item.title, url: item.url, description: item.description }))}
        onOpenMobile={() => setMobileOpen(true)}
      >
        {children}
      </AdminMain>
      <OpsAssistantPanel />
    </div>
    </OpsAssistantProvider>
  );
}

function AdminMain({
  children,
  active,
  user,
  pages,
  onOpenMobile,
}: {
  children: ReactNode;
  active: NavItem | undefined;
  user: { email?: string | null } | null;
  pages: { title: string; url: string; description: string }[];
  onOpenMobile: () => void;
}) {
  const { open } = useOpsAssistant();
  return (
    <main
      className={cn(
        "relative z-10 flex-1 flex flex-col min-w-0 transition-[margin] duration-300",
        open && "lg:mr-[420px]",
      )}
    >
      <header className="h-14 flex items-center gap-3 px-4 sm:px-6 border-b border-[color:var(--hairline)] bg-card/90 backdrop-blur-md sticky top-0 z-30">
        <Button
          variant="ghost"
          size="sm"
          className="lg:hidden text-foreground"
          onClick={onOpenMobile}
          aria-label="Open navigation"
        >
          <RiMenuLine className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2.5 min-w-0">
          {active ? (
            <>
              <span className="hidden sm:inline text-[13px] text-muted-foreground">Workspace</span>
              <span className="hidden sm:inline text-[13px] text-muted-foreground/50">/</span>
              <span className="w-7 h-7 rounded-lg text-[#6810FE] inline-flex items-center justify-center shrink-0 bg-[#F3EEFF]">
                <active.icon className="w-4 h-4" />
              </span>
              <h1 className="text-[14px] font-semibold text-foreground truncate tracking-tight">{active.title}</h1>
              <span className="hidden md:inline text-[12.5px] text-muted-foreground truncate">{active.description}</span>
            </>
          ) : (
            <h1 className="text-[14px] font-semibold text-foreground">Workspace</h1>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2.5 text-xs text-muted-foreground">
          <AdminCommandMenu pages={pages} />
          <OpsAssistantToggle />
          <UserBadge email={user?.email} />
        </div>
      </header>
      <div className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">{children}</div>
    </main>
  );
}

// ─── Sidebar sub-components ──────────────────────────────────────────────

function SidebarBrand({ compact = false }: { compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 px-4 h-16 border-b border-[color:var(--hairline)]", compact && "h-auto border-0 px-0")}>
      <img src="/novara-logo.png" alt="" className="h-8 w-8 rounded-[9px]" />
      <span className="whitespace-nowrap text-[14.5px] font-semibold tracking-[-0.02em] text-foreground">Novara Cleaning</span>
      <span className="rounded-md bg-[#F3EEFF] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#5A1FD6]">
        Admin
      </span>
    </div>
  );
}

function UserBadge({ email }: { email?: string | null }) {
  const initials = (email || "?").split("@")[0].split(/[._-]/).map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
  return (
    <span className="flex items-center gap-2" title={email || undefined}>
      <span className="hidden md:inline truncate max-w-[200px] text-[12.5px] text-muted-foreground">{email}</span>
      <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-b from-[#7A2BFF] to-[#5A0BE6] text-[11px] font-semibold text-white">
        {initials || "?"}
      </span>
    </span>
  );
}

function SidebarNav({ pathname, items }: { pathname: string | null; items: NavItem[] }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5" aria-label="Workspace">
      <p className="px-3 pb-2 text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">Workspace</p>
      {items.map((item) => {
        const isActive = isNavActive(pathname, item.url);
        return (
          <Link
            key={item.url}
            href={item.url}
            aria-current={isActive ? "page" : undefined}
            title={item.description}
            className={cn(
              "group relative flex items-center gap-3 rounded-[10px] px-2.5 py-2 text-[13.5px] transition-colors duration-150",
              isActive ? "bg-[#F3EEFF] text-[#0B0A11] font-semibold" : "text-muted-foreground hover:bg-[#F6F5F9] hover:text-foreground",
            )}
          >
            <span
              className={cn(
                "grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors",
                isActive
                  ? "bg-gradient-to-b from-[#7A2BFF] to-[#5A0BE6] text-white shadow-[0_6px_14px_-6px_rgba(104,16,254,0.7)]"
                  : "bg-[#F3F2F7] text-[#5F5B6B] group-hover:bg-[#F3EEFF] group-hover:text-[#6810FE]",
              )}
            >
              <item.icon className="w-[17px] h-[17px]" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block leading-tight tracking-tight">{item.title}</span>
              <span className={cn("block truncate text-[11px] leading-tight", isActive ? "text-[#5A1FD6]/80 font-normal" : "text-muted-foreground/80")}>
                {item.description}
              </span>
            </span>
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
      <div className="px-3 py-2 rounded-lg surface-sunken border">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground font-semibold">
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
