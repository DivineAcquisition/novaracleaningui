"use client";

import type { ChecklistItem } from "@/lib/proposal-request";
import { ACCESS_OPTIONS, WALKTHROUGH_EXCLUSION_CODES } from "@/lib/proposal-request";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const FLOOR_KEYS = [
  { key: "carpet", label: "Carpet" },
  { key: "hard", label: "Hard floor" },
  { key: "tile", label: "Tile" },
  { key: "concrete", label: "Sealed concrete" },
] as const;

export function ChecklistField({
  item,
  value,
  onChange,
  compact,
}: {
  item: ChecklistItem;
  value: unknown;
  onChange: (v: unknown) => void;
  compact?: boolean;
}) {
  const labelCls = compact ? "text-[10px] text-slate-500" : "text-sm font-medium text-slate-700";
  const inputCls = compact ? "h-8 text-xs mt-0.5" : "h-11 text-base mt-1";
  const helpCls = compact ? "text-[11px] text-slate-500 leading-snug" : "text-sm text-slate-500 leading-relaxed";

  return (
    <div className={compact ? "space-y-1" : "space-y-1.5"}>
      <Label className={labelCls}>
        {item.label}
        {item.required ? " *" : ""}
      </Label>
      {item.help && <p className={helpCls}>{item.help}</p>}

      {item.kind === "integer" || item.kind === "number" ? (
        <Input
          type="number"
          min={0}
          value={value == null ? "" : String(value)}
          onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
          className={inputCls}
        />
      ) : item.kind === "text" ? (
        <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      ) : item.kind === "textarea" ? (
        <Textarea
          rows={compact ? 2 : 3}
          value={String(value ?? "")}
          onChange={(e) => onChange(e.target.value)}
          className={cn(compact ? "text-xs" : "text-base min-h-[5.5rem]")}
        />
      ) : item.kind === "time" ? (
        <Input type="time" value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      ) : item.kind === "yesno" ? (
        <div className="flex gap-2 pt-1">
          {(["yes", "no"] as const).map((opt) => {
            const on = value === true || value === "yes" ? opt === "yes" : value === false || value === "no" ? opt === "no" : false;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => onChange(opt === "yes")}
                className={cn(
                  "rounded-full font-semibold border",
                  compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
                  on ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-600 border-slate-200",
                )}
              >
                {opt === "yes" ? "Yes" : "No"}
              </button>
            );
          })}
        </div>
      ) : item.kind === "select" ? (
        <Select value={String(value ?? "")} onValueChange={onChange}>
          <SelectTrigger className={inputCls}><SelectValue placeholder="Select…" /></SelectTrigger>
          <SelectContent>
            {(item.options || []).map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : item.kind === "exclusion" ? (
        <Select value={String(value ?? "none")} onValueChange={onChange}>
          <SelectTrigger className={inputCls}><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(WALKTHROUGH_EXCLUSION_CODES).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : item.kind === "floor_share" ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {FLOOR_KEYS.map((k) => {
            const share = (value && typeof value === "object" ? (value as Record<string, number>)[k.key] : "") ?? "";
            return (
              <div key={k.key}>
                <Label className={compact ? "text-[10px] text-slate-500" : "text-xs text-slate-600"}>{k.label} %</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={share}
                  onChange={(e) => {
                    const cur = (value && typeof value === "object" ? { ...(value as object) } : {}) as Record<string, number>;
                    cur[k.key] = Number(e.target.value) || 0;
                    onChange(cur);
                  }}
                  className={inputCls}
                />
              </div>
            );
          })}
        </div>
      ) : item.kind === "multiselect" ? (
        <div className="flex flex-wrap gap-1.5 pt-1">
          {(item.options || ACCESS_OPTIONS).map((o) => {
            const selected = Array.isArray(value) && value.includes(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  const cur = Array.isArray(value) ? [...value] : [];
                  onChange(selected ? cur.filter((x) => x !== o.value) : [...cur, o.value]);
                }}
                className={cn(
                  "rounded-full font-medium border",
                  compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-sm",
                  selected ? "bg-violet-600 text-white border-violet-600" : "bg-white text-slate-600 border-slate-200",
                )}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      ) : (
        <Input value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className={inputCls} />
      )}
    </div>
  );
}
