"use client";

// ─── /admin/pricing — Dynamic Zone & Demand Pricing control room ───────────
//
// Admin-only (admin_strict). Five surfaces:
//
//   1. Zones       — multipliers, status, minimums, zip mapping, and per-zone
//                    performance (volume, avg value, coverage, win rate) so
//                    multipliers are tuned against evidence, not guessed.
//   2. Demand      — master switch, shadow mode, bounds, rate limit, input
//                    weights, peak periods.
//   3. Guardrails  — condition multipliers, floor inputs (min hourly), ceiling,
//                    VA override band, quote-lock window; derived floor table
//                    per service/band.
//   4. Base tables — the UNRESOLVED two-price-tables discrepancy, surfaced
//                    until admin confirms which is authoritative.
//   5. Commercial  — the separate commercial model (facility type × scope
//                    level × size tier), its walkthrough threshold, and the
//                    crew-sizing tunables.
//   6. Reports     — shadow comparison (charged vs would-be), clamp alerts,
//                    override activity per VA, audit log.
//
// Every config save INSERTS A NEW VERSION (immutable history) — historical
// quotes keep pointing at the version that priced them, so any past price is
// reconstructable exactly.

import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { toast } from "sonner";
import {
  RiAlarmWarningLine,
  RiBuilding2Line,
  RiCloseLine,
  RiEyeLine,
  RiHistoryLine,
  RiLoader4Line,
  RiMapPin2Line,
  RiScales3Line,
  RiShieldCheckLine,
  RiTableLine,
} from "@remixicon/react";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import CommercialPricing from "@/views/admin/CommercialPricing";
import { SEO } from "@/components/SEO";
import { cn } from "@/lib/utils";
import {
  computeFloorCents,
  type DynamicPricingConfig,
  type QuoteBreakdown,
} from "@/lib/dynamic-pricing";
import { HOME_SIZE_RANGES } from "@/lib/pricing";

// deno-lint-ignore no-explicit-any
const db = supabase as any;

const fmtMoney = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const centsToInput = (cents: number | null | undefined) =>
  cents == null ? "" : (cents / 100).toFixed(2);

interface ZoneRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  multiplier: number;
  status: "active" | "surcharge_only" | "not_served";
  min_job_value_cents: number | null;
  travel_minutes: number | null;
  is_default: boolean;
}

interface OverrideRow {
  id: string;
  created_at: string;
  quote_id: string | null;
  booking_id: string | null;
  va_name: string;
  original_cents: number;
  override_cents: number;
  delta_percent: number;
  direction: string;
  reason_code: string;
  note: string | null;
  status: string;
  decided_by: string | null;
}

interface AuditRow {
  id: string;
  created_at: string;
  zip: string | null;
  zone_code: string | null;
  service_type: string | null;
  home_size_id: string | null;
  condition: string | null;
  service_date: string | null;
  breakdown: QuoteBreakdown;
  config_version: number | null;
  demand_mode: string | null;
  demand_multiplier: number | null;
  shadow_demand_multiplier: number | null;
  floor_clamped: boolean;
  ceiling_clamped: boolean;
  final_cents: number | null;
  charged_cents: number | null;
  quoted_by: string | null;
  booking_id: string | null;
}

/** What reactive pricing WOULD have charged, reconstructed exactly from the
 *  stored breakdown (service portion re-scaled by the shadow multiplier). */
function shadowWouldCharge(a: AuditRow): number | null {
  const b = a.breakdown;
  if (!b || !b.ok) return null;
  const applied = b.demandMultiplier || 1;
  const shadow = b.shadowDemandMultiplier || 1;
  if (applied === shadow) return b.totalCents;
  const preDemand = applied !== 0 ? b.serviceTotalCents / applied : b.serviceTotalCents;
  return Math.round(preDemand * shadow) + b.addOnsCents + b.surchargesCents;
}

export default function DynamicPricing() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [configVersion, setConfigVersion] = useState<number | null>(null);
  const [config, setConfig] = useState<DynamicPricingConfig | null>(null);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [zipCounts, setZipCounts] = useState<Record<string, number>>({});
  const [zipToZone, setZipToZone] = useState<Record<string, string>>({});
  const [payRates, setPayRates] = useState({ soloFoundationPercent: 35, crewFoundationPercent: 40 });
  const [overrides, setOverrides] = useState<OverrideRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [versions, setVersions] = useState<Array<{ version: number; created_at: string; note: string | null; created_by: string | null; is_active: boolean }>>([]);
  const [zoneStats, setZoneStats] = useState<Record<string, { jobs: number; avgCents: number; quotes: number; converted: number; cleaners: number | null }>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [cfgRes, zonesRes, zipRes, ratesRes, ovRes, auditRes, verRes] = await Promise.all([
        db.from("dynamic_pricing_config_versions").select("version, config").eq("is_active", true).maybeSingle(),
        db.from("pricing_zones").select("*").order("code"),
        db.from("pricing_zone_zips").select("zip, zone_id"),
        db.from("cleaner_pay_rates").select("min_crew_size, max_crew_size, rate_percent").eq("pay_tier", "foundation"),
        db.from("price_overrides").select("*").order("created_at", { ascending: false }).limit(300),
        db.from("price_quote_audit").select("*").order("created_at", { ascending: false }).limit(300),
        db.from("dynamic_pricing_config_versions").select("version, created_at, note, created_by, is_active").order("version", { ascending: false }).limit(25),
      ]);
      if (cfgRes.data?.config) {
        setConfig(cfgRes.data.config as DynamicPricingConfig);
        setConfigVersion(Number(cfgRes.data.version));
      }
      const zoneRows: ZoneRow[] = (zonesRes.data || []).map((z: Record<string, unknown>) => ({
        ...z,
        multiplier: Number(z.multiplier),
      })) as ZoneRow[];
      setZones(zoneRows);
      const counts: Record<string, number> = {};
      const map: Record<string, string> = {};
      for (const r of zipRes.data || []) {
        counts[r.zone_id] = (counts[r.zone_id] || 0) + 1;
        map[r.zip] = r.zone_id;
      }
      setZipCounts(counts);
      setZipToZone(map);
      const rates = { soloFoundationPercent: 35, crewFoundationPercent: 40 };
      for (const r of ratesRes.data || []) {
        const min = Number(r.min_crew_size);
        const max = r.max_crew_size == null ? Infinity : Number(r.max_crew_size);
        if (min <= 1 && 1 <= max) rates.soloFoundationPercent = Number(r.rate_percent);
        if (min <= 2 && 2 <= max) rates.crewFoundationPercent = Number(r.rate_percent);
      }
      setPayRates(rates);
      setOverrides((ovRes.data || []) as OverrideRow[]);
      setAudit((auditRes.data || []) as AuditRow[]);
      setVersions(verRes.data || []);

      // Per-zone performance (last 90 days): volume + avg value from bookings,
      // win rate from va_quotes, live coverage from cleaners.
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString();
      const [bookRes, quoteRes] = await Promise.all([
        db.from("bookings").select("zip_code, zone_code, total_estimate_cents").gte("created_at", since).limit(5000),
        db.from("va_quotes").select("zone_code, status").gte("created_at", since).limit(5000),
      ]);
      const stats: Record<string, { jobs: number; avgCents: number; quotes: number; converted: number; cleaners: number | null }> = {};
      const byId: Record<string, ZoneRow> = Object.fromEntries(zoneRows.map((z) => [z.id, z]));
      const codeFor = (zip: string | null, zoneCode: string | null): string | null => {
        if (zoneCode) return zoneCode;
        if (zip && map[zip]) return byId[map[zip]]?.code || null;
        return null;
      };
      for (const z of zoneRows) stats[z.code] = { jobs: 0, avgCents: 0, quotes: 0, converted: 0, cleaners: null };
      const sums: Record<string, number> = {};
      for (const b of bookRes.data || []) {
        const code = codeFor(b.zip_code, b.zone_code);
        if (!code || !stats[code]) continue;
        stats[code].jobs += 1;
        sums[code] = (sums[code] || 0) + (Number(b.total_estimate_cents) || 0);
      }
      for (const code of Object.keys(stats)) {
        if (stats[code].jobs > 0) stats[code].avgCents = Math.round(sums[code] / stats[code].jobs);
      }
      for (const q of quoteRes.data || []) {
        if (!q.zone_code || !stats[q.zone_code]) continue;
        stats[q.zone_code].quotes += 1;
        if (q.status === "converted") stats[q.zone_code].converted += 1;
      }
      // Coverage: cleaners whose service zips overlap each zone.
      await Promise.all(
        zoneRows.map(async (z) => {
          const zipsForZone = Object.entries(map).filter(([, zid]) => zid === z.id).map(([zip]) => zip);
          if (zipsForZone.length === 0) return;
          const { count } = await db
            .from("cleaners")
            .select("id", { count: "exact", head: true })
            .eq("status", "active")
            .overlaps("service_zip_codes", zipsForZone.slice(0, 200));
          stats[z.code].cleaners = typeof count === "number" ? count : null;
        }),
      );
      setZoneStats(stats);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load pricing configuration.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // ── Config versioning: every save is a NEW immutable version ────────────
  const saveConfig = async (next: DynamicPricingConfig, note: string) => {
    setSaving(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      await db.from("dynamic_pricing_config_versions").update({ is_active: false }).eq("is_active", true);
      const { data, error } = await db
        .from("dynamic_pricing_config_versions")
        .insert({ config: next, is_active: true, note, created_by: userData?.user?.email || "admin" })
        .select("version")
        .single();
      if (error) throw error;
      setConfig(next);
      setConfigVersion(Number(data.version));
      toast.success(`Saved as config v${data.version} — ${note}`);
      loadAll();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  // ── Clamp-frequency alert (floors/ceilings binding often = tune model) ──
  const clampAlert = useMemo(() => {
    const recent = audit.filter((a) => Date.now() - new Date(a.created_at).getTime() < 7 * 86_400_000);
    if (recent.length < 10) return null;
    const clamped = recent.filter((a) => a.floor_clamped || a.ceiling_clamped).length;
    const rate = clamped / recent.length;
    return rate >= 0.1 ? { rate, clamped, total: recent.length } : null;
  }, [audit]);

  if (loading && !config) {
    return (
      <div className="flex items-center justify-center py-24 text-slate-400">
        <RiLoader4Line className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (!config) {
    return (
      <div className="p-8 text-sm text-slate-500">
        Dynamic pricing is not configured — run the{" "}
        <code>20260731090000_dynamic_zone_demand_pricing</code> migration to seed config v1.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <SEO title="Dynamic Pricing — Admin" description="Zones, demand-reactive pricing, guardrails." noindex />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-jakarta text-2xl font-bold text-slate-900">Dynamic Pricing</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Zones · demand-reactive adjustment · guardrails. Active config{" "}
            <Badge variant="outline" className="align-middle">v{configVersion}</Badge>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge className={cn(config.demand.enabled ? "bg-emerald-600" : "bg-slate-500")}>
            Reactive: {config.demand.enabled ? "LIVE" : "off"}
          </Badge>
          <Badge className={cn(config.demand.shadow_mode ? "bg-violet-600" : "bg-slate-400")}>
            Shadow: {config.demand.shadow_mode ? "on" : "off"}
          </Badge>
        </div>
      </div>

      {/* Discrepancy banner — stays up until admin confirms the base table */}
      {!config.base_tables.reconciled && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 flex items-start gap-2.5">
          <RiAlarmWarningLine className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
          <div className="text-xs text-amber-900 leading-relaxed">
            <strong>Two conflicting base price tables are on file.</strong> Quotes currently use the{" "}
            <strong>{config.base_tables.authoritative === "training_guide" ? "Training Guide" : "later sqft model"}</strong>{" "}
            (per current staff guidance). Review the comparison in the <em>Base tables</em> tab and confirm which is
            authoritative — this banner stays until you do.
          </div>
        </div>
      )}

      {clampAlert && (
        <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 flex items-start gap-2.5">
          <RiAlarmWarningLine className="w-4 h-4 text-rose-700 shrink-0 mt-0.5" />
          <p className="text-xs text-rose-900">
            <strong>Floors/ceilings are binding often:</strong> {clampAlert.clamped} of {clampAlert.total} quotes in
            the last 7 days ({Math.round(clampAlert.rate * 100)}%) hit a clamp. That's a signal the model needs
            tuning, not more clamping.
          </p>
        </div>
      )}

      <Tabs defaultValue="zones">
        <TabsList>
          <TabsTrigger value="zones"><RiMapPin2Line className="w-3.5 h-3.5 mr-1.5" />Zones</TabsTrigger>
          <TabsTrigger value="demand"><RiScales3Line className="w-3.5 h-3.5 mr-1.5" />Demand</TabsTrigger>
          <TabsTrigger value="guardrails"><RiShieldCheckLine className="w-3.5 h-3.5 mr-1.5" />Guardrails</TabsTrigger>
          <TabsTrigger value="tables"><RiTableLine className="w-3.5 h-3.5 mr-1.5" />Base tables</TabsTrigger>
          <TabsTrigger value="commercial"><RiBuilding2Line className="w-3.5 h-3.5 mr-1.5" />Commercial</TabsTrigger>
          <TabsTrigger value="reports"><RiEyeLine className="w-3.5 h-3.5 mr-1.5" />Reports</TabsTrigger>
        </TabsList>

        <TabsContent value="zones" className="mt-4">
          <ZonesTab zones={zones} zipCounts={zipCounts} zipToZone={zipToZone} stats={zoneStats} onChanged={loadAll} />
        </TabsContent>
        <TabsContent value="demand" className="mt-4">
          <DemandTab config={config} saving={saving} onSave={saveConfig} />
        </TabsContent>
        <TabsContent value="guardrails" className="mt-4">
          <GuardrailsTab config={config} payRates={payRates} saving={saving} onSave={saveConfig} />
        </TabsContent>
        <TabsContent value="tables" className="mt-4">
          <BaseTablesTab config={config} saving={saving} onSave={saveConfig} />
        </TabsContent>
        {/* Commercial prices off facility type x scope level x size tier —
            a different model from the residential sqft bands above, tuned the
            same evidence-driven way. */}
        <TabsContent value="commercial" className="mt-4">
          <CommercialPricing />
        </TabsContent>
        <TabsContent value="reports" className="mt-4">
          <ReportsTab audit={audit} overrides={overrides} versions={versions} config={config} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Zones tab ──────────────────────────────────────────────────────────────

function ZonesTab({
  zones, zipCounts, zipToZone, stats, onChanged,
}: {
  zones: ZoneRow[];
  zipCounts: Record<string, number>;
  zipToZone: Record<string, string>;
  stats: Record<string, { jobs: number; avgCents: number; quotes: number; converted: number; cleaners: number | null }>;
  onChanged: () => void;
}) {
  const [edits, setEdits] = useState<Record<string, Partial<ZoneRow> & { minJobValue?: string }>>({});
  const [savingZone, setSavingZone] = useState<string | null>(null);
  const [zipQuery, setZipQuery] = useState("");
  const [zipAdd, setZipAdd] = useState("");
  const [zipAddZone, setZipAddZone] = useState<string>("");

  const saveZone = async (z: ZoneRow) => {
    const e = edits[z.id] || {};
    setSavingZone(z.id);
    try {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (e.multiplier != null) patch.multiplier = Number(e.multiplier);
      if (e.status) patch.status = e.status;
      if (e.travel_minutes !== undefined) patch.travel_minutes = e.travel_minutes;
      if (e.minJobValue !== undefined) {
        patch.min_job_value_cents = e.minJobValue.trim() ? Math.round(parseFloat(e.minJobValue) * 100) : null;
      }
      const { error } = await db.from("pricing_zones").update(patch).eq("id", z.id);
      if (error) throw error;
      toast.success(`Zone ${z.code} updated. Existing locked quotes keep their recorded price.`);
      setEdits((s) => ({ ...s, [z.id]: {} }));
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Zone update failed.");
    } finally {
      setSavingZone(null);
    }
  };

  const addZip = async () => {
    const zip = zipAdd.trim();
    if (!/^\d{5}$/.test(zip) || !zipAddZone) {
      toast.error("Enter a 5-digit zip and pick a zone.");
      return;
    }
    const { error } = await db
      .from("pricing_zone_zips")
      .upsert({ zip, zone_id: zipAddZone }, { onConflict: "zip" });
    if (error) toast.error(error.message);
    else {
      toast.success(`${zip} mapped.`);
      setZipAdd("");
      onChanged();
    }
  };

  const lookedUp = /^\d{5}$/.test(zipQuery.trim())
    ? zones.find((z) => z.id === zipToZone[zipQuery.trim()]) || null
    : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {zones.map((z) => {
          const e = edits[z.id] || {};
          const st = stats[z.code];
          const dirty = Object.keys(e).length > 0;
          return (
            <Card key={z.id} className={cn(z.status === "not_served" && "opacity-75")}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <span>
                    {z.name} {z.is_default && <Badge variant="outline" className="ml-1 text-[10px]">default</Badge>}
                  </span>
                  <span className="font-mono text-violet-700">×{e.multiplier ?? z.multiplier}</span>
                </CardTitle>
                <CardDescription className="text-[11px] leading-snug">{z.description}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label className="text-[10px] uppercase text-slate-500">Multiplier</Label>
                    <Input
                      type="number" step={0.01} min={0.5} max={3}
                      value={e.multiplier ?? z.multiplier}
                      onChange={(ev) => setEdits((s) => ({ ...s, [z.id]: { ...s[z.id], multiplier: parseFloat(ev.target.value) || z.multiplier } }))}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-slate-500">Status</Label>
                    <Select
                      value={e.status ?? z.status}
                      onValueChange={(v) => setEdits((s) => ({ ...s, [z.id]: { ...s[z.id], status: v as ZoneRow["status"] } }))}
                    >
                      <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="surcharge_only">Surcharge-only</SelectItem>
                        <SelectItem value="not_served">Not served</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-slate-500">Min job value ($)</Label>
                    <Input
                      type="number" step={1} min={0}
                      value={e.minJobValue ?? centsToInput(z.min_job_value_cents)}
                      placeholder="none"
                      onChange={(ev) => setEdits((s) => ({ ...s, [z.id]: { ...s[z.id], minJobValue: ev.target.value } }))}
                      className="h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase text-slate-500">Travel (min)</Label>
                    <Input
                      type="number" step={5} min={0}
                      value={e.travel_minutes ?? z.travel_minutes ?? ""}
                      onChange={(ev) => setEdits((s) => ({ ...s, [z.id]: { ...s[z.id], travel_minutes: ev.target.value ? parseInt(ev.target.value) : null } }))}
                      className="h-8"
                    />
                  </div>
                </div>
                {/* Evidence panel — tune multipliers on data, not guesses */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-lg bg-slate-50 border border-slate-100 px-2.5 py-2 text-[11px] text-slate-600">
                  <span>Jobs (90d): <strong>{st?.jobs ?? "—"}</strong></span>
                  <span>Avg value: <strong>{st?.avgCents ? fmtMoney(st.avgCents) : "—"}</strong></span>
                  <span>Quote win rate: <strong>{st && st.quotes > 0 ? `${Math.round((st.converted / st.quotes) * 100)}%` : "—"}</strong></span>
                  <span>Cleaner coverage: <strong>{st?.cleaners ?? "—"}</strong></span>
                  <span>Mapped zips: <strong>{zipCounts[z.id] || 0}</strong></span>
                  <span>Travel ref: <strong>{z.travel_minutes ?? "—"} min</strong></span>
                </div>
                {dirty && (
                  <Button size="sm" className="w-full h-8" disabled={savingZone === z.id} onClick={() => saveZone(z)}>
                    {savingZone === z.id ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : `Save Zone ${z.code}`}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Zip mapping</CardTitle>
          <CardDescription className="text-xs">
            A zip belongs to exactly one zone. Served-but-unmapped zips fall to the default zone; zips outside all
            served areas get the waitlist message, never a wrong price.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase text-slate-500">Look up a zip</Label>
            <Input value={zipQuery} onChange={(e) => setZipQuery(e.target.value)} placeholder="20814" className="h-8" />
            {/^\d{5}$/.test(zipQuery.trim()) && (
              <p className="text-xs text-slate-600">
                {lookedUp
                  ? <>Mapped to <strong>{lookedUp.name}</strong> (×{lookedUp.multiplier}, {lookedUp.status})</>
                  : <>Not mapped — a served address here falls to the <strong>default zone</strong>; otherwise waitlist.</>}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-[10px] uppercase text-slate-500">Map a zip to a zone</Label>
            <div className="flex gap-2">
              <Input value={zipAdd} onChange={(e) => setZipAdd(e.target.value)} placeholder="21044" className="h-8 w-28" />
              <Select value={zipAddZone} onValueChange={setZipAddZone}>
                <SelectTrigger className="h-8 flex-1"><SelectValue placeholder="Zone…" /></SelectTrigger>
                <SelectContent>
                  {zones.map((z) => <SelectItem key={z.id} value={z.id}>{z.name}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button size="sm" className="h-8" onClick={addZip}>Map</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Demand tab ─────────────────────────────────────────────────────────────

const DEMAND_INPUT_LABELS: Record<string, string> = {
  capacity_utilization: "Capacity utilization (how booked the date is)",
  lead_time: "Lead time (short notice ↑, far out ↓)",
  peak_period: "Peak periods (weekends, month-end, seasons)",
  zone_capacity: "Zone-specific capacity (thin coverage that day)",
};

function DemandTab({
  config, saving, onSave,
}: {
  config: DynamicPricingConfig;
  saving: boolean;
  onSave: (next: DynamicPricingConfig, note: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(config.demand));
  useEffect(() => setDraft(structuredClone(config.demand)), [config]);

  const set = <K extends keyof typeof draft>(k: K, v: (typeof draft)[K]) => setDraft((d) => ({ ...d, [k]: v }));

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Reactive pricing</CardTitle>
          <CardDescription className="text-xs">
            Bounded, rate-limited, and fully disableable. Launch order: shadow mode → review the comparison report →
            enable. Members and focused cleans are exempt regardless. Turning it off leaves base × condition × zone
            pricing fully intact.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.enabled} onCheckedChange={(v) => set("enabled", v)} />
              <span className="font-medium">Reactive pricing live</span>
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Switch checked={draft.shadow_mode} onCheckedChange={(v) => set("shadow_mode", v)} />
              <span className="font-medium">Shadow mode (log would-be multiplier, charge zone price)</span>
            </label>
          </div>
          {draft.enabled && !config.demand.enabled && (
            <p className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-[11px] text-amber-900">
              You're about to take reactive pricing LIVE. Confirm you've reviewed the shadow comparison report first —
              do not skip that step.
            </p>
          )}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-[10px] uppercase text-slate-500">Min multiplier</Label>
              <Input type="number" step={0.01} value={draft.min_multiplier}
                onChange={(e) => set("min_multiplier", parseFloat(e.target.value) || 0.9)} className="h-8" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-slate-500">Max multiplier</Label>
              <Input type="number" step={0.01} value={draft.max_multiplier}
                onChange={(e) => set("max_multiplier", parseFloat(e.target.value) || 1.25)} className="h-8" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-slate-500">Max change / hour</Label>
              <Input type="number" step={0.01} value={draft.max_delta_per_hour}
                onChange={(e) => set("max_delta_per_hour", parseFloat(e.target.value) || 0.05)} className="h-8" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-slate-500">Lead-time short / long (days)</Label>
              <div className="flex gap-1.5">
                <Input type="number" value={draft.lead_time_short_days}
                  onChange={(e) => set("lead_time_short_days", parseInt(e.target.value) || 2)} className="h-8" />
                <Input type="number" value={draft.lead_time_long_days}
                  onChange={(e) => set("lead_time_long_days", parseInt(e.target.value) || 21)} className="h-8" />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] uppercase text-slate-500">Inputs & weights</Label>
            {(Object.keys(draft.inputs) as Array<keyof typeof draft.inputs>).map((k) => (
              <div key={k} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2">
                <Checkbox
                  checked={draft.inputs[k].enabled}
                  onCheckedChange={(v) => setDraft((d) => ({ ...d, inputs: { ...d.inputs, [k]: { ...d.inputs[k], enabled: v === true } } }))}
                />
                <span className="text-xs flex-1">{DEMAND_INPUT_LABELS[k] || k}</span>
                <Input
                  type="number" step={0.01} min={0} max={1}
                  value={draft.inputs[k].weight}
                  onChange={(e) => setDraft((d) => ({ ...d, inputs: { ...d.inputs, [k]: { ...d.inputs[k], weight: parseFloat(e.target.value) || 0 } } }))}
                  className="h-7 w-20"
                />
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <Label className="text-[10px] uppercase text-slate-500">Peak periods</Label>
            {draft.peak_periods.map((p, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs">
                <Badge variant="outline">{p.type}</Badge>
                <Input
                  value={p.label}
                  onChange={(e) => setDraft((d) => {
                    const pp = [...d.peak_periods];
                    pp[i] = { ...pp[i], label: e.target.value };
                    return { ...d, peak_periods: pp };
                  })}
                  className="h-7 w-56"
                />
                {p.type === "weekday" && (
                  <span className="flex gap-1">
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((dLabel, day) => (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setDraft((d) => {
                          const pp = [...d.peak_periods];
                          const cur = pp[i] as { type: "weekday"; days: number[]; pressure: number; label: string };
                          const days = cur.days.includes(day) ? cur.days.filter((x) => x !== day) : [...cur.days, day];
                          pp[i] = { ...cur, days };
                          return { ...d, peak_periods: pp };
                        })}
                        className={cn(
                          "w-7 h-7 rounded border text-[10px] font-semibold",
                          (p as { days: number[] }).days.includes(day)
                            ? "bg-violet-600 text-white border-violet-600"
                            : "bg-white text-slate-500 border-slate-200",
                        )}
                      >
                        {dLabel}
                      </button>
                    ))}
                  </span>
                )}
                {p.type === "month_end" && (
                  <span className="flex items-center gap-1">
                    from day
                    <Input
                      type="number" min={1} max={31}
                      value={(p as { from_day: number }).from_day}
                      onChange={(e) => setDraft((d) => {
                        const pp = [...d.peak_periods];
                        pp[i] = { ...pp[i], from_day: parseInt(e.target.value) || 25 } as typeof pp[number];
                        return { ...d, peak_periods: pp };
                      })}
                      className="h-7 w-16"
                    />
                  </span>
                )}
                {p.type === "date_range" && (
                  <span className="flex items-center gap-1">
                    <Input type="date" value={(p as { from: string }).from}
                      onChange={(e) => setDraft((d) => {
                        const pp = [...d.peak_periods];
                        pp[i] = { ...pp[i], from: e.target.value } as typeof pp[number];
                        return { ...d, peak_periods: pp };
                      })} className="h-7 w-36" />
                    <Input type="date" value={(p as { to: string }).to}
                      onChange={(e) => setDraft((d) => {
                        const pp = [...d.peak_periods];
                        pp[i] = { ...pp[i], to: e.target.value } as typeof pp[number];
                        return { ...d, peak_periods: pp };
                      })} className="h-7 w-36" />
                  </span>
                )}
                <span className="flex items-center gap-1 ml-auto">
                  pressure (−1…1; negative = discount)
                  <Input
                    type="number" step={0.1} min={-1} max={1}
                    value={p.pressure}
                    onChange={(e) => setDraft((d) => {
                      const pp = [...d.peak_periods];
                      pp[i] = { ...pp[i], pressure: parseFloat(e.target.value) || 0 };
                      return { ...d, peak_periods: pp };
                    })}
                    className="h-7 w-20"
                  />
                  <Button variant="ghost" size="sm" className="h-7 text-rose-600"
                    onClick={() => setDraft((d) => ({ ...d, peak_periods: d.peak_periods.filter((_, x) => x !== i) }))}>
                    <RiCloseLine className="w-3.5 h-3.5" />
                  </Button>
                </span>
              </div>
            ))}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="h-7 text-xs"
                onClick={() => setDraft((d) => ({ ...d, peak_periods: [...d.peak_periods, { type: "weekday", days: [0, 6], pressure: 0.5, label: "New peak" }] }))}>
                + weekday peak
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs"
                onClick={() => setDraft((d) => ({ ...d, peak_periods: [...d.peak_periods, { type: "month_end", from_day: 25, pressure: 0.4, label: "Month-end" }] }))}>
                + month-end
              </Button>
              <Button variant="outline" size="sm" className="h-7 text-xs"
                onClick={() => setDraft((d) => ({ ...d, peak_periods: [...d.peak_periods, { type: "date_range", from: format(new Date(), "yyyy-MM-dd"), to: format(new Date(), "yyyy-MM-dd"), pressure: 0.4, label: "Season" }] }))}>
                + date range
              </Button>
            </div>
          </div>

          <Button
            disabled={saving}
            onClick={() => onSave({ ...config, demand: draft }, "Demand configuration change")}
          >
            {saving ? <RiLoader4Line className="w-4 h-4 animate-spin mr-2" /> : null}
            Save as new config version
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Guardrails tab ─────────────────────────────────────────────────────────

function GuardrailsTab({
  config, payRates, saving, onSave,
}: {
  config: DynamicPricingConfig;
  payRates: { soloFoundationPercent: number; crewFoundationPercent: number };
  saving: boolean;
  onSave: (next: DynamicPricingConfig, note: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(() => structuredClone(config.guardrails));
  const [conditions, setConditions] = useState(() => structuredClone(config.condition_multipliers));
  useEffect(() => {
    setDraft(structuredClone(config.guardrails));
    setConditions(structuredClone(config.condition_multipliers));
  }, [config]);

  const bands = Object.entries(config.bands).filter(([id]) => id !== "5000_plus");

  const conditionMeta: Array<{ id: keyof typeof conditions; label: string; hint: string }> = [
    { id: "light", label: "Light", hint: "Lived-in tidy; light dust & surfaces" },
    { id: "standard", label: "Standard", hint: "Typical home condition" },
    { id: "heavy", label: "Heavy", hint: "Build-up, neglect, or post-event" },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Condition multipliers</CardTitle>
          <CardDescription className="text-xs">
            Applied after the base price and before zone × demand:{" "}
            <code className="text-[11px]">base × condition × zone × demand</code>. Light is usually 1.0;
            standard and heavy scale effort for dirtier homes.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {conditionMeta.map((c) => (
              <div key={c.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                <Label className="text-[10px] uppercase text-slate-500">{c.label}</Label>
                <Input
                  type="number"
                  step={0.05}
                  min={0.5}
                  max={3}
                  value={conditions[c.id]}
                  onChange={(e) => {
                    const n = parseFloat(e.target.value);
                    setConditions((prev) => ({
                      ...prev,
                      [c.id]: Number.isFinite(n) ? Math.round(n * 100) / 100 : prev[c.id],
                    }));
                  }}
                  className="h-9 mt-1 font-mono"
                />
                <p className="text-[10.5px] text-slate-400 mt-1.5 leading-snug">{c.hint}</p>
              </div>
            ))}
          </div>
          <Button
            disabled={saving}
            onClick={() => {
              const light = Math.max(0.5, Math.min(3, Number(conditions.light) || 1));
              const standard = Math.max(0.5, Math.min(3, Number(conditions.standard) || 1.25));
              const heavy = Math.max(0.5, Math.min(3, Number(conditions.heavy) || 1.6));
              void onSave(
                {
                  ...config,
                  condition_multipliers: { light, standard, heavy },
                },
                `Condition multipliers → L ${light} / S ${standard} / H ${heavy}`,
              );
            }}
          >
            {saving ? <RiLoader4Line className="w-4 h-4 animate-spin mr-2" /> : null}
            Save condition multipliers
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Floor · ceiling · override band · quote lock</CardTitle>
        <CardDescription className="text-xs">
          The floor guarantees per-cleaner hourly earnings after the Foundation pool percentage (solo{" "}
          {payRates.soloFoundationPercent}% / crew {payRates.crewFoundationPercent}%, read live from cleaner pay
          rates). Discounts are always funded by company margin — cleaner pay stays a percentage of final job value.
          Focused-clean rates and the same-day fee are <strong>not</strong> edited here — they come from the shared
          focused/same-day settings (Operations), which the customer funnel and job checklists read too.
        </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-[10px] uppercase text-slate-500">Min cleaner hourly ($)</Label>
              <Input type="number" step={0.5} value={(draft.min_effective_hourly_cents / 100).toFixed(2)}
                onChange={(e) => setDraft((d) => ({ ...d, min_effective_hourly_cents: Math.round((parseFloat(e.target.value) || 0) * 100) }))}
                className="h-8" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-slate-500">Max total uplift (zone × demand)</Label>
              <Input type="number" step={0.01} value={draft.max_total_uplift}
                onChange={(e) => setDraft((d) => ({ ...d, max_total_uplift: parseFloat(e.target.value) || 1.35 }))}
                className="h-8" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-slate-500">VA override band (±%)</Label>
              <Input type="number" step={1} value={draft.override_band_percent}
                onChange={(e) => setDraft((d) => ({ ...d, override_band_percent: parseFloat(e.target.value) || 10 }))}
                className="h-8" />
            </div>
            <div>
              <Label className="text-[10px] uppercase text-slate-500">Quote lock (hours)</Label>
              <Input type="number" step={1} value={draft.quote_lock_hours}
                onChange={(e) => setDraft((d) => ({ ...d, quote_lock_hours: parseInt(e.target.value) || 48 }))}
                className="h-8" />
            </div>
          </div>

          <div className="overflow-x-auto">
            <Label className="text-[10px] uppercase text-slate-500">
              Effective floors (derived from hourly guarantee; set an explicit floor to raise one)
            </Label>
            <table className="mt-1.5 w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1 pr-3">Band</th>
                  {["standard", "deep", "moveInOut"].map((s) => (
                    <th key={s} className="py-1 pr-3">{s}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {bands.map(([id, band]) => (
                  <tr key={id} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 text-slate-700">{band.label}</td>
                    {(["standard", "deep", "moveInOut"] as const).map((svc) => {
                      const derived = computeFloorCents({ ...config, guardrails: { ...draft, floor_cents: {} } }, svc, id, payRates);
                      const explicit = draft.floor_cents?.[svc]?.[id];
                      return (
                        <td key={svc} className="py-1.5 pr-3">
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              step={1}
                              value={explicit != null ? (explicit / 100).toFixed(0) : ""}
                              placeholder={(derived / 100).toFixed(0)}
                              onChange={(e) => setDraft((d) => {
                                const fc = structuredClone(d.floor_cents || {});
                                if (!fc[svc]) fc[svc] = {};
                                if (e.target.value.trim()) fc[svc][id] = Math.round(parseFloat(e.target.value) * 100);
                                else delete fc[svc][id];
                                return { ...d, floor_cents: fc };
                              })}
                              className="h-7 w-20"
                            />
                            <span className="text-[10px] text-slate-400">≥{fmtMoney(derived)}</span>
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10.5px] text-slate-400 mt-1">
              The effective floor is the HIGHER of the derived value and any explicit value. No zone/demand
              combination and no override may price below it.
            </p>
          </div>

          <Button disabled={saving} onClick={() => onSave({ ...config, guardrails: draft }, "Guardrails change")}>
            {saving ? <RiLoader4Line className="w-4 h-4 animate-spin mr-2" /> : null}
            Save as new config version
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Base tables tab ────────────────────────────────────────────────────────

function BaseTablesTab({
  config, saving, onSave,
}: {
  config: DynamicPricingConfig;
  saving: boolean;
  onSave: (next: DynamicPricingConfig, note: string) => Promise<void>;
}) {
  const bands = Object.keys(config.base_tables.training_guide).filter((b) => b !== "5000_plus");
  const legacyByBand: Record<string, number> = Object.fromEntries(
    HOME_SIZE_RANGES.map((h) => [h.id, h.standardPrice * 100]),
  );

  const confirm = async (authoritative: "training_guide" | "later_sqft_model") => {
    await onSave(
      {
        ...config,
        base_tables: { ...config.base_tables, authoritative, reconciled: true },
      },
      `Admin confirmed authoritative base table: ${authoritative}`,
    );
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Base price tables — {config.base_tables.reconciled ? "reconciled" : "UNRESOLVED discrepancy"}</CardTitle>
        <CardDescription className="text-xs">
          Three tables are on file: the <strong>Training Guide</strong> (zone-aware, what staff quote from), the{" "}
          <strong>later sqft model</strong> (derived from cleaner-pay math, lower), and the <strong>legacy v4 code
          table</strong> still used by the public funnel. Dynamic quotes use{" "}
          <strong>{config.base_tables.authoritative === "training_guide" ? "the Training Guide" : "the later sqft model"}</strong>.
          {!config.base_tables.reconciled && " Confirm which is authoritative — this table ships unresolved until you do."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="py-1 pr-3">Band</th>
                <th className="py-1 pr-3">Training Guide (std / deep / MIMO)</th>
                <th className="py-1 pr-3">Later sqft model (std / deep)</th>
                <th className="py-1 pr-3">Legacy v4 code (std)</th>
              </tr>
            </thead>
            <tbody>
              {bands.map((b) => {
                const tg = config.base_tables.training_guide[b];
                const later = config.base_tables.later_sqft_model[b];
                const legacy = legacyByBand[b];
                const differs = later && tg.standard !== later.standard;
                return (
                  <tr key={b} className="border-t border-slate-100">
                    <td className="py-1.5 pr-3 text-slate-700">{config.bands[b]?.label || b}</td>
                    <td className={cn("py-1.5 pr-3 font-medium", config.base_tables.authoritative === "training_guide" && "text-violet-700")}>
                      {fmtMoney(tg.standard)} / {fmtMoney(tg.deep)} / {tg.moveInOut != null ? fmtMoney(tg.moveInOut) : "—"}
                    </td>
                    <td className={cn("py-1.5 pr-3", differs && "text-amber-700 font-medium", config.base_tables.authoritative === "later_sqft_model" && "text-violet-700")}>
                      {later ? `${fmtMoney(later.standard)} / ${fmtMoney(later.deep)}` : "—"}
                    </td>
                    <td className="py-1.5 pr-3 text-slate-500">{legacy != null ? fmtMoney(legacy) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!config.base_tables.reconciled && (
          <div className="flex gap-2">
            <Button size="sm" disabled={saving} onClick={() => confirm("training_guide")}>
              Confirm Training Guide as authoritative
            </Button>
            <Button size="sm" variant="outline" disabled={saving} onClick={() => confirm("later_sqft_model")}>
              Use the later sqft model instead
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Reports tab ────────────────────────────────────────────────────────────

function ReportsTab({
  audit, overrides, versions, config,
}: {
  audit: AuditRow[];
  overrides: OverrideRow[];
  versions: Array<{ version: number; created_at: string; note: string | null; created_by: string | null; is_active: boolean }>;
  config: DynamicPricingConfig;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  // Shadow comparison: charged vs what reactive would have charged.
  const shadowRows = audit.filter((a) => a.demand_mode === "shadow" && a.breakdown?.ok);
  const shadowSummary = useMemo(() => {
    if (shadowRows.length === 0) return null;
    let up = 0, down = 0, same = 0, deltaSum = 0;
    for (const a of shadowRows) {
      const would = shadowWouldCharge(a);
      const charged = a.final_cents ?? a.breakdown.totalCents;
      if (would == null) continue;
      const d = would - charged;
      deltaSum += d;
      if (d > 0) up++; else if (d < 0) down++; else same++;
    }
    return { up, down, same, avgDelta: Math.round(deltaSum / shadowRows.length) };
  }, [shadowRows]);

  // Override activity per VA — a coaching signal, not a penalty.
  const perVa = useMemo(() => {
    const m: Record<string, { count: number; down: number; up: number; avgDelta: number; sum: number }> = {};
    for (const o of overrides) {
      if (!m[o.va_name]) m[o.va_name] = { count: 0, down: 0, up: 0, avgDelta: 0, sum: 0 };
      m[o.va_name].count++;
      m[o.va_name][o.direction === "down" ? "down" : "up"]++;
      m[o.va_name].sum += Number(o.delta_percent) || 0;
    }
    for (const k of Object.keys(m)) m[k].avgDelta = m[k].sum / m[k].count;
    return Object.entries(m).sort((a, b) => b[1].count - a[1].count);
  }, [overrides]);

  return (
    <div className="space-y-4">
      {/* Shadow comparison — review this before enabling reactive pricing */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Shadow comparison — charged vs what reactive would have charged</CardTitle>
          <CardDescription className="text-xs">
            {config.demand.enabled
              ? "Reactive pricing is live; shadow rows below are from before it was enabled."
              : "Reactive pricing is not live. Review these deltas until the model behaves sanely, then enable."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {shadowSummary ? (
            <div className="flex flex-wrap gap-4 text-xs text-slate-600">
              <span>Quotes in shadow: <strong>{shadowRows.length}</strong></span>
              <span>Would price higher: <strong className="text-amber-700">{shadowSummary.up}</strong></span>
              <span>Would discount: <strong className="text-emerald-700">{shadowSummary.down}</strong></span>
              <span>Unchanged: <strong>{shadowSummary.same}</strong></span>
              <span>Avg delta: <strong>{fmtMoney(shadowSummary.avgDelta)}</strong></span>
            </div>
          ) : (
            <p className="text-xs text-slate-400">No shadow-mode quotes logged yet.</p>
          )}
          {shadowRows.slice(0, 12).map((a) => {
            const would = shadowWouldCharge(a);
            const charged = a.final_cents ?? a.breakdown.totalCents;
            return (
              <div key={a.id} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600 border-t border-slate-100 pt-1.5">
                <span className="text-slate-400">{format(new Date(a.created_at), "MMM d HH:mm")}</span>
                <Badge variant="outline" className="text-[10px]">Zone {a.zone_code}</Badge>
                <span>{a.service_type} · {a.home_size_id || "focused"} · {a.service_date}</span>
                <span className="ml-auto tabular-nums">
                  charged {fmtMoney(charged)} → would {would != null ? fmtMoney(would) : "—"}{" "}
                  (×{Number(a.shadow_demand_multiplier || 1).toFixed(2)})
                </span>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Override activity per VA */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Override activity per VA</CardTitle>
          <CardDescription className="text-xs">
            Systematic discounting shows up here — treat it as a coaching signal, not an automatic penalty.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {perVa.length === 0 ? (
            <p className="text-xs text-slate-400">No overrides logged yet.</p>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-slate-500">
                  <th className="py-1">VA</th><th className="py-1">Overrides</th><th className="py-1">Down / Up</th><th className="py-1">Avg delta</th>
                </tr>
              </thead>
              <tbody>
                {perVa.map(([va, s]) => (
                  <tr key={va} className="border-t border-slate-100">
                    <td className="py-1.5 font-medium text-slate-800">{va}</td>
                    <td className="py-1.5">{s.count}</td>
                    <td className="py-1.5">{s.down} ↓ / {s.up} ↑</td>
                    <td className={cn("py-1.5 tabular-nums", s.avgDelta < -5 && "text-amber-700 font-semibold")}>
                      {s.avgDelta > 0 ? "+" : ""}{s.avgDelta.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Price audit log — every quote reconstructable */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-1.5">
            <RiHistoryLine className="w-4 h-4" /> Price audit log
          </CardTitle>
          <CardDescription className="text-xs">
            Every quote stores its full layered breakdown and the config version in effect — click a row to see
            exactly how its price was built.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {audit.slice(0, 40).map((a) => (
            <div key={a.id} className="border-t border-slate-100 first:border-t-0">
              <button
                type="button"
                className="w-full flex flex-wrap items-center gap-2 py-1.5 text-[11px] text-slate-600 text-left"
                onClick={() => setExpanded(expanded === a.id ? null : a.id)}
              >
                <span className="text-slate-400">{format(new Date(a.created_at), "MMM d HH:mm")}</span>
                <Badge variant="outline" className="text-[10px]">Zone {a.zone_code}</Badge>
                <span>{a.service_type} · {a.home_size_id || "focused"} · {a.condition}</span>
                {a.floor_clamped && <Badge className="bg-amber-500 text-[10px]">floor</Badge>}
                {a.ceiling_clamped && <Badge className="bg-rose-500 text-[10px]">ceiling</Badge>}
                {a.booking_id && <Badge className="bg-emerald-600 text-[10px]">booked</Badge>}
                <span className="ml-auto font-semibold tabular-nums text-slate-800">
                  {a.final_cents != null ? fmtMoney(a.final_cents) : "—"}
                </span>
                <span className="text-slate-400">v{a.config_version} · {a.demand_mode}</span>
              </button>
              {expanded === a.id && a.breakdown?.lines && (
                <div className="mb-2 rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 space-y-1">
                  {a.breakdown.lines.map((l) => (
                    <div key={l.key} className="flex justify-between text-[11px]">
                      <span className="text-slate-600">{l.label} <span className="text-slate-400">— {l.reason}</span></span>
                      <span className="tabular-nums text-slate-700">{l.amountCents >= 0 ? "+" : "−"}{fmtMoney(Math.abs(l.amountCents))}</span>
                    </div>
                  ))}
                  <div className="flex justify-between text-[11px] font-semibold border-t border-slate-200 pt-1">
                    <span>Final ({a.quoted_by || "—"})</span>
                    <span className="tabular-nums">{a.final_cents != null ? fmtMoney(a.final_cents) : "—"}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
          {audit.length === 0 && <p className="text-xs text-slate-400">No quotes logged yet.</p>}
        </CardContent>
      </Card>

      {/* Config version history */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Config version history</CardTitle>
          <CardDescription className="text-xs">Versions are immutable; every quote records the version that priced it.</CardDescription>
        </CardHeader>
        <CardContent>
          <table className="w-full text-xs">
            <tbody>
              {versions.map((v) => (
                <tr key={v.version} className="border-t border-slate-100 first:border-t-0">
                  <td className="py-1.5 font-mono">v{v.version} {v.is_active && <Badge className="ml-1 bg-emerald-600 text-[10px]">active</Badge>}</td>
                  <td className="py-1.5 text-slate-500">{format(new Date(v.created_at), "MMM d, yyyy HH:mm")}</td>
                  <td className="py-1.5 text-slate-600">{v.note || "—"}</td>
                  <td className="py-1.5 text-slate-400">{v.created_by || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
