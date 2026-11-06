"use client";

import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RiCloseLine, RiLogoutBoxRLine, RiMenuLine } from "@/components/icons";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type WorkspaceNavItem = {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  description?: string;
  badge?: string;
  /**
   * Guided-walkthrough anchor id, for workspaces that run them (see
   * `src/lib/tours/anchors.ts`). Plain string here so this shared chrome
   * doesn't depend on the contractor-only tour catalog.
   */
  tourAnchor?: string;
};

export function isWorkspaceNavActive(pathname: string | null, url: string, hash = "") {
  if (!pathname) return false;
  if (url.includes("#")) {
    const [path, frag] = url.split("#");
    return pathname === path && (hash === `#${frag}` || hash === frag);
  }
  if (url === "/account") return pathname === "/account" && hash !== "#settings";
  if (url === "/cleaner/dashboard") {
    return pathname === "/cleaner/dashboard" || pathname === "/cleaner/mobile-dashboard";
  }
  return pathname === url || pathname.startsWith(`${url}/`);
}

export function WorkspaceShell({
  badge,
  navLabel = "Workspace",
  navItems,
  title,
  description,
  userLabel,
  userSub,
  onSignOut,
  children,
  cta,
}: {
  badge: string;
  navLabel?: string;
  navItems: WorkspaceNavItem[];
  title?: string;
  description?: string;
  userLabel?: string | null;
  userSub?: string | null;
  onSignOut?: () => void;
  children: ReactNode;
  cta?: ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [hash, setHash] = useState("");
  const active = navItems.find((n) => isWorkspaceNavActive(pathname, n.url, hash));

  useEffect(() => {
    setMobileOpen(false);
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [pathname]);

  return (
    <div className="relative min-h-screen flex w-full bg-[#FAFAFC] text-foreground font-sans antialiased">
      <aside className="sticky top-0 z-10 hidden h-screen lg:flex w-64 flex-col border-r border-[color:var(--hairline)] bg-card shrink-0">
        <SidebarBrand badge={badge} />
        <SidebarNav pathname={pathname} hash={hash} items={navItems} label={navLabel} cta={cta} />
        <SidebarFooter userLabel={userLabel} userSub={userSub} onSignOut={onSignOut} />
      </aside>

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
          <SidebarBrand badge={badge} compact />
          <Button variant="ghost" size="sm" onClick={() => setMobileOpen(false)} className="text-muted-foreground">
            <RiCloseLine className="w-5 h-5" />
          </Button>
        </div>
        <SidebarNav pathname={pathname} hash={hash} items={navItems} label={navLabel} cta={cta} />
        <SidebarFooter userLabel={userLabel} userSub={userSub} onSignOut={onSignOut} />
      </aside>

      <main className="relative z-10 flex-1 flex flex-col min-w-0">
        <header className="h-14 flex items-center gap-2.5 px-4 sm:px-6 border-b border-[color:var(--hairline)] bg-card/90 backdrop-blur-md sticky top-0 z-30">
          <Button variant="ghost" size="sm" className="lg:hidden text-foreground" onClick={() => setMobileOpen(true)} aria-label="Open navigation">
            <RiMenuLine className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2.5 min-w-0">
            {active ? (
              <>
                <span className="w-7 h-7 rounded-lg text-[#6810FE] inline-flex items-center justify-center shrink-0 bg-[#F3EEFF]">
                  <active.icon className="w-4 h-4" />
                </span>
                <h1 className="text-[14px] font-semibold text-foreground truncate tracking-tight">{title || active.title}</h1>
                {(description || active.description) && (
                  <span className="hidden sm:inline text-[12.5px] text-muted-foreground truncate">{description || active.description}</span>
                )}
              </>
            ) : (
              <h1 className="text-[14px] font-semibold text-foreground">{title || badge}</h1>
            )}
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">{children}</div>
      </main>
    </div>
  );
}

function SidebarBrand({ badge, compact = false }: { badge: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2 px-4 h-16 border-b border-[color:var(--hairline)]", compact && "h-auto border-0 px-0")}>
      <img src="/novara-logo.png" alt="" className="h-8 w-8 rounded-[9px]" />
      <span className="whitespace-nowrap text-[14.5px] font-semibold tracking-[-0.02em] text-foreground">Novara Cleaning</span>
      <span className="rounded-md bg-[#F3EEFF] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.12em] text-[#5A1FD6]">{badge}</span>
    </div>
  );
}

function SidebarNav({
  pathname,
  hash,
  items,
  label,
  cta,
}: {
  pathname: string | null;
  hash: string;
  items: WorkspaceNavItem[];
  label: string;
  cta?: ReactNode;
}) {
  return (
    <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-0.5">
      <p className="px-3 pb-2 text-[10.5px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">{label}</p>
      {items.map((item) => {
        const isActive = isWorkspaceNavActive(pathname, item.url, hash);
        return (
          <Link
            key={item.url}
            href={item.url}
            data-tour={item.tourAnchor}
            aria-current={isActive ? "page" : undefined}
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
            <div className="flex-1 min-w-0">
              <p className="leading-tight tracking-tight">{item.title}</p>
              {item.description && (
                <p
                  className={cn(
                    "text-[11px] leading-tight truncate",
                    isActive ? "text-[#5A1FD6]/80 font-normal" : "text-muted-foreground/80 group-hover:text-muted-foreground",
                  )}
                >
                  {item.description}
                </p>
              )}
            </div>
            {item.badge && (
              <span className="text-[10px] font-semibold rounded-md px-1.5 py-0.5 bg-primary/15 text-primary">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
      {cta && <div className="pt-3 px-1">{cta}</div>}
    </nav>
  );
}

function SidebarFooter({
  userLabel,
  userSub,
  onSignOut,
}: {
  userLabel?: string | null;
  userSub?: string | null;
  onSignOut?: () => void;
}) {
  if (!userLabel && !onSignOut) return null;
  return (
    <div className="border-t border-[color:var(--hairline)] p-3 space-y-2">
      {userLabel && (
        <div className="px-3 py-2 rounded-lg surface-sunken border">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-bold">Signed in</p>
          <p className="text-sm text-foreground font-medium truncate">{userLabel}</p>
          {userSub && <p className="text-[11px] text-muted-foreground truncate">{userSub}</p>}
        </div>
      )}
      {onSignOut && (
        <Button variant="outline" size="sm" className="w-full justify-start gap-2" onClick={onSignOut}>
          <RiLogoutBoxRLine className="w-4 h-4" />
          Sign out
        </Button>
      )}
    </div>
  );
}
