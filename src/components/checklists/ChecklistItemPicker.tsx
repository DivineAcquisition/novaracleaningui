"use client";

// Tag a QC case or a re-clean's targeted scope with the checklist items it
// actually relates to. The stored value is the stable item ID, so the tag
// keeps pointing at the same item after the wording is edited.
//
// Not every case maps to a checklist item — a scheduling complaint has none —
// so this is always optional and says so.

import { useEffect, useMemo, useState } from "react";
import { RiCheckLine, RiSearchLine } from "@remixicon/react";

import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { CATALOG_ITEMS, type CatalogItem } from "@/lib/checklist-catalog";
import { cn } from "@/lib/utils";

interface LiveItem {
  item_id: string;
  item_text: string;
  area: string;
  checklists: string[];
}

/** Live wording when the catalog has been synced; the catalog otherwise. */
function useChecklistItems(): LiveItem[] {
  const [live, setLive] = useState<LiveItem[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const res = await fetch("/api/admin/checklists", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) return;
        const out = await res.json();
        if (!cancelled && Array.isArray(out?.items) && out.items.length > 0) {
          setLive(out.items as LiveItem[]);
        }
      } catch {
        // Catalog fallback is fine — IDs are the same either way.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return useMemo(
    () =>
      live ??
      CATALOG_ITEMS.map((i: CatalogItem) => ({
        item_id: i.id,
        item_text: i.text,
        area: i.area,
        checklists: i.checklists,
      })),
    [live],
  );
}

export function ChecklistItemPicker({
  value,
  onChange,
  label = "Checklist items involved",
  hint = "Optional — tag the items this relates to so the pattern is visible across jobs. Not every case maps to one.",
  filterPrefix,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  label?: string;
  hint?: string;
  /** Narrow to a family, e.g. "commercial." or "str." */
  filterPrefix?: string;
}) {
  const items = useChecklistItems();
  const [query, setQuery] = useState("");

  const pool = useMemo(() => {
    const base = filterPrefix
      ? items.filter((i) => i.item_id.startsWith(filterPrefix))
      : items;
    const q = query.trim().toLowerCase();
    if (!q) return base.slice(0, 40);
    return base
      .filter(
        (i) =>
          i.item_text.toLowerCase().includes(q) ||
          i.area.toLowerCase().includes(q) ||
          i.item_id.toLowerCase().includes(q),
      )
      .slice(0, 40);
  }, [items, query, filterPrefix]);

  const selected = useMemo(
    () => items.filter((i) => value.includes(i.item_id)),
    [items, value],
  );

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  return (
    <div className="space-y-2">
      <div>
        <p className="text-xs font-semibold text-slate-700">{label}</p>
        <p className="text-[11px] text-slate-500">{hint}</p>
      </div>

      {selected.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selected.map((i) => (
            <button
              key={i.item_id}
              type="button"
              onClick={() => toggle(i.item_id)}
              className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-medium text-violet-800 hover:bg-violet-200"
              title={i.item_id}
            >
              <RiCheckLine className="w-3 h-3" />
              {i.item_text.length > 42 ? `${i.item_text.slice(0, 42)}…` : i.item_text}
            </button>
          ))}
        </div>
      )}

      <div className="relative">
        <RiSearchLine className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search checklist items…"
          className="h-8 pl-7 text-xs"
        />
      </div>

      <div className="max-h-44 overflow-y-auto rounded-lg border border-slate-200 divide-y divide-slate-100">
        {pool.length === 0 ? (
          <p className="px-3 py-2 text-xs text-slate-500">No matching item.</p>
        ) : (
          pool.map((i) => {
            const on = value.includes(i.item_id);
            return (
              <button
                key={i.item_id}
                type="button"
                onClick={() => toggle(i.item_id)}
                className={cn(
                  "w-full text-left px-3 py-1.5 text-xs transition-colors",
                  on ? "bg-violet-50 text-violet-900" : "hover:bg-slate-50 text-slate-700",
                )}
              >
                <span className="flex items-start gap-2">
                  <span
                    className={cn(
                      "mt-0.5 w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center",
                      on ? "bg-violet-600 border-violet-600" : "border-slate-300",
                    )}
                  >
                    {on && <RiCheckLine className="w-2.5 h-2.5 text-white" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block">{i.item_text}</span>
                    <span className="block text-[10px] text-slate-400">{i.area} · {i.item_id}</span>
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
