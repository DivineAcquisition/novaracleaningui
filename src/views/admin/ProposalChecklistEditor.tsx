"use client";

import { useMemo, useState } from "react";
import {
  RiAddLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiCheckboxCircleFill,
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
import { proposalApi } from "@/lib/proposal-request-api";
import {
  CHECKLISTS,
  CHECKLIST_SLUGS,
  type ChecklistSlug,
} from "@/lib/checklists";
import {
  SCOPE_TEMPLATE_LABEL,
  isScopeTemplate,
  scopeSectionsFromTemplate,
  type ScopeChecklistSection,
  type ScopeTemplateKey,
} from "@/lib/proposal-scope-checklists";
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

function ScopeSectionEditor({
  sections,
  onChange,
}: {
  sections: ScopeChecklistSection[];
  onChange: (next: ScopeChecklistSection[]) => void;
}) {
  const patch = (i: number, next: ScopeChecklistSection) =>
    onChange(sections.map((section, idx) => (idx === i ? next : section)));
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const next = [...sections];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
        {sections.map((section, i) => (
          <div key={`${section.title}-${i}`} className="rounded-xl border border-slate-200 bg-white overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center shrink-0">
                <RiCheckboxCircleFill className="w-4 h-4 text-violet-600" />
              </div>
              <Input
                value={section.title}
                onChange={(e) => patch(i, { ...section, title: e.target.value })}
                className="h-8 font-semibold"
                placeholder="Kitchen"
              />
              <div className="flex gap-1 shrink-0">
                <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => move(i, -1)}>
                  <RiArrowUpLine className="w-3.5 h-3.5" />
                </Button>
                <Button type="button" size="icon" variant="outline" className="h-8 w-8" onClick={() => move(i, 1)}>
                  <RiArrowDownLine className="w-3.5 h-3.5" />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="h-8 w-8"
                  onClick={() => onChange(sections.filter((_, idx) => idx !== i))}
                >
                  <RiDeleteBinLine className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>
            <div className="p-3 space-y-2">
              {section.items.map((item, itemIdx) => (
                <div key={`${i}-${itemIdx}`} className="flex items-start gap-2">
                  <RiCheckboxCircleFill className="w-4 h-4 mt-2 shrink-0 text-violet-600" />
                  <Input
                    value={item}
                    onChange={(e) => {
                      const items = [...section.items];
                      items[itemIdx] = e.target.value;
                      patch(i, { ...section, items });
                    }}
                    className="h-8 text-sm"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    onClick={() => patch(i, { ...section, items: section.items.filter((_, idx) => idx !== itemIdx) })}
                  >
                    <RiDeleteBinLine className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => patch(i, { ...section, items: [...section.items, ""] })}
              >
                <RiAddLine className="w-3.5 h-3.5 mr-1" /> Add line
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...sections, { title: "New section", items: [""] }])}
      >
        <RiAddLine className="w-4 h-4 mr-1" /> Add section
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
  const [section, setSection] = useState<"universal" | "scope" | "type" | "intake">("scope");
  const [typeKey, setTypeKey] = useState(catalog.types[0]?.key || "office");
  const [saving, setSaving] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newKey, setNewKey] = useState("");
  const [pendingTemplate, setPendingTemplate] = useState<ScopeTemplateKey | null>(null);

  const findings = useMemo(() => {
    if (section === "universal") return local.universal;
    if (section === "intake") return local.intakeByType[typeKey] || [];
    return local.byType[typeKey] || [];
  }, [local, section, typeKey]);

  const setFindings = (next: ChecklistItem[]) => {
    if (section === "universal") setLocal((c) => ({ ...c, universal: next }));
    else if (section === "intake") setLocal((c) => ({ ...c, intakeByType: { ...c.intakeByType, [typeKey]: next } }));
    else setLocal((c) => ({ ...c, byType: { ...c.byType, [typeKey]: next } }));
  };

  const scopeSections = local.scopeByType?.[typeKey] || [];
  const scopeTemplate = (pendingTemplate || local.scopeTemplateByType?.[typeKey] || "standard-clean") as ScopeTemplateKey;

  const applyTemplate = (slug: ScopeTemplateKey) => {
    setLocal((c) => ({
      ...c,
      scopeTemplateByType: { ...c.scopeTemplateByType, [typeKey]: slug },
      scopeByType: { ...c.scopeByType, [typeKey]: scopeSectionsFromTemplate(slug) },
    }));
    setPendingTemplate(slug);
    toast.success(`Loaded ${SCOPE_TEMPLATE_LABEL[slug]} — save to put it on new walkthroughs.`);
  };

  const save = async () => {
    setSaving(true);
    try {
      const out = await proposalApi.saveChecklists({ action: "save", catalog: local });
      onSaved(out.catalog);
      setLocal(out.catalog);
      toast.success("Checklists saved — no deploy needed. New walkthroughs use this content.");
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
        setSection("scope");
      }
      setNewLabel(""); setNewKey("");
      toast.success(`Added property type "${newLabel}"`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add type");
    } finally {
      setSaving(false);
    }
  };

  const published = CHECKLISTS[scopeTemplate as ChecklistSlug];

  return (
    <div className="rounded-2xl border border-slate-200 bg-white overflow-hidden">
      <div className="px-5 py-4 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-bold text-slate-900">Walkthrough checklists</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            The tokenized agent link shows the same section cards as a residential job — Kitchen, Bathrooms, All rooms —
            then the pricing findings. Pick a published list, edit the lines, save.
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
          {local.types.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => {
                setTypeKey(t.key);
                setPendingTemplate(null);
                if (section === "universal") setSection("scope");
              }}
              className={cn(
                "w-full text-left rounded-lg px-3 py-2 text-sm font-medium",
                typeKey === t.key && section !== "universal" ? "bg-violet-600 text-white" : "bg-slate-50 text-slate-700",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="space-y-4">
          {section !== "universal" && (
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" variant={section === "scope" ? "default" : "outline"} onClick={() => setSection("scope")}>
                Scope checklist
              </Button>
              <Button type="button" size="sm" variant={section === "type" ? "default" : "outline"} onClick={() => setSection("type")}>
                On-site findings
              </Button>
              <Button type="button" size="sm" variant={section === "intake" ? "default" : "outline"} onClick={() => setSection("intake")}>
                Light intake
              </Button>
            </div>
          )}

          {section === "scope" ? (
            <div className="space-y-4">
              <div className="rounded-xl border border-violet-200 bg-violet-50/60 px-4 py-3 text-sm text-slate-700">
                {published ? (
                  <>
                    <p className="font-semibold text-slate-900">{published.name}</p>
                    <p className="text-xs text-slate-600 mt-0.5">{published.tagline}</p>
                  </>
                ) : (
                  <p>Same card layout the public residential checklist uses. The walkthrough link ticks these lines.</p>
                )}
              </div>
              <div className="flex flex-col sm:flex-row sm:items-end gap-2">
                <div className="flex-1">
                  <Label className="text-[10px] text-slate-500">Start from a published list</Label>
                  <Select
                    value={isScopeTemplate(scopeTemplate) ? scopeTemplate : "standard-clean"}
                    onValueChange={(v) => setPendingTemplate(v as ScopeTemplateKey)}
                  >
                    <SelectTrigger className="mt-0.5"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CHECKLIST_SLUGS.map((slug) => (
                        <SelectItem key={slug} value={slug}>{SCOPE_TEMPLATE_LABEL[slug]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => applyTemplate(scopeTemplate)}
                >
                  Load list
                </Button>
              </div>
              <ScopeSectionEditor
                sections={scopeSections}
                onChange={(next) => setLocal((c) => ({
                  ...c,
                  scopeByType: { ...c.scopeByType, [typeKey]: next },
                }))}
              />
            </div>
          ) : (
            <ItemEditor items={findings} onChange={setFindings} />
          )}

          <div className="rounded-xl border border-dashed border-slate-200 p-3 space-y-2">
            <p className="text-xs font-semibold text-slate-700 flex items-center gap-1">
              <RiAddLine className="w-3.5 h-3.5" /> New property type
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
              Add type with empty findings + a Standard commercial scope
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
