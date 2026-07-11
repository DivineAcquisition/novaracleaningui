"use client";

// ─── Partnerships Hub — Accounts (the account-base view) ────────────────────
//
// ONE view of every partner account across all three lines of business:
// Commercial and Office (business_accounts) and STR hosts (hosts +
// properties + turnovers) — same list, same filters, same needs-attention
// language. Click any row for the type-appropriate detail:
//   • Commercial/Office → the account sheet (sites, go-live gates, rates,
//     agreement/payment actions, Airtable sync)
//   • STR host → the host sheet (properties + per-turnover rates, upcoming
//     and recent turnovers, revenue, pause/resume, calendar link)
//
// The deep dispatch queue (crew pinning, batches, assignment) stays in the
// Ops tab — this is where ACCOUNTS are managed.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiBuilding2Line,
  RiBuilding4Line,
  RiCalendarCheckLine,
  RiCheckboxCircleFill,
  RiErrorWarningLine,
  RiHomeSmile2Line,
  RiLoader4Line,
  RiMailSendLine,
  RiPauseCircleLine,
  RiPlayCircleLine,
  RiRefreshLine,
  RiSearch2Line,
} from "@remixicon/react";
import { format } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { sendCalendarLink } from "@/lib/partner-admin-api";
import { AccountSheet, attentionFlags, type AccountRow } from "@/views/admin/CommercialAccountsAdmin";
import { cn } from "@/lib/utils";

// ─── Unified row model ───────────────────────────────────────────────────────

interface UnifiedAccount {
  key: string;                       // "biz:<id>" | "host:<id>"
  kind: "commercial" | "office" | "str";
  id: string;
  name: string;
  contact: string;
  email: string | null;
  status: string;
  valueCents: number;                // commercial: monthly rate · STR: revenue this month
  valueLabel: string;
  meta: string;                      // facility/sites or properties/turnovers line
  lastActivity: string | null;
  flags: string[];
  raw: AccountRow | HostAccount;
}

interface HostAccount {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  status: string | null;
  stripe_customer_id?: string | null;
  default_payment_method_id?: string | null;
  created_at?: string;
  properties: PropertyRow[];
  turnoversThisMonth: number;
  revenueThisMonthCents: number;
  upcoming: TurnoverRow[];
  recent: TurnoverRow[];
}
interface PropertyRow {
  id: string;
  nickname: string | null;
  address: string | null;
  turnover_price: number | null;
  host_id: string;
}
interface TurnoverRow {
  id: string;
  property_id: string | null;
  requested_date: string | null;
  status: string | null;
  price: number | null;
  assigned_cleaner_id: string | null;
}

const KIND_STYLE: Record<string, string> = {
  commercial: "bg-blue-100 text-blue-700",
  office: "bg-cyan-100 text-cyan-700",
  str: "bg-fuchsia-100 text-fuchsia-700",
};
const STATUS_STYLE: Record<string, string> = {
  prospect: "bg-blue-100 text-blue-700",
  onboarding: "bg-amber-100 text-amber-700",
  active: "bg-emerald-100 text-emerald-700",
  paused: "bg-slate-100 text-slate-600",
  offboarded: "bg-rose-100 text-rose-600",
  blocked: "bg-rose-100 text-rose-600",
};
const money = (c: number) => `$${(c / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
const fmtD = (iso?: string | null) => (iso ? format(new Date(`${String(iso).slice(0, 10)}T12:00:00`), "MMM d") : "—");

export default function PartnershipAccounts() {
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<UnifiedAccount[]>([]);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [openBiz, setOpenBiz] = useState<AccountRow | null>(null);
  const [openHost, setOpenHost] = useState<HostAccount | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      const monthStartYmd = monthStart.toISOString().slice(0, 10);
      const todayYmd = new Date().toISOString().slice(0, 10);

      const [bizRes, hostRes, propRes, turnRes] = await Promise.all([
        (supabase.from as any)("business_accounts").select("*").order("last_activity_at", { ascending: false }).limit(500),
        (supabase.from as any)("hosts").select("id, name, email, phone, status, stripe_customer_id, default_payment_method_id, created_at").order("created_at", { ascending: false }).limit(500),
        (supabase.from as any)("properties").select("id, nickname, address, turnover_price, host_id").limit(2000),
        (supabase.from as any)("turnover_requests")
          .select("id, host_id, property_id, requested_date, status, price, assigned_cleaner_id")
          .gte("requested_date", new Date(Date.now() - 60 * 86400_000).toISOString().slice(0, 10))
          .order("requested_date", { ascending: true })
          .limit(3000),
      ]);

      const biz = (bizRes.data || []) as AccountRow[];
      const hosts = (hostRes.data || []) as Array<Omit<HostAccount, "properties" | "turnoversThisMonth" | "revenueThisMonthCents" | "upcoming" | "recent">>;
      const props = (propRes.data || []) as PropertyRow[];
      const turns = (turnRes.data || []) as Array<TurnoverRow & { host_id: string | null }>;

      const propsByHost = new Map<string, PropertyRow[]>();
      for (const p of props) {
        propsByHost.set(p.host_id, [...(propsByHost.get(p.host_id) || []), p]);
      }
      const turnsByHost = new Map<string, Array<TurnoverRow & { host_id: string | null }>>();
      for (const t of turns) {
        if (!t.host_id) continue;
        turnsByHost.set(t.host_id, [...(turnsByHost.get(t.host_id) || []), t]);
      }

      const unified: UnifiedAccount[] = [];

      for (const a of biz) {
        const flags = attentionFlags(a);
        unified.push({
          key: `biz:${a.id}`,
          kind: a.account_type === "office" ? "office" : "commercial",
          id: a.id,
          name: a.business_name,
          contact: a.contact_name || "—",
          email: a.email,
          status: a.status,
          valueCents: a.default_rate_cents || 0,
          valueLabel: a.default_rate_cents ? `${money(a.default_rate_cents)}/mo` : "no rate",
          meta: [a.facility_type, a.num_locations ? `${a.num_locations} location${a.num_locations === 1 ? "" : "s"}` : null, a.recurring_frequency].filter(Boolean).join(" · ") || "—",
          lastActivity: a.last_activity_at,
          flags,
          raw: a,
        });
      }

      for (const h of hosts) {
        const hProps = propsByHost.get(h.id) || [];
        const hTurns = turnsByHost.get(h.id) || [];
        const monthTurns = hTurns.filter((t) => (t.requested_date || "") >= monthStartYmd && t.status !== "cancelled");
        const revenueCents = monthTurns.reduce((s, t) => s + Math.round((Number(t.price) || 0) * 100), 0);
        const pendingPricing = hProps.filter((p) => p.turnover_price == null || Number(p.turnover_price) <= 0);
        const flags: string[] = [];
        if (String(h.status) !== "blocked") {
          if (pendingPricing.length > 0) flags.push(`${pendingPricing.length} propert${pendingPricing.length === 1 ? "y" : "ies"} pending pricing`);
          if (!h.default_payment_method_id && !h.stripe_customer_id) flags.push("No payment on file");
        }
        const host: HostAccount = {
          ...h,
          properties: hProps,
          turnoversThisMonth: monthTurns.length,
          revenueThisMonthCents: revenueCents,
          upcoming: hTurns.filter((t) => (t.requested_date || "") >= todayYmd && t.status !== "cancelled").slice(0, 10),
          recent: hTurns.filter((t) => (t.requested_date || "") < todayYmd).slice(-10).reverse(),
        };
        unified.push({
          key: `host:${h.id}`,
          kind: "str",
          id: h.id,
          name: h.name || h.email || "Host",
          contact: h.name || "—",
          email: h.email,
          status: String(h.status || "active"),
          valueCents: revenueCents,
          valueLabel: `${money(revenueCents)} this mo`,
          meta: `${hProps.length} propert${hProps.length === 1 ? "y" : "ies"} · ${monthTurns.length} turnover${monthTurns.length === 1 ? "" : "s"} this month`,
          lastActivity: hTurns.length ? hTurns[hTurns.length - 1].requested_date : h.created_at || null,
          flags,
          raw: host,
        });
      }

      unified.sort((a, b) => (b.lastActivity || "").localeCompare(a.lastActivity || ""));
      setRows(unified);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load accounts");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => rows.filter((r) => {
    if (typeFilter !== "all" && r.kind !== typeFilter) return false;
    if (statusFilter === "attention" && r.flags.length === 0) return false;
    if (statusFilter !== "all" && statusFilter !== "attention" && r.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${r.name} ${r.contact} ${r.email}`.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [rows, typeFilter, statusFilter, search]);

  const totals = useMemo(() => ({
    commercial: rows.filter((r) => r.kind !== "str" && r.status === "active").reduce((s, r) => s + r.valueCents, 0),
    str: rows.filter((r) => r.kind === "str").reduce((s, r) => s + r.valueCents, 0),
    attention: rows.filter((r) => r.flags.length > 0).length,
  }), [rows]);

  return (
    <div className="space-y-3">
      {/* One-line portfolio strip */}
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-blue-700 font-semibold">
          Commercial+Office: {money(totals.commercial)}/mo contracted
        </span>
        <span className="rounded-full bg-fuchsia-50 border border-fuchsia-200 px-2.5 py-1 text-fuchsia-700 font-semibold">
          STR: {money(totals.str)} this month
        </span>
        {totals.attention > 0 && (
          <span className="rounded-full bg-amber-50 border border-amber-300 px-2.5 py-1 text-amber-700 font-semibold">
            ⚠ {totals.attention} account{totals.attention === 1 ? "" : "s"} need attention
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <RiSearch2Line className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <Input placeholder="Search account, contact, email…" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
        </div>
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="commercial">Commercial</SelectItem>
            <SelectItem value="office">Office</SelectItem>
            <SelectItem value="str">STR / Airbnb</SelectItem>
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="attention">⚠ Needs attention</SelectItem>
            {["prospect", "onboarding", "active", "paused", "offboarded"].map((s) => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RiRefreshLine className={cn("w-4 h-4", loading && "animate-spin")} />
        </Button>
      </div>

      {loading ? (
        <div className="space-y-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}</div>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-sm text-slate-500">No accounts match.</CardContent></Card>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => (
            <button
              key={r.key}
              onClick={() => r.kind === "str" ? setOpenHost(r.raw as HostAccount) : setOpenBiz(r.raw as AccountRow)}
              className={cn(
                "w-full text-left rounded-xl border bg-white px-4 py-3 hover:border-violet-300 hover:shadow-sm transition-all",
                r.flags.length > 0 ? "border-amber-300" : "border-slate-200",
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                {r.kind === "str" ? <RiHomeSmile2Line className="w-4 h-4 text-fuchsia-600" />
                  : r.kind === "office" ? <RiBuilding4Line className="w-4 h-4 text-cyan-600" />
                  : <RiBuilding2Line className="w-4 h-4 text-blue-600" />}
                <span className="font-semibold text-slate-900">{r.name}</span>
                <Badge className={cn("border-0 capitalize", KIND_STYLE[r.kind])}>{r.kind === "str" ? "STR / Airbnb" : r.kind}</Badge>
                <Badge className={cn("border-0 capitalize", STATUS_STYLE[r.status] || "bg-slate-100 text-slate-600")}>{r.status}</Badge>
                <span className="ml-auto text-sm font-semibold text-slate-700">{r.valueLabel}</span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {r.contact} · {r.email || "no email"} · {r.meta} · last activity {fmtD(r.lastActivity)}
              </p>
              {r.flags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {r.flags.map((f) => (
                    <span key={f} className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-700">⚠ {f}</span>
                  ))}
                </div>
              )}
            </button>
          ))}
        </div>
      )}

      {openBiz && <AccountSheet account={openBiz} onClose={() => setOpenBiz(null)} reload={load} />}
      {openHost && <HostSheet host={openHost} onClose={() => setOpenHost(null)} reload={load} />}
    </div>
  );
}

// ─── STR host detail sheet (account view of the turnover business) ──────────

function HostSheet({ host, onClose, reload }: { host: HostAccount; onClose: () => void; reload: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [priceEdits, setPriceEdits] = useState<Record<string, string>>({});

  const propName = (id: string | null) =>
    host.properties.find((p) => p.id === id)?.nickname || "Property";

  const setStatus = async (status: "active" | "paused") => {
    setBusy("status");
    try {
      const { error } = await (supabase.from as any)("hosts").update({ status }).eq("id", host.id);
      if (error) throw error;
      toast.success(status === "active" ? "Host resumed" : "Host paused");
      await reload();
      onClose();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const savePrice = async (propertyId: string) => {
    const raw = priceEdits[propertyId];
    const val = parseFloat(raw);
    if (!Number.isFinite(val) || val <= 0) { toast.error("Enter a valid rate"); return; }
    setBusy(`price-${propertyId}`);
    try {
      const { error } = await (supabase.from as any)("properties").update({ turnover_price: val }).eq("id", propertyId);
      if (error) throw error;
      toast.success("Rate set — property is bookable");
      setPriceEdits((p) => ({ ...p, [propertyId]: "" }));
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Rate update failed");
    } finally {
      setBusy(null);
    }
  };

  const sendSchedulerLink = async () => {
    if (!host.email) { toast.error("Host has no email"); return; }
    setBusy("link");
    try {
      await sendCalendarLink({ email: host.email, name: host.name || undefined, phone: host.phone || undefined });
      toast.success("Scheduler link sent (SMS + email)");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Send failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <RiHomeSmile2Line className="w-5 h-5 text-fuchsia-600" /> {host.name || host.email}
          </SheetTitle>
          <SheetDescription>
            {host.email} · {host.phone || "no phone"} · {host.properties.length} propert{host.properties.length === 1 ? "y" : "ies"} ·
            {" "}{host.turnoversThisMonth} turnovers / {money(host.revenueThisMonthCents)} this month
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          {/* Actions */}
          <div className="flex flex-wrap gap-2">
            {String(host.status) === "paused" ? (
              <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-700" disabled={!!busy} onClick={() => void setStatus("active")}>
                {busy === "status" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RiPlayCircleLine className="w-3.5 h-3.5 mr-1" />} Resume host
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="border-amber-300 text-amber-700" disabled={!!busy} onClick={() => void setStatus("paused")}>
                {busy === "status" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RiPauseCircleLine className="w-3.5 h-3.5 mr-1" />} Pause host
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={!!busy} onClick={() => void sendSchedulerLink()}>
              {busy === "link" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RiMailSendLine className="w-3.5 h-3.5 mr-1" />} Send scheduler link
            </Button>
          </div>

          {/* Gates */}
          <div className="flex flex-wrap gap-1.5">
            <Badge className={cn("border-0", host.default_payment_method_id || host.stripe_customer_id ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")}>
              {host.default_payment_method_id || host.stripe_customer_id ? "✓ Payment on file" : "No payment on file"}
            </Badge>
            <Badge className={cn("border-0 capitalize", STATUS_STYLE[String(host.status)] || "bg-slate-100")}>{String(host.status || "active")}</Badge>
          </div>

          {/* Properties + rates */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-2">
            <p className="text-xs font-bold text-slate-800">Properties & per-turnover rates</p>
            {host.properties.length === 0 && <p className="text-xs text-slate-500">No properties on file.</p>}
            {host.properties.map((p) => {
              const priced = p.turnover_price != null && Number(p.turnover_price) > 0;
              return (
                <div key={p.id} className={cn("rounded-md border px-2.5 py-2", priced ? "border-slate-200" : "border-rose-200 bg-rose-50/40")}>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-slate-800">{p.nickname || p.address || "Property"}</span>
                    {priced
                      ? <Badge className="bg-emerald-100 text-emerald-700 border-0 ml-auto">${Number(p.turnover_price).toFixed(0)}/turnover</Badge>
                      : <Badge className="bg-rose-100 text-rose-700 border-0 ml-auto">pending pricing</Badge>}
                  </div>
                  {p.address && <p className="text-[11px] text-slate-400 mt-0.5">{p.address}</p>}
                  <div className="flex gap-1.5 mt-1.5">
                    <Input
                      type="number" min={0} placeholder={priced ? `${Number(p.turnover_price).toFixed(0)}` : "Set rate ($)"}
                      value={priceEdits[p.id] || ""}
                      onChange={(e) => setPriceEdits((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      className="h-7 text-xs w-32"
                    />
                    <Button size="sm" className="h-7 text-xs" disabled={!priceEdits[p.id] || busy === `price-${p.id}`} onClick={() => void savePrice(p.id)}>
                      {busy === `price-${p.id}` ? <RiLoader4Line className="w-3 h-3 animate-spin" /> : "Set rate"}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Upcoming turnovers */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
            <p className="text-xs font-bold text-slate-800 flex items-center gap-1">
              <RiCalendarCheckLine className="w-3.5 h-3.5 text-violet-600" /> Upcoming turnovers
            </p>
            {host.upcoming.length === 0 && <p className="text-xs text-slate-500">None scheduled.</p>}
            {host.upcoming.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{fmtD(t.requested_date)}</span>
                <span>{propName(t.property_id)}</span>
                <Badge variant="outline" className="ml-auto capitalize">{t.status}</Badge>
                {t.assigned_cleaner_id
                  ? <RiCheckboxCircleFill className="w-3.5 h-3.5 text-emerald-500" />
                  : <RiErrorWarningLine className="w-3.5 h-3.5 text-amber-500" />}
                <span className="font-semibold">{t.price != null ? `$${Number(t.price).toFixed(0)}` : "—"}</span>
              </div>
            ))}
          </div>

          {/* Recent history */}
          <div className="rounded-lg border border-slate-200 p-3 space-y-1.5">
            <p className="text-xs font-bold text-slate-800">Recent turnovers</p>
            {host.recent.length === 0 && <p className="text-xs text-slate-500">No recent history.</p>}
            {host.recent.map((t) => (
              <div key={t.id} className="flex items-center gap-2 text-xs text-slate-600">
                <span className="font-semibold text-slate-800">{fmtD(t.requested_date)}</span>
                <span>{propName(t.property_id)}</span>
                <Badge variant="outline" className="ml-auto capitalize">{t.status}</Badge>
                <span className="font-semibold">{t.price != null ? `$${Number(t.price).toFixed(0)}` : "—"}</span>
              </div>
            ))}
          </div>

          <p className="text-[11px] text-slate-400">
            Crew pinning, assignments, and batch payments live in the Ops tab. Turnovers booked through Book Job flow through the standard dispatch + QC pipeline.
          </p>
        </div>
      </SheetContent>
    </Sheet>
  );
}
