"use client";

// ─── AdminLayout (v4 — 2026-11-27) ──────────────────────────────────────
//
// Shell for /admin/*. Navigation comes from one role-aware definition
// (admin-nav.ts) shared by the sidebar, the mobile menu, ⌘K search and the
// header title:
//
//   + New booking (pinned)
//   Daily work         Today · Bookings · Dispatch & coverage · Quality control
//   Sales & clients    Quotes · Proposals · Customers · Business accounts · Recurring plans
//   Workforce          Cleaners & crews · Hiring & onboarding
//   Finance & reports  Cleaner pay · Profit & loss · VA performance · Weekly report
//   Settings           Pricing rules · Team access · Email settings & delivery ·
//                      Booking compliance · Assistant settings
//
// Groups a role cannot see are hidden. The active group auto-expands; a
// manual collapse is remembered per browser. Route guards in the page files
// stay the source of truth for access.

import {
  RiLogoutBoxRLine,
  RiMenuLine,
  RiCloseLine,
  RiAddLine,
  RiArrowDownSLine,
} from "@/components/icons";
import { ReactNode, RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { AdminCommandMenu, type CommandPage } from "@/components/admin/AdminCommandMenu";
import { cn } from "@/lib/utils";
import { useAdminRole } from "@/hooks/use-admin-role";
import { OpsAssistantProvider, useOpsAssistant } from "@/components/ops-assistant/OpsAssistantProvider";
import { OpsAssistantPanel, OpsAssistantToggle } from "@/components/ops-assistant/OpsAssistantPanel";
import { AdminTypography } from "@/components/admin/AdminTypography";
import {
  PRIMARY_ACTION,
  allItemsForRole,
  findActiveItem,
  navForRole,
  type AdminNavGroup,
  type AdminNavItem,
} from "@/components/admin/admin-nav";

const COLLAPSE_KEY = "novara.admin.nav.collapsed.v1";

function readCollapsed(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(COLLAPSE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
  } catch {
    return {};
  }
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { isAdmin } = useAdminRole();
  const [mobileOpen, setMobileOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const mobilePanelRef = useRef<HTMLDivElement | null>(null);

  // Until the role resolves, treat the user as a VA so restricted items never
  // flash for one.
  const role = isAdmin ? "admin" : "va";
  const groups = useMemo(() => navForRole(role), [role]);
  const items = useMemo(() => allItemsForRole(role), [role]);
  const active = findActiveItem(items, pathname, searchParams);
  const activeGroupId = groups.find((g) => g.items.some((i) => i.id === active?.id))?.id;

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  useEffect(() => setCollapsed(readCollapsed()), []);
  // Navigating into a group expands it, even if it was collapsed earlier.
  useEffect(() => {
    if (!activeGroupId) return;
    setCollapsed((prev) => {
      if (!prev[activeGroupId]) return prev;
      const next = { ...prev, [activeGroupId]: false };
      try { window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, [activeGroupId, pathname]);
  const toggleGroup = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify(next)); } catch { /* private mode */ }
      return next;
    });
  }, []);

  const closeMobile = useCallback((restoreFocus = true) => {
    setMobileOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }, []);

  // Close the mobile menu on any navigation (including query-only changes).
  const locationKey = `${pathname}?${searchParams?.toString() || ""}`;
  useEffect(() => {
    setMobileOpen(false);
  }, [locationKey]);

  // Mobile menu: focus the first control on open, Escape closes, Tab stays inside.
  useEffect(() => {
    if (!mobileOpen) return;
    const panel = mobilePanelRef.current;
    const focusables = () =>
      Array.from(panel?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])") || []);
    const focusTimer = window.setTimeout(() => focusables()[0]?.focus(), 30);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeMobile();
        return;
      }
      if (event.key !== "Tab") return;
      const list = focusables();
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKey);
    };
  }, [mobileOpen, closeMobile]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/admin/auth");
  };

  const commandPages: CommandPage[] = useMemo(
    () => [
      { item: PRIMARY_ACTION, group: "Primary" },
      ...groups.flatMap((g) => g.items.map((item) => ({ item, group: g.title }))),
    ],
    [groups],
  );

  const navProps = { groups, activeId: active?.id, collapsed, onToggle: toggleGroup };

  return (
    <OpsAssistantProvider surface="workspace">
    <div data-admin-text className="admin-theme relative min-h-screen flex w-full bg-background text-foreground font-sans antialiased">
      <AdminTypography />
      {/* ─── Desktop sidebar ─────────────────────────────────────────── */}
      <aside className="sticky top-0 z-10 hidden h-screen lg:flex w-64 flex-col border-r border-[color:var(--hairline)] bg-card shrink-0">
        <SidebarBrand />
        <PrimaryAction active={active?.id === PRIMARY_ACTION.id} />
        <SidebarNav idPrefix="desk" {...navProps} />
        <SidebarFooter user={user} onSignOut={handleSignOut} />
      </aside>

      {/* ─── Mobile slide-over ───────────────────────────────────────── */}
      {mobileOpen && (
        <div
          aria-hidden
          className="lg:hidden fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm"
          onClick={() => closeMobile()}
        />
      )}
      <div
        ref={mobilePanelRef}
        id="admin-mobile-nav"
        role="dialog"
        aria-modal="true"
        aria-label="Workspace navigation"
        // `invisible` (visibility: hidden) takes the closed panel and every
        // link in it out of the tab order and the accessibility tree.
        className={cn(
          "lg:hidden fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-card border-r border-[color:var(--hairline)] shadow-[0_24px_60px_-20px_rgba(11,10,17,0.35)] duration-200",
          // Visibility flips at once on open (so focus can land) and only
          // after the slide-out on close.
          mobileOpen ? "visible translate-x-0 transition-transform" : "invisible -translate-x-full transition-[transform,visibility]",
        )}
      >
        <div className="flex items-center justify-between p-4 border-b border-[color:var(--hairline)]">
          <SidebarBrand compact />
          <Button
            variant="ghost"
            size="sm"
            onClick={() => closeMobile()}
            className="text-muted-foreground"
            aria-label="Close navigation"
          >
            <RiCloseLine className="w-5 h-5" />
          </Button>
        </div>
        <PrimaryAction active={active?.id === PRIMARY_ACTION.id} />
        <SidebarNav idPrefix="mob" {...navProps} />
        <SidebarFooter user={user} onSignOut={handleSignOut} />
      </div>

      {/* ─── Main column ─────────────────────────────────────────────── */}
      <AdminMain
        active={active}
        activeGroup={groups.find((g) => g.id === activeGroupId)?.title}
        user={user}
        pages={commandPages}
        role={role}
        menuButtonRef={menuButtonRef}
        mobileOpen={mobileOpen}
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
  activeGroup,
  user,
  pages,
  role,
  menuButtonRef,
  mobileOpen,
  onOpenMobile,
}: {
  children: ReactNode;
  active: AdminNavItem | undefined;
  activeGroup: string | undefined;
  user: { email?: string | null } | null;
  pages: CommandPage[];
  role: "admin" | "va";
  menuButtonRef: RefObject<HTMLButtonElement>;
  mobileOpen: boolean;
  onOpenMobile: () => void;
}) {
  const { open } = useOpsAssistant();
  return (
    <main
      className={cn(
        "relative z-10 flex-1 flex flex-col min-w-0 transition-[margin] duration-300",
        // Laptop: a narrower assistant so the working form keeps room.
        open && "lg:mr-[360px] 2xl:mr-[420px]",
      )}
    >
      <header className="h-14 flex items-center gap-3 px-4 sm:px-6 border-b border-[color:var(--hairline)] bg-card/90 backdrop-blur-md sticky top-0 z-30">
        <Button
          ref={menuButtonRef}
          variant="ghost"
          size="sm"
          className="lg:hidden text-foreground"
          onClick={onOpenMobile}
          aria-label="Open navigation"
          aria-controls="admin-mobile-nav"
          aria-expanded={mobileOpen}
        >
          <RiMenuLine className="w-5 h-5" />
        </Button>
        <div className="flex items-center gap-2.5 min-w-0">
          {active ? (
            <>
              {activeGroup ? (
                <>
                  <span className="hidden sm:inline text-[13px] text-muted-foreground">{activeGroup}</span>
                  <span aria-hidden className="hidden sm:inline text-[13px] text-muted-foreground/50">/</span>
                </>
              ) : null}
              <span className="w-7 h-7 rounded-lg text-[#6810FE] inline-flex items-center justify-center shrink-0 bg-[#F3EEFF]">
                <active.icon className="w-4 h-4" />
              </span>
              <h1 className="text-[14px] font-semibold text-foreground truncate tracking-tight">{active.title}</h1>
            </>
          ) : (
            <h1 className="text-[14px] font-semibold text-foreground">Workspace</h1>
          )}
        </div>
        <div className="ml-auto flex items-center gap-2.5 text-xs text-muted-foreground">
          <AdminCommandMenu pages={pages} role={role} />
          <OpsAssistantToggle />
          <UserBadge email={user?.email} />
        </div>
      </header>
      {/* overflow-x-clip, not overflow-auto: an overflow container here became
          the sticky scroll box while the window scrolled, so sticky headers
          and rails inside pages never stuck. */}
      <div className="flex-1 min-w-0 overflow-x-clip p-4 sm:p-6 lg:p-8">{children}</div>
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

function PrimaryAction({ active }: { active: boolean }) {
  return (
    <div className="px-3 pt-3">
      <Link
        href={PRIMARY_ACTION.url}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex h-10 items-center justify-center gap-2 rounded-[10px] bg-gradient-to-b from-[#7A2BFF] to-[#5A0BE6] px-3 text-[13.5px] font-semibold text-white shadow-[0_6px_14px_-6px_rgba(104,16,254,0.7)] transition hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE] focus-visible:ring-offset-2",
          active && "ring-2 ring-[#6810FE]/30 ring-offset-1",
        )}
      >
        <RiAddLine className="h-4 w-4" />
        {PRIMARY_ACTION.title}
      </Link>
    </div>
  );
}

function SidebarNav({
  idPrefix,
  groups,
  activeId,
  collapsed,
  onToggle,
}: {
  idPrefix: string;
  groups: AdminNavGroup[];
  activeId: string | undefined;
  collapsed: Record<string, boolean>;
  onToggle: (id: string) => void;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-3" aria-label="Workspace">
      {groups.map((group) => {
        const isCollapsed = !!collapsed[group.id];
        const listId = `${idPrefix}-nav-${group.id}`;
        const hasActive = group.items.some((i) => i.id === activeId);
        return (
          <div key={group.id}>
            <button
              type="button"
              onClick={() => onToggle(group.id)}
              aria-expanded={!isCollapsed}
              aria-controls={listId}
              className="flex w-full items-center justify-between rounded-md px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE]/50"
            >
              <span>
                {group.title}
                {isCollapsed && hasActive ? <span className="sr-only"> (contains current page)</span> : null}
              </span>
              <RiArrowDownSLine
                aria-hidden
                className={cn("h-3.5 w-3.5 transition-transform", isCollapsed && "-rotate-90")}
              />
            </button>
            <ul id={listId} hidden={isCollapsed} className="mt-0.5 space-y-0.5">
              {group.items.map((item) => {
                const isActive = item.id === activeId;
                return (
                  <li key={item.id}>
                    <Link
                      href={item.url}
                      aria-current={isActive ? "page" : undefined}
                      className={cn(
                        "group relative flex items-center gap-2.5 rounded-[9px] px-2.5 py-1.5 text-[13.5px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE]/50",
                        isActive ? "bg-[#F3EEFF] text-[#0B0A11] font-semibold" : "text-muted-foreground hover:bg-[#F6F5F9] hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn(
                          "grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-colors",
                          isActive
                            ? "bg-gradient-to-b from-[#7A2BFF] to-[#5A0BE6] text-white"
                            : "bg-[#F3F2F7] text-[#5F5B6B] group-hover:bg-[#F3EEFF] group-hover:text-[#6810FE]",
                        )}
                      >
                        <item.icon className="w-4 h-4" />
                      </span>
                      <span className="min-w-0 flex-1 truncate leading-tight tracking-tight">{item.title}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
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
