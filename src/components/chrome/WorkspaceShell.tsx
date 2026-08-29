"use client";

import type { ComponentType, ReactNode } from "react";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { RiCloseLine, RiLogoutBoxRLine, RiMenuLine } from "@remixicon/react";

import { BrandAtmosphere } from "@/components/brand/atmosphere";
import { Button } from "@/components/ui/button";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

export type WorkspaceNavItem = {
  title: string;
  url: string;
  icon: ComponentType<{ className?: string }>;
  description?: string;
  badge?: string;
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
    <div className="relative min-h-screen flex w-full bg-background text-foreground font-sans">
      <BrandAtmosphere />
      <aside className="relative z-10 hidden lg:flex w-64 flex-col border-r border-[color:var(--hairline)] bg-card/70 backdrop-blur-xl shrink-0">
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
          "lg:hidden fixed inset-y-0 left-0 z-50 w-72 flex-col bg-card/95 backdrop-blur-xl border-r border-[color:var(--hairline)] transition-transform",
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
        <header className="h-14 flex items-center gap-3 px-4 sm:px-6 border-b border-[color:var(--hairline)] bg-background/80 backdrop-blur-xl sticky top-0 z-30 hairline-glow">
          <Button variant="ghost" size="sm" className="lg:hidden text-foreground" onClick={() => setMobileOpen(true)}>
            <RiMenuLine className="w-5 h-5" />
          </Button>
          <div className="flex items-center gap-2 min-w-0">
            {active ? (
              <>
                <span className="w-7 h-7 rounded-lg text-primary inline-flex items-center justify-center shrink-0 bg-brand-50">
                  <active.icon className="w-4 h-4" />
                </span>
                <h1 className="font-heading text-sm font-semibold text-foreground truncate tracking-tight">
                  {title || active.title}
                </h1>
                {(description || active.description) && (
                  <span className="hidden sm:inline text-xs text-muted-foreground truncate">
                    · {description || active.description}
                  </span>
                )}
              </>
            ) : (
              <h1 className="font-heading text-sm font-semibold text-foreground">{title || badge}</h1>
            )}
          </div>
        </header>
        <div className="flex-1 overflow-auto p-4 sm:p-6">{children}</div>
      </main>
    </div>
  );
}

function SidebarBrand({ badge, compact = false }: { badge: string; compact?: boolean }) {
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
        {badge}
      </span>
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
      <p className="px-3 pb-2 text-[10px] uppercase tracking-[0.14em] text-muted-foreground font-semibold">{label}</p>
      {items.map((item) => {
        const isActive = isWorkspaceNavActive(pathname, item.url, hash);
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
              <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full" style={{ background: BRAND.gradient }} />
            )}
            <span
              className={cn(
                "w-8 h-8 rounded-md flex items-center justify-center transition-all",
                isActive
                  ? "text-white shadow-[0_2px_6px_-1px_rgba(92,15,254,0.5)]"
                  : "bg-muted text-muted-foreground group-hover:bg-brand-50 group-hover:text-primary",
              )}
              style={isActive ? { background: BRAND.gradient } : undefined}
            >
              <item.icon className="w-4 h-4" />
            </span>
            <div className="flex-1 min-w-0">
              <p className="leading-tight tracking-tight">{item.title}</p>
              {item.description && (
                <p
                  className={cn(
                    "text-[11px] leading-tight truncate",
                    isActive ? "text-primary/70" : "text-muted-foreground/80 group-hover:text-muted-foreground",
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
        <div className="px-3 py-2 rounded-lg surface-sunken">
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
