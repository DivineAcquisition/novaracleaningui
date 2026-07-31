"use client";

// Admin editor for focused-clean per-area checklist content.
// Persists to app_settings.focused_same_day_settings.checklists — no deploy needed.

import { useCallback, useEffect, useState } from "react";
import { RiAddLine, RiDeleteBinLine, RiLoader4Line, RiSaveLine } from "@remixicon/react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  DEFAULT_FOCUSED_AREA_CHECKLISTS,
  FOCUSED_SAME_DAY_DEFAULTS,
  FOCUSED_SAME_DAY_SETTINGS_KEY,
  mergeFocusedSameDaySettings,
  type FocusedSameDaySettings,
} from "@/lib/focused-same-day";

export function FocusedChecklistEditor() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settings, setSettings] = useState<FocusedSameDaySettings>(FOCUSED_SAME_DAY_DEFAULTS);
  const [activeId, setActiveId] = useState<string>("bathroom");
  const [draftLines, setDraftLines] = useState("");
  const [newAreaId, setNewAreaId] = useState("");
  const [newAreaLabel, setNewAreaLabel] = useState("");
  const [newAreaPrice, setNewAreaPrice] = useState("65");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await (supabase.from as any)("app_settings")
        .select("value")
        .eq("key", FOCUSED_SAME_DAY_SETTINGS_KEY)
        .maybeSingle();
      if (error) throw error;
      const merged = mergeFocusedSameDaySettings(data?.value || null);
      setSettings(merged);
      const first = merged.areas[0]?.id || "bathroom";
      setActiveId(first);
      setDraftLines((merged.checklists[first] || []).join("\n"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't load focused checklists");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectArea = (id: string) => {
    setActiveId(id);
    setDraftLines((settings.checklists[id] || DEFAULT_FOCUSED_AREA_CHECKLISTS[id] || []).join("\n"));
  };

  const save = async () => {
    setSaving(true);
    try {
      const lines = draftLines
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      if (lines.length === 0) {
        toast.error("Checklist needs at least one item");
        return;
      }
      const next: FocusedSameDaySettings = {
        ...settings,
        checklists: { ...settings.checklists, [activeId]: lines },
      };
      const { error } = await (supabase.from as any)("app_settings").upsert(
        {
          key: FOCUSED_SAME_DAY_SETTINGS_KEY,
          value: next,
          description:
            "Focused/single-area flat rates, checklists, condition multipliers, and same-day settings.",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
      if (error) throw error;
      setSettings(next);
      toast.success("Focused checklist saved — new bookings use this list");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const addAreaType = async () => {
    const id = newAreaId.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const label = newAreaLabel.trim();
    const price = Number(newAreaPrice);
    if (!id || !label || !Number.isFinite(price) || price <= 0) {
      toast.error("Need a valid id, label, and price");
      return;
    }
    if (settings.areas.some((a) => a.id === id) || settings.checklists[id]) {
      toast.error("That area id already exists");
      return;
    }
    setSaving(true);
    try {
      const next: FocusedSameDaySettings = {
        ...settings,
        areas: [...settings.areas, { id, label, price, quantity: false }],
        checklists: {
          ...settings.checklists,
          [id]: [...(DEFAULT_FOCUSED_AREA_CHECKLISTS.other || [])],
        },
      };
      const { error } = await (supabase.from as any)("app_settings").upsert(
        {
          key: FOCUSED_SAME_DAY_SETTINGS_KEY,
          value: next,
          description:
            "Focused/single-area flat rates, checklists, condition multipliers, and same-day settings.",
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" },
      );
      if (error) throw error;
      setSettings(next);
      setNewAreaId("");
      setNewAreaLabel("");
      setNewAreaPrice("65");
      selectArea(id);
      toast.success(`Added area type "${label}"`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't add area type");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-8 text-sm text-slate-500 flex items-center justify-center gap-2">
        <RiLoader4Line className="w-4 h-4 animate-spin" /> Loading focused checklists…
      </div>
    );
  }

  const areaIds = Array.from(
    new Set([...settings.areas.map((a) => a.id), ...Object.keys(settings.checklists)]),
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100">
        <h2 className="font-bold text-slate-900">Focused clean checklists</h2>
        <p className="text-xs text-slate-500 mt-0.5">
          Full per-area standards used on contractor checklists. Edit items or add area types — saves to
          settings, no deploy.
        </p>
      </div>
      <div className="p-5 grid gap-4 lg:grid-cols-[200px_1fr]">
        <div className="space-y-1">
          {areaIds.map((id) => {
            const label = settings.areas.find((a) => a.id === id)?.label || id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectArea(id)}
                className={`w-full text-left rounded-lg px-3 py-2 text-sm font-medium ${
                  activeId === id ? "bg-violet-600 text-white" : "bg-slate-50 text-slate-700 hover:bg-slate-100"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>
        <div className="space-y-3">
          <textarea
            value={draftLines}
            onChange={(e) => setDraftLines(e.target.value)}
            rows={14}
            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-violet-300"
            placeholder="One checklist item per line"
          />
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void save()} disabled={saving}>
              {saving ? <RiLoader4Line className="w-4 h-4 animate-spin mr-1.5" /> : <RiSaveLine className="w-4 h-4 mr-1.5" />}
              Save {settings.areas.find((a) => a.id === activeId)?.label || activeId}
            </Button>
            <Button
              variant="outline"
              onClick={() => setDraftLines((DEFAULT_FOCUSED_AREA_CHECKLISTS[activeId] || DEFAULT_FOCUSED_AREA_CHECKLISTS.other).join("\n"))}
            >
              Reset to default
            </Button>
          </div>

          <div className="rounded-xl border border-dashed border-slate-200 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <RiAddLine className="w-3.5 h-3.5" /> New area type
            </p>
            <div className="grid sm:grid-cols-3 gap-2">
              <input
                value={newAreaId}
                onChange={(e) => setNewAreaId(e.target.value)}
                placeholder="id (e.g. laundry)"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                value={newAreaLabel}
                onChange={(e) => setNewAreaLabel(e.target.value)}
                placeholder="Label"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
              <input
                value={newAreaPrice}
                onChange={(e) => setNewAreaPrice(e.target.value)}
                placeholder="Price"
                type="number"
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </div>
            <Button variant="outline" size="sm" disabled={saving} onClick={() => void addAreaType()}>
              <RiAddLine className="w-4 h-4 mr-1" /> Add area type with default checklist
            </Button>
            <p className="text-[11px] text-slate-400 flex items-start gap-1">
              <RiDeleteBinLine className="w-3 h-3 mt-0.5 shrink-0" />
              Removing area types is intentional left out — deactivate by clearing price in settings if needed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
