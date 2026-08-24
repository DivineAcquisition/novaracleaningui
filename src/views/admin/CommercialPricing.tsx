"use client";

// ─── Commercial pricing — /admin/pricing → Commercial tab ──────────────────
//
// The three inputs behind every commercial quote, all editable here:
//
//   price = sqft × facility_type_base_rate × scope_multiplier × size_tier_multiplier
//
//   1. Facility types — base cents per square foot. Detail density is what
//      varies: a restaurant kitchen genuinely costs multiples of open
//      warehouse floor per square foot.
//   2. Scope levels — Light / Standard / Detailed, priced by multiplier and
//      also carrying crew throughput, since a Detailed pass covers far less
//      ground per cleaner-hour than a Light one.
//   3. Size tiers — economies of scale. The multiplier FALLS as area rises:
//      fixed setup and travel spread across more square feet.
//
// Plus the tunables that are not a rate: the walkthrough threshold, how wide
// an estimate range is, the crew-sizing model, and how documentation scales.
//
// These are starting values, not truths. Tune them from completed job data the
// same way the zone multipliers were tuned. Editing changes future quotes
// only — every booking recorded its own breakdown, so old numbers stay
// reproducible.

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  RiAddLine,
  RiBuilding2Line,
  RiDeleteBinLine,
  RiLoader4Line,
  RiRulerLine,
  RiSaveLine,
  RiScales3Line,
  RiShieldCheckLine,
} from "@remixicon/react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DEFAULT_COMMERCIAL_CONFIG,
  DEFAULT_COMMERCIAL_SETTINGS,
  computeCommercialQuote,
  formatCents,
  type CommercialSettings,
} from "@/lib/commercial-pricing";

interface FacilityRow {
  id: string;
  key: string;
  label: string;
  base_rate_cents_per_sqft: number;
  description: string | null;
  sort_order: number;
  active: boolean;
}
interface ScopeRow {
  id: string;
  key: string;
  label: string;
  multiplier: number;
  summary: string | null;
  sqft_per_cleaner_hour: number;
  sort_order: number;
  active: boolean;
}
interface TierRow {
  id: string;
  label: string;
  min_sqft: number;
  max_sqft: number | null;
  multiplier: number;
}

async function api(method: string, body?: unknown, query = ""): Promise<Record<string, any>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(`/api/admin/commercial-pricing${query}`, {
    method,
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const out = await res.json().catch(() => ({}));
  if (!res.ok || out?.ok === false) throw new Error(out?.error || `Request failed (${res.status})`);
  return out;
}

const SETTING_FIELDS: Array<{ key: keyof CommercialSettings; label: string; help: string; step?: string }> = [
  {
    key: "walkthrough_threshold_sqft",
    label: "Walkthrough threshold (sq ft)",
    help: "At or above this, the formula produces an estimate range only and a completed walkthrough is required before booking.",
  },
  {
    key: "estimate_range_pct",
    label: "Estimate range (± fraction)",
    step: "0.01",
    help: "How wide the range around the anchor is. 0.20 shows ±20%.",
  },
  {
    key: "crew_coordination_factor",
    label: "Crew coordination factor",
    step: "0.05",
    help: "How much of a solo cleaner each extra crew member adds. 0.75 reflects that two people take ~60% of solo time, not 50%.",
  },
  { key: "min_crew_size", label: "Minimum crew", help: "Smallest crew the sizer will recommend." },
  { key: "max_crew_size", label: "Maximum crew", help: "Cap. Past this the window is reported as too short rather than growing the crew." },
  { key: "default_window_hours", label: "Default window (hours)", step: "0.5", help: "Used when no service window is set on the site or booking." },
  {
    key: "photo_zone_threshold_sqft",
    label: "Photo zones start at (sq ft)",
    help: "Below this a site is one before/after pair. Above it, documentation is captured zone by zone.",
  },
  { key: "photo_zone_sqft", label: "Square feet per zone", help: "How much area one documentation zone covers." },
  { key: "max_photo_zones", label: "Maximum zones", help: "Ceiling on generated zones so a huge site doesn't produce an unusable checklist." },
  { key: "coi_warning_days", label: "COI warning window (days)", help: "A certificate expiring inside this window is flagged as needing attention; expired blocks outright." },
];

export default function CommercialPricing() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [facilities, setFacilities] = useState<FacilityRow[]>([]);
  const [scopes, setScopes] = useState<ScopeRow[]>([]);
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [settings, setSettings] = useState<CommercialSettings>(DEFAULT_COMMERCIAL_SETTINGS);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const out = await api("GET");
      setFacilities((out.facilityTypes || []) as FacilityRow[]);
      setScopes((out.scopeLevels || []) as ScopeRow[]);
      setTiers((out.sizeTiers || []) as TierRow[]);
      setSettings({ ...DEFAULT_COMMERCIAL_SETTINGS, ...(out.settings || {}) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load commercial pricing");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const saveRow = async (kind: string, id: string, patch: Record<string, unknown>) => {
    setSaving(id);
    try {
      await api("PUT", { kind, id, patch });
      toast.success("Saved — future quotes use it immediately.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(null);
    }
  };

  const removeRow = async (kind: string, id: string) => {
    setSaving(id);
    try {
      await api("DELETE", undefined, `?kind=${kind}&id=${id}`);
      toast.success("Removed.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setSaving(null);
    }
  };

  const addRow = async (kind: string, row: Record<string, unknown>) => {
    setSaving(kind);
    try {
      await api("POST", { kind, row });
      toast.success("Added.");
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add");
    } finally {
      setSaving(null);
    }
  };

  // A worked example against the live config, so an edit's effect is visible
  // before it reaches a customer call.
  const preview = useMemo(() => {
    const config = {
      facilityTypes: facilities.length ? facilities : DEFAULT_COMMERCIAL_CONFIG.facilityTypes,
      scopeLevels: scopes.length ? scopes : DEFAULT_COMMERCIAL_CONFIG.scopeLevels,
      sizeTiers: tiers.length ? tiers : DEFAULT_COMMERCIAL_CONFIG.sizeTiers,
      settings,
    };
    const office = computeCommercialQuote(config, {
      sqft: 1800, facilityTypeKey: "office", scopeLevel: "standard", windowHours: 4,
    });
    const warehouse = computeCommercialQuote(config, {
      sqft: 32000, facilityTypeKey: "warehouse", scopeLevel: "standard", windowHours: 4,
    });
    return { office, warehouse };
  }, [facilities, scopes, tiers, settings]);

  if (loading) {
    return <div className="space-y-3">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28 w-full" />)}</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-xs text-slate-600">
        <span className="font-semibold text-slate-800">
          price = sq ft × facility base rate × scope multiplier × size tier multiplier
        </span>
        {" — "}never a residential sqft band applied to a commercial job. These are starting values; tune them from
        completed job data the way the zone multipliers were tuned. Edits apply to future quotes only.
      </div>

      {/* Worked examples against the live config. */}
      <Card><CardContent className="p-4 space-y-2">
        <p className="text-sm font-bold text-slate-800">What the current config produces</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-violet-200 bg-violet-50/60 p-3">
            <p className="text-xs font-semibold text-violet-700">1,800 sq ft office · Standard · 4h window</p>
            {preview.office.ok ? (
              <>
                <p className="text-lg font-bold text-violet-900">
                  {preview.office.requiresWalkthrough
                    ? `${formatCents(preview.office.estimateLowCents)} – ${formatCents(preview.office.estimateHighCents)}`
                    : formatCents(preview.office.formulaCents)}
                </p>
                <p className="text-[11px] text-slate-600">
                  {preview.office.requiresWalkthrough ? "Walkthrough required" : "Instant quote — no walkthrough"}
                  {preview.office.crew ? ` · crew of ${preview.office.crew.crewSize}` : ""}
                </p>
              </>
            ) : <p className="text-xs text-rose-600">{preview.office.error}</p>}
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
            <p className="text-xs font-semibold text-amber-700">32,000 sq ft warehouse · Standard · 4h window</p>
            {preview.warehouse.ok ? (
              <>
                <p className="text-lg font-bold text-amber-900">
                  {preview.warehouse.requiresWalkthrough
                    ? `${formatCents(preview.warehouse.estimateLowCents)} – ${formatCents(preview.warehouse.estimateHighCents)}`
                    : formatCents(preview.warehouse.formulaCents)}
                </p>
                <p className="text-[11px] text-slate-600">
                  {preview.warehouse.requiresWalkthrough ? "Walkthrough required — estimate only" : "Instant quote"}
                  {preview.warehouse.crew ? ` · crew of ${preview.warehouse.crew.crewSize}` : ""}
                </p>
              </>
            ) : <p className="text-xs text-rose-600">{preview.warehouse.error}</p>}
          </div>
        </div>
      </CardContent></Card>

      {/* 1. Facility types */}
      <Card><CardContent className="p-4 space-y-3">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <RiBuilding2Line className="w-4 h-4 text-violet-600" /> Facility types — base $/sq ft
        </p>
        <div className="space-y-2">
          {facilities.map((f) => (
            <EditableRow key={f.id} busy={saving === f.id}
              onSave={(patch) => saveRow("facility_type", f.id, patch)}
              onDelete={() => removeRow("facility_type", f.id)}
              fields={[
                { name: "label", label: "Label", value: f.label, width: "flex-1 min-w-[140px]" },
                { name: "base_rate_cents_per_sqft", label: "Cents/sqft", value: f.base_rate_cents_per_sqft, type: "number", step: "0.1", width: "w-28" },
                { name: "sort_order", label: "Order", value: f.sort_order, type: "number", width: "w-20" },
              ]}
              badge={<Badge variant="outline" className="font-mono text-[10px]">{f.key}</Badge>}
              note={`$${(Number(f.base_rate_cents_per_sqft) / 100).toFixed(4)} per sq ft${f.active ? "" : " · inactive"}`}
            />
          ))}
        </div>
        <AddFacility busy={saving === "facility_type"} onAdd={(row) => addRow("facility_type", row)} />
      </CardContent></Card>

      {/* 2. Scope levels */}
      <Card><CardContent className="p-4 space-y-3">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <RiScales3Line className="w-4 h-4 text-violet-600" /> Scope levels — depth multiplier &amp; crew throughput
        </p>
        <p className="text-xs text-slate-500">
          The multiplier prices the depth. Square feet per cleaner-hour is how fast one cleaner covers ground at that
          depth — it&apos;s what sizes the crew against the service window, so a change here moves recommended crews.
        </p>
        <div className="space-y-2">
          {scopes.map((s) => (
            <EditableRow key={s.id} busy={saving === s.id}
              onSave={(patch) => saveRow("scope_level", s.id, patch)}
              fields={[
                { name: "label", label: "Label", value: s.label, width: "w-32" },
                { name: "multiplier", label: "Multiplier", value: s.multiplier, type: "number", step: "0.05", width: "w-24" },
                { name: "sqft_per_cleaner_hour", label: "Sqft/cleaner-hr", value: s.sqft_per_cleaner_hour, type: "number", step: "50", width: "w-32" },
                { name: "summary", label: "Summary", value: s.summary || "", width: "flex-1 min-w-[200px]" },
              ]}
              badge={<Badge variant="outline" className="font-mono text-[10px]">{s.key}</Badge>}
            />
          ))}
        </div>
      </CardContent></Card>

      {/* 3. Size tiers */}
      <Card><CardContent className="p-4 space-y-3">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <RiRulerLine className="w-4 h-4 text-violet-600" /> Size tiers — economies of scale
        </p>
        <p className="text-xs text-slate-500">
          Multipliers fall as area grows: fixed setup and travel spread across more square feet, and larger jobs are
          more efficient per labour-hour. Bands can&apos;t overlap — the database refuses an ambiguous multiplier.
        </p>
        <div className="space-y-2">
          {tiers.map((t) => (
            <EditableRow key={t.id} busy={saving === t.id}
              onSave={(patch) => saveRow("size_tier", t.id, {
                ...patch,
                max_sqft: patch.max_sqft === "" || patch.max_sqft == null ? null : Number(patch.max_sqft),
              })}
              onDelete={() => removeRow("size_tier", t.id)}
              fields={[
                { name: "label", label: "Label", value: t.label, width: "flex-1 min-w-[150px]" },
                { name: "min_sqft", label: "Min sqft", value: t.min_sqft, type: "number", width: "w-28" },
                { name: "max_sqft", label: "Max sqft", value: t.max_sqft ?? "", type: "number", width: "w-28" },
                { name: "multiplier", label: "Multiplier", value: t.multiplier, type: "number", step: "0.05", width: "w-24" },
              ]}
              note={t.max_sqft == null ? "open-ended — and above" : undefined}
            />
          ))}
        </div>
        <AddTier busy={saving === "size_tier"} onAdd={(row) => addRow("size_tier", row)} />
      </CardContent></Card>

      {/* 4. Tunables */}
      <Card><CardContent className="p-4 space-y-3">
        <p className="text-sm font-bold text-slate-800 flex items-center gap-1.5">
          <RiShieldCheckLine className="w-4 h-4 text-violet-600" /> Thresholds, crew model &amp; documentation
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {SETTING_FIELDS.map((f) => (
            <div key={String(f.key)}>
              <Label className="text-xs">{f.label}</Label>
              <Input type="number" step={f.step || "1"}
                value={String(settings[f.key] ?? "")}
                onChange={(e) => setSettings((s) => ({ ...s, [f.key]: Number(e.target.value) }))}
                className="mt-1 h-8 text-xs" />
              <p className="text-[10px] text-slate-400 mt-0.5">{f.help}</p>
            </div>
          ))}
        </div>
        <Button size="sm" disabled={saving === "settings"}
          onClick={async () => {
            setSaving("settings");
            try {
              await api("PUT", { kind: "settings", settings });
              toast.success("Saved.");
              await load();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Save failed");
            } finally {
              setSaving(null);
            }
          }}>
          {saving === "settings" ? <RiLoader4Line className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RiSaveLine className="w-3.5 h-3.5 mr-1.5" />}
          Save settings
        </Button>
      </CardContent></Card>
    </div>
  );
}

// ─── Row editor ────────────────────────────────────────────────────────────

interface FieldSpec {
  name: string;
  label: string;
  value: string | number;
  type?: string;
  step?: string;
  width?: string;
}

function EditableRow({
  fields, badge, note, busy, onSave, onDelete,
}: {
  fields: FieldSpec[];
  badge?: React.ReactNode;
  note?: string;
  busy: boolean;
  onSave: (patch: Record<string, unknown>) => void | Promise<void>;
  onDelete?: () => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(
    () => Object.fromEntries(fields.map((f) => [f.name, String(f.value ?? "")])),
  );
  const dirty = fields.some((f) => String(f.value ?? "") !== draft[f.name]);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-2.5 space-y-1.5">
      <div className="flex flex-wrap items-end gap-2">
        {badge}
        {fields.map((f) => (
          <div key={f.name} className={f.width || "w-28"}>
            <Label className="text-[10px] text-slate-500">{f.label}</Label>
            <Input type={f.type || "text"} step={f.step} value={draft[f.name]}
              onChange={(e) => setDraft((d) => ({ ...d, [f.name]: e.target.value }))}
              className="h-8 text-xs mt-0.5" />
          </div>
        ))}
        <Button size="sm" className="h-8 text-xs" disabled={!dirty || busy}
          onClick={() => onSave(Object.fromEntries(
            fields.map((f) => [
              f.name,
              f.type === "number"
                ? (draft[f.name] === "" ? null : Number(draft[f.name]))
                : draft[f.name],
            ]),
          ))}>
          {busy ? <RiLoader4Line className="w-3.5 h-3.5 animate-spin" /> : "Save"}
        </Button>
        {onDelete && (
          <Button size="sm" variant="ghost" className="h-8 text-xs text-rose-600" disabled={busy}
            onClick={() => void onDelete()}>
            <RiDeleteBinLine className="w-3.5 h-3.5" />
          </Button>
        )}
      </div>
      {note && <p className="text-[10px] text-slate-400">{note}</p>}
    </div>
  );
}

function AddFacility({ busy, onAdd }: { busy: boolean; onAdd: (row: Record<string, unknown>) => void }) {
  const [key, setKey] = useState("");
  const [label, setLabel] = useState("");
  const [rate, setRate] = useState("");
  const valid = key.trim() && label.trim() && Number(rate) > 0;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-300 p-2.5">
      <div className="w-32">
        <Label className="text-[10px] text-slate-500">Key</Label>
        <Input value={key} onChange={(e) => setKey(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
          placeholder="school" className="h-8 text-xs mt-0.5 font-mono" />
      </div>
      <div className="flex-1 min-w-[140px]">
        <Label className="text-[10px] text-slate-500">Label</Label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="School / Education" className="h-8 text-xs mt-0.5" />
      </div>
      <div className="w-28">
        <Label className="text-[10px] text-slate-500">Cents/sqft</Label>
        <Input type="number" step="0.1" value={rate} onChange={(e) => setRate(e.target.value)} className="h-8 text-xs mt-0.5" />
      </div>
      <Button size="sm" className="h-8 text-xs" disabled={!valid || busy}
        onClick={() => {
          onAdd({ key: key.trim(), label: label.trim(), base_rate_cents_per_sqft: Number(rate), sort_order: 90 });
          setKey(""); setLabel(""); setRate("");
        }}>
        <RiAddLine className="w-3.5 h-3.5 mr-1" /> Add facility type
      </Button>
    </div>
  );
}

function AddTier({ busy, onAdd }: { busy: boolean; onAdd: (row: Record<string, unknown>) => void }) {
  const [label, setLabel] = useState("");
  const [min, setMin] = useState("");
  const [max, setMax] = useState("");
  const [mult, setMult] = useState("");
  const valid = label.trim() && min !== "" && Number(mult) > 0;
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-slate-300 p-2.5">
      <div className="flex-1 min-w-[150px]">
        <Label className="text-[10px] text-slate-500">Label</Label>
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="50,000+ sq ft" className="h-8 text-xs mt-0.5" />
      </div>
      <div className="w-28">
        <Label className="text-[10px] text-slate-500">Min sqft</Label>
        <Input type="number" value={min} onChange={(e) => setMin(e.target.value)} className="h-8 text-xs mt-0.5" />
      </div>
      <div className="w-28">
        <Label className="text-[10px] text-slate-500">Max sqft</Label>
        <Input type="number" value={max} onChange={(e) => setMax(e.target.value)} placeholder="blank = open" className="h-8 text-xs mt-0.5" />
      </div>
      <div className="w-24">
        <Label className="text-[10px] text-slate-500">Multiplier</Label>
        <Input type="number" step="0.05" value={mult} onChange={(e) => setMult(e.target.value)} className="h-8 text-xs mt-0.5" />
      </div>
      <Button size="sm" className="h-8 text-xs" disabled={!valid || busy}
        onClick={() => {
          onAdd({
            label: label.trim(),
            min_sqft: Number(min),
            max_sqft: max === "" ? null : Number(max),
            multiplier: Number(mult),
          });
          setLabel(""); setMin(""); setMax(""); setMult("");
        }}>
        <RiAddLine className="w-3.5 h-3.5 mr-1" /> Add band
      </Button>
    </div>
  );
}
