"use client";

import { useMemo, useState } from "react";
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiDeleteBinLine,
  RiLoader4Line,
  RiSaveLine,
} from "@remixicon/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ChecklistItem, ChecklistFieldKind, ProposalChecklists } from "@/lib/proposal-request";
import { typeRequiresWalkthrough } from "@/lib/proposal-request";
import { proposalApi } from "@/lib/proposal-request-api";
import { cn } from "@/lib/utils";

const KINDS: ChecklistFieldKind[] = [
  "integer", "number", "text", "textarea", "select", "yesno", "time", "floor_share", "exclusion", "media",
];

function ItemEditor({
  items,
  onChange,
}: {
  items: ChecklistItem[];
  onChange: (next: ChecklistItem[]) => void;
}) {
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= items.length) return;
    const next = [...items];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const patch = (i: number, p: Partial<ChecklistItem>) =>
    onChange(items.map((it, idx) => (idx === i ? { ...it, ...p } : it)));

  return (
    <div className="space-y-3">
      {items.map((item, i) => (
        <div key={`${item.key}-${i}`} className="rounded-xl border border-slate-200 p-3 space-y-2">
          <div className="grid sm:grid-cols-[1fr_140px_auto] gap-2">
            <Input value={item.label} onChange={(e) => patch(i, { label: e.target.value })} placeholder="Label" />
            <Select value={item.kind} onValueChange={(v) => patch(i, { kind: v as ChecklistFieldKind })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
              </SelectContent>
            </Select>
            <div className="flex gap-1">
              <Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={() => move(i, -1)}><RiArrowUpLine className="w-4 h-4" /></Button>
              <Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={() => move(i, 1)}><RiArrowDownLine className="w-4 h-4" /></Button>
              <Button type="button" size="icon" variant="outline" className="h-9 w-9" onClick={() => onChange(items.filter((_, idx) => idx !== i))}><RiDeleteBinLine className="w-4 h-4" /></Button>
            </div>
          </div>
          <Input value={item.key} onChange={(e) => patch(i, { key: e.target.value })} placeholder="key" className="font-mono text-xs" />
          <Textarea rows={2} value={item.help || ""} onChange={(e) => patch(i, { help: e.target.value })} placeholder="Help text (optional)" className="text-xs" />
          <label className="flex items-center gap-2 text-xs text-slate-600">
            <input type="checkbox" checked={Boolean(item.required)} onChange={(e) => patch(i, { required: e.target.checked })} className="rounded" />
            Required
          </label>
          {(item.kind === "select" || item.kind === "multiselect") && (
            <Textarea
              rows={3}
              className="text-xs font-mono"
              value={(item.options || []).map((o) => `${o.value}|${o.label}`).join("\n")}
              onChange={(e) => patch(i, {
                options: e.target.value.split("\n").map((line) => {
                  const [value, ...rest] = line.split("|");
                  return { value: value.trim(), label: (rest.join("|") || value).trim() };
                }).filter((o) => o.value),
              })}
              placeholder="value|Label per line"
            />
          )}
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...items, { key: `item_${items.length + 1}`, label: "New item", kind: "textarea" }])}
      >
        <RiAddLine className="w-4 h-4 mr-1" /> Add item
      </Button>
    </div>
  );
}

export default function ProposalChecklistEditor({
  catalog,
  onSaved,
}: {
  catalog: ProposalChecklists;
  onSaved: (next: ProposalChecklists) => void;
}) {
  const [local, setLocal] = useState(catalog);
  const [section, setSection] = useState<"universal" | "extras" | "intake">("universal");
  const [typeKey, setTypeKey] = useState(catalog.types.find((t) => t.key === "office")?.key || catalog.types[0]?.key || "office");
  const [saving, setSaving] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");

  const findings = useMemo(() => {
    if (section === "universal") return local.universal;
    if (section === "extras") return local.siteExtras || [];
    return local.intakeByType[typeKey] || [];
  }, [local, section, typeKey]);

  const setFindings = (next: ChecklistItem[]) => {
    if (section === "universal") setLocal((c) => ({ ...c, universal: next }));
    else if (section === "extras") setLocal((c) => ({ ...c, siteExtras: next }));
    else setLocal((c) => ({ ...c, intakeByType: { ...c.intakeByType, [typeKey]: next } }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const out = await proposalApi.saveChecklists({ action: "save", catalog: local });
      onSaved(out.catalog);
      setLocal(out.catalog);
      toast.success("Site findings saved — office and commercial walkthroughs share this list. STR skips the visit.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  };

  const addType = async () => {
    if (!newLabel.trim()) return;
    setSaving(true);
    try {
      const out = await proposalApi.saveChecklists({ action: "add_type", label: newLabel, key: newKey });
      onSaved(out.catalog);
      setLocal(out.catalog);
      const added = out.catalog.types[out.catalog.types.length - 1];
      if (added) {
        setTypeKey(added.key);
        setSection("intake");
      }
      setNewLabel(""); setNewKey("");
      toast.success(`Added property type "${newLabel}" — it uses the same site findings. Edit light intake if needed.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add type");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-slate-900">Site findings</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            One setup for office and commercial walkthroughs. STR properties skip the visit —
            they are residential and priced from bedrooms, bathrooms, and linen on the host record.
            Assigned-cleaner job lists stay on a separate token after dispatch.
          </p>
        </div>
        <Button onClick={() => void save()} disabled={saving}>
          {saving ? <RiLoader4Line className="w-4 h-4 mr-1.5 animate-spin" /> : <RiSaveLine className="w-4 h-4 mr-1.5" />}
          Save
        </Button>
      </div>
      <div className="p-5 grid gap-4 lg:grid-cols-[220px_1fr]">
        <div className="space-y-1">
          <button
            type="button"
            onClick={() => setSection("universal")}
            className={cn(
              "w-full text-left rounded-lg px-3 py-2 text-sm font-medium",
              section === "universal" ? "bg-violet-600 text-white" : "bg-slate-50 text-slate-700",
            )}
          >
            Universal findings
          </button>
          <button
            type="button"
            onClick={() => setSection("extras")}
            className={cn(
              "w-full text-left rounded-lg px-3 py-2 text-sm font-medium",
              section === "extras" ? "bg-violet-600 text-white" : "bg-slate-50 text-slate-700",
            )}
          >
            Additional findings
          </button>
          <button
            type="button"
            onClick={() => setSection("intake")}
            className={cn(
              "w-full text-left rounded-lg px-3 py-2 text-sm font-medium",
              section === "intake" ? "bg-violet-600 text-white" : "bg-slate-50 text-slate-700",
            )}
          >
            Light intake
          </button>
        </div>
        <div className="space-y-4">
          {section === "extras" && (
            <p className="text-xs text-slate-500 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2">
              These questions appear on every office and commercial walkthrough after the universal
              fields. Keep them optional unless every site needs the answer.
            </p>
          )}
          {section === "intake" && (
            <div className="space-y-2">
              <p className="text-xs text-slate-500">
                Intake is still per type — STR asks beds/baths/linen; office asks desks. This is not the walkthrough.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {local.types.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => setTypeKey(t.key)}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium border",
                      typeKey === t.key
                        ? "border-violet-500 bg-violet-50 text-violet-900"
                        : "border-slate-200 bg-white text-slate-600",
                    )}
                  >
                    {t.shortLabel}
                    {!typeRequiresWalkthrough(t) ? " · no walkthrough" : ""}
                  </button>
                ))}
              </div>
            </div>
          )}

          <ItemEditor items={findings} onChange={setFindings} />

          <div className="rounded-xl border border-dashed border-slate-200 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <RiAddLine className="w-3.5 h-3.5" /> New property type
            </p>
            <p className="text-[11px] text-slate-500">
              New types share this site-findings setup and get their own light intake.
            </p>
            <div className="grid sm:grid-cols-2 gap-2">
              <div>
                <Label className="text-[10px] text-slate-500">Label</Label>
                <Input className="mt-0.5" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="e.g. School / Daycare" />
              </div>
              <div>
                <Label className="text-[10px] text-slate-500">Key (optional)</Label>
                <Input className="mt-0.5 font-mono" value={newKey} onChange={(e) => setNewKey(e.target.value)} placeholder="school" />
              </div>
            </div>
            <Button variant="outline" size="sm" disabled={saving} onClick={() => void addType()}>
              Add type
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
