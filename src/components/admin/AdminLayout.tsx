"use client";

// ─── AdminLayout (v2 — 2026-05-22) ──────────────────────────────────────
//
// Brand-aligned light shell for /admin/*. Five tabs in the left sidebar,
// nothing else:
//   1. Dashboard          (live metrics + activity)
//   2. Cleaners           (directory + onboarding + management)
//   3. CSR Form           (VA booking submission)
//   4. Customers          (full account control)
//   5. Operational Map    (cleaner coverage × booking heatmap)
//
// Color scheme matches the email/brand palette (emerald gradient
// #16A34A → #0E7C3A). Inline emerald classes — we do NOT touch
// globals.css so customer-facing pages keep their existing tokens.

import {
  RiDashboardLine,
  RiGroupLine,
  RiToolsLine,
  RiMapPin2Line,
  RiFileEditLine,
  RiLogoutBoxRLine,
  RiMenuLine,
  RiCloseLine,
  RiShieldStarLine,
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
    description: "Live metrics + activity feed",
  },
  {
    title: "Cleaners",
    url: "/admin/cleaners",
    icon: RiToolsLine,
    description: "Directory, onboarding, management",
  },
  {
    title: "CSR Form",
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
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/admin/auth");
  };

  const active = NAV_ITEMS.find((n) => pathname?.startsWith(n.url));

  return (
    <div className="min-h-screen flex w-full bg-slate-50 text-slate-900">
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
                <active.icon className="w-4 h-4 text-emerald-700 shrink-0" />
                <h1 className="text-sm font-semibold text-slate-900 truncate">
                  {active.title}
                </h1>
                <span className="hidden sm:inline text-xs text-slate-500 truncate">
                  · {active.description}
                </span>
              </>
            ) : (
              <h1 className="text-sm font-semibold text-slate-900">Admin</h1>
            )}
          </div>
          <div className="ml-auto flex items-center gap-3 text-xs text-slate-500">
            <span className="hidden md:inline truncate max-w-[180px]">{user?.email}</span>
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
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-700 flex items-center justify-center shadow-sm">
        <RiShieldStarLine className="w-5 h-5 text-white" />
      </div>
      <div className="leading-tight">
        <p className="text-sm font-semibold text-slate-900">Novara</p>
        <p className="text-[11px] text-slate-500 font-medium tracking-wide uppercase">
          Admin Console
        </p>
      </div>
    </div>
  );
}

function SidebarNav({ pathname }: { pathname: string | null }) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
      <p className="px-3 pb-2 text-[11px] uppercase tracking-wider text-slate-400 font-semibold">
        Workspace
      </p>
      {NAV_ITEMS.map((item) => {
        const isActive = pathname?.startsWith(item.url) ?? false;
        return (
          <Link
            key={item.url}
            href={item.url}
            className={cn(
              "group flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm",
              isActive
                ? "bg-emerald-50 text-emerald-800 font-semibold"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100",
            )}
          >
            <span
              className={cn(
                "w-8 h-8 rounded-md flex items-center justify-center transition-colors",
                isActive
                  ? "bg-emerald-600 text-white"
                  : "bg-slate-100 text-slate-500 group-hover:bg-slate-200 group-hover:text-slate-700",
              )}
            >
              <item.icon className="w-4 h-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="leading-tight">{item.title}</p>
              <p
                className={cn(
                  "text-[11px] leading-tight truncate",
                  isActive ? "text-emerald-700/70" : "text-slate-400 group-hover:text-slate-500",
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
        <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold">
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
