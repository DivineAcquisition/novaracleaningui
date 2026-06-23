"use client";

// ─── /admin/partner-accounts — STR Partner Account Management (Admin) ─────────
//
// The admin console for managing STR host partners across their lifecycle (spec:
// str-partner-management-spec). Hosts request turnovers in the portal; admins
// MANAGE here. Three layers:
//   1. "Needs Attention" dashboard (spec §6) — the proactive daily to-do queue.
//   2. Portfolio totals (spec §7) — active hosts, properties, STR revenue MTD.
//   3. Host list (spec §3) — filterable, "needs attention" floats to the top.
// Clicking a host opens the full account page (HostDetailSheet, spec §4/§5).
//
// All data is read from / written to the Airtable "Client & Revenue Ops" base
// via the admin-gated /api/partner-admin/* routes — the PAT stays server-side.

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  RiLoader4Line, RiRefreshLine, RiSearchLine, RiAlertLine, RiPriceTag3Line,
  RiBankCard2Line, RiFileTextLine, RiErrorWarningLine, RiTimerFlashLine,
  RiZzzLine, RiMoneyDollarCircleLine, RiHotelLine, RiBuilding2Line, RiArrowRightLine,
} from "@remixicon/react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { fetchHosts, type DashboardData, type HostListItem } from "@/lib/partner-admin-api";
import { HostDetailSheet } from "@/components/admin/HostDetailSheet";

const money = (n: number | null | undefined) =>
  `$${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

type AttentionFilter =
  | "all"
  | "pendingPricing"
  | "missingPayment"
  | "agreementUnsigned"
  | "failedPayment"
  | "introExpiring"
  | "noRecentTurnover";

const LIFECYCLE_TONE: Record<string, string> = {
  Active: "bg-emerald-100 text-emerald-700",
  Onboarding: "bg-blue-100 text-blue-700",
  Paused: "bg-amber-100 text-amber-700",
  Churned: "bg-slate-100 text-slate-500",
  Lead: "bg-violet-100 text-violet-700",
};

export default function PartnerAccounts() {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [hosts, setHosts] = useState<HostListItem[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AttentionFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const data = await fetchHosts(refresh);
      setHosts(data.hosts);
      setDashboard(data.dashboard);
    } catch (err) {
      toast.error((err as Error).message || "Could not load hosts.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return hosts.filter((h) => {
      if (filter !== "all") {
        if (filter === "pendingPricing" && !h.flags.pendingPricing) return false;
        if (filter === "missingPayment" && !h.flags.missingPayment) return false;
        if (filter === "agreementUnsigned" && !h.flags.agreementUnsigned) return false;
        if (filter === "failedPayment" && !h.flags.failedPayment) return false;
        if (filter === "introExpiring" && !h.flags.introExpiring) return false;
        if (filter === "noRecentTurnover" && !h.flags.noRecentTurnover) return false;
      }
      if (!q) return true;
      const hay = `${h.name || ""} ${h.company || ""} ${h.email || ""} ${h.phone || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [hosts, search, filter]);

  const portfolio = dashboard?.portfolio;

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <RiLoader4Line className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-1 sm:px-4 py-2 space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">STR Host Accounts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage host partners — pricing, go-live, pauses, revenue, and at-risk accounts.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load(true)} disabled={refreshing}>
          <RiRefreshLine className={cn("w-4 h-4 mr-1.5", refreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {/* Portfolio totals (spec §7) */}
      {portfolio && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <StatCard icon={<RiHotelLine className="w-4 h-4" />} label="Active hosts" value={`${portfolio.activeHosts}/${portfolio.totalHosts}`} />
          <StatCard icon={<RiBuilding2Line className="w-4 h-4" />} label="Properties" value={String(portfolio.totalProperties)} />
          <StatCard icon={<RiPriceTag3Line className="w-4 h-4" />} label="Active props" value={String(portfolio.activeProperties)} />
          <StatCard icon={<RiAlertLine className="w-4 h-4 text-amber-500" />} label="Pending pricing" value={String(portfolio.pendingPricingProperties)} />
          <StatCard icon={<RiMoneyDollarCircleLine className="w-4 h-4 text-emerald-500" />} label="Revenue MTD" value={money(portfolio.strRevenueThisMonth)} />
          <StatCard icon={<RiTimerFlashLine className="w-4 h-4" />} label="Turnovers MTD" value={String(portfolio.turnoversThisMonth)} />
        </div>
      )}

      {/* Needs Attention dashboard (spec §6) */}
      {dashboard && (
        <NeedsAttention
          dashboard={dashboard}
          onOpenHost={(id) => setSelectedId(id)}
          onFilter={(f) => setFilter(f)}
        />
      )}

      {/* Host list (spec §3) */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <RiHotelLine className="w-5 h-5 text-primary" /> Hosts ({filtered.length})
          </CardTitle>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <div className="relative flex-1 min-w-[200px]">
              <RiSearchLine className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                className="pl-8 h-9"
                placeholder="Search name / company / email / phone…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-2">
            <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>All</FilterChip>
            <FilterChip active={filter === "pendingPricing"} onClick={() => setFilter("pendingPricing")} tone="amber">Pending pricing</FilterChip>
            <FilterChip active={filter === "missingPayment"} onClick={() => setFilter("missingPayment")} tone="amber">No payment method</FilterChip>
            <FilterChip active={filter === "agreementUnsigned"} onClick={() => setFilter("agreementUnsigned")} tone="amber">Agreement unsigned</FilterChip>
            <FilterChip active={filter === "failedPayment"} onClick={() => setFilter("failedPayment")} tone="rose">Failed / unpaid</FilterChip>
            <FilterChip active={filter === "introExpiring"} onClick={() => setFilter("introExpiring")} tone="violet">Intro expiring</FilterChip>
            <FilterChip active={filter === "noRecentTurnover"} onClick={() => setFilter("noRecentTurnover")} tone="slate">At-risk (30d+)</FilterChip>
          </div>
        </CardHeader>
        <CardContent className="space-y-1.5">
          {filtered.length === 0 && <p className="text-sm text-muted-foreground py-4">No hosts match your filters.</p>}
          {filtered.map((h) => (
            <button
              key={h.id}
              onClick={() => setSelectedId(h.id)}
              className="w-full text-left flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 hover:border-primary/40 hover:bg-slate-50 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-medium truncate">{h.name || h.email || "Host"}</p>
                  {h.lifecycleStage && (
                    <Badge className={cn("text-[10px]", LIFECYCLE_TONE[h.lifecycleStage] || "bg-slate-100 text-slate-600")}>
                      {h.lifecycleStage}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {[h.company, h.email, h.phone].filter(Boolean).join(" · ") || "—"}
                </p>
                <div className="flex flex-wrap items-center gap-1 mt-1">
                  {h.flags.pendingPricing && <MiniFlag tone="amber">{h.pendingPricingCount} pending pricing</MiniFlag>}
                  {h.flags.missingPayment && <MiniFlag tone="amber">no payment</MiniFlag>}
                  {h.flags.agreementUnsigned && <MiniFlag tone="amber">unsigned</MiniFlag>}
                  {h.flags.failedPayment && <MiniFlag tone="rose">failed/unpaid</MiniFlag>}
                  {h.flags.introExpiring && <MiniFlag tone="violet">intro ending</MiniFlag>}
                  {h.flags.noRecentTurnover && <MiniFlag tone="slate">at-risk</MiniFlag>}
                </div>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div className="hidden sm:block">
                  <p className="text-xs text-muted-foreground">Props</p>
                  <p className="text-sm font-semibold tabular-nums">{h.propertyCount}</p>
                </div>
                <div className="hidden sm:block">
                  <p className="text-xs text-muted-foreground">Turns MTD</p>
                  <p className="text-sm font-semibold tabular-nums">{h.stats.turnoversThisMonth}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Rev MTD</p>
                  <p className="text-sm font-semibold tabular-nums">{money(h.stats.revenueThisMonth)}</p>
                </div>
                <RiArrowRightLine className="w-4 h-4 text-muted-foreground" />
              </div>
            </button>
          ))}
        </CardContent>
      </Card>

      <HostDetailSheet
        hostId={selectedId}
        onClose={() => setSelectedId(null)}
        onMutated={() => load(true)}
      />
    </div>
  );
}

// ─── Needs Attention dashboard ───────────────────────────────────────────────

function NeedsAttention({
  dashboard,
  onOpenHost,
  onFilter,
}: {
  dashboard: DashboardData;
  onOpenHost: (id: string) => void;
  onFilter: (f: AttentionFilter) => void;
}) {
  const a = dashboard.attention;
  const total =
    a.pendingPricing.length +
    a.missingPayment.length +
    a.unsignedAgreement.length +
    a.failedPayment.length +
    a.introExpiring.length +
    a.noRecentTurnover.length;

  if (total === 0) {
    return (
      <Card className="border-emerald-200">
        <CardContent className="p-4 flex items-center gap-2 text-sm text-emerald-700">
          <RiAlertLine className="w-4 h-4" /> Nothing needs attention right now.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-amber-200">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2 text-amber-700">
          <RiAlertLine className="w-5 h-5" /> Needs attention ({total})
        </CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <AttentionBucket
          icon={<RiPriceTag3Line className="w-4 h-4" />}
          title="Properties pending pricing"
          tone="amber"
          items={a.pendingPricing.map((p) => ({
            id: p.hostId,
            label: p.nickname || "Property",
            sub: `${p.hostName || "Host"}${p.detail ? ` · ${p.detail}` : ""}`,
          }))}
          onOpen={onOpenHost}
          onSeeAll={() => onFilter("pendingPricing")}
        />
        <AttentionBucket
          icon={<RiBankCard2Line className="w-4 h-4" />}
          title="Missing payment method"
          tone="amber"
          items={a.missingPayment.map((h) => ({ id: h.hostId, label: h.hostName || h.email || "Host", sub: h.email || "" }))}
          onOpen={onOpenHost}
          onSeeAll={() => onFilter("missingPayment")}
        />
        <AttentionBucket
          icon={<RiFileTextLine className="w-4 h-4" />}
          title="Agreements unsigned"
          tone="amber"
          items={a.unsignedAgreement.map((h) => ({ id: h.hostId, label: h.hostName || h.email || "Host", sub: h.email || "" }))}
          onOpen={onOpenHost}
          onSeeAll={() => onFilter("agreementUnsigned")}
        />
        <AttentionBucket
          icon={<RiErrorWarningLine className="w-4 h-4" />}
          title="Failed / unpaid payments"
          tone="rose"
          items={a.failedPayment.map((h) => ({ id: h.hostId, label: h.hostName || h.email || "Host", sub: h.email || "" }))}
          onOpen={onOpenHost}
          onSeeAll={() => onFilter("failedPayment")}
        />
        <AttentionBucket
          icon={<RiTimerFlashLine className="w-4 h-4" />}
          title="Intro rates expiring (7d)"
          tone="violet"
          items={a.introExpiring.map((p) => ({
            id: p.hostId,
            label: p.nickname || "Property",
            sub: `${p.hostName || "Host"}${p.detail ? ` · ${p.detail}` : ""}`,
          }))}
          onOpen={onOpenHost}
          onSeeAll={() => onFilter("introExpiring")}
        />
        <AttentionBucket
          icon={<RiZzzLine className="w-4 h-4" />}
          title="At-risk · no turnover 30d+"
          tone="slate"
          items={a.noRecentTurnover.map((h) => ({ id: h.hostId, label: h.hostName || h.email || "Host", sub: h.detail || "" }))}
          onOpen={onOpenHost}
          onSeeAll={() => onFilter("noRecentTurnover")}
        />
      </CardContent>
    </Card>
  );
}

function AttentionBucket({
  icon,
  title,
  tone,
  items,
  onOpen,
  onSeeAll,
}: {
  icon: React.ReactNode;
  title: string;
  tone: "amber" | "rose" | "violet" | "slate";
  items: { id: string; label: string; sub: string }[];
  onOpen: (id: string) => void;
  onSeeAll: () => void;
}) {
  const toneCls = {
    amber: "text-amber-700",
    rose: "text-rose-700",
    violet: "text-violet-700",
    slate: "text-slate-600",
  }[tone];

  return (
    <div className="rounded-lg border bg-white p-3">
      <div className={cn("flex items-center justify-between gap-2 mb-2 text-sm font-semibold", toneCls)}>
        <span className="flex items-center gap-1.5">{icon} {title}</span>
        <span className="text-xs font-normal text-muted-foreground">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Clear.</p>
      ) : (
        <div className="space-y-1">
          {items.slice(0, 5).map((it, i) => (
            <button
              key={`${it.id}-${i}`}
              onClick={() => onOpen(it.id)}
              className="w-full text-left rounded-md px-2 py-1.5 hover:bg-slate-50 transition-colors"
            >
              <p className="text-sm font-medium truncate">{it.label}</p>
              {it.sub && <p className="text-[11px] text-muted-foreground truncate">{it.sub}</p>}
            </button>
          ))}
          {items.length > 5 && (
            <button onClick={onSeeAll} className="text-xs text-primary hover:underline px-2">
              See all {items.length} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Small UI atoms ──────────────────────────────────────────────────────────

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">{icon}{label}</div>
        <p className="text-lg font-bold mt-1 tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  tone = "slate",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "slate" | "amber" | "rose" | "violet";
}) {
  const activeTone = {
    slate: "bg-slate-900 text-white border-slate-900",
    amber: "bg-amber-500 text-white border-amber-500",
    rose: "bg-rose-500 text-white border-rose-500",
    violet: "bg-violet-500 text-white border-violet-500",
  }[tone];
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-full text-xs border transition-colors",
        active ? activeTone : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50",
      )}
    >
      {children}
    </button>
  );
}

function MiniFlag({ tone, children }: { tone: "amber" | "rose" | "violet" | "slate"; children: React.ReactNode }) {
  const cls = {
    amber: "bg-amber-50 text-amber-700 border-amber-200",
    rose: "bg-rose-50 text-rose-700 border-rose-200",
    violet: "bg-violet-50 text-violet-700 border-violet-200",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
  }[tone];
  return <span className={cn("text-[10px] px-1.5 py-0.5 rounded border", cls)}>{children}</span>;
}
