"use client";

// ─── ExtrasPicker ──────────────────────────────────────────────────────────
//
// Searchable multi-select checklist for per-visit extras on the internal
// booker. Replaces the wrapping pill row. Grouped (kitchen · laundry & linens
// · detail cleaning · additional spaces), keyed by catalog ID, stays open for
// multiple choices, and shows each extra's effective price, unit and
// applicability BEFORE selection ("Included" on Move-In/Out). Selected items
// sit outside the field as removable chips.
//
// Desktop: a popover anchored to the field. Phones: a bottom sheet. Both use
// cmdk, so arrow keys move, Enter/Space toggles, and each option exposes
// aria-selected to screen readers.

import { useId, useMemo, useRef, useState } from "react";

import { RiAddLine, RiArrowDownSLine, RiCheckLine, RiCloseLine } from "@/components/icons";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import {
  EXTRAS_GROUPS,
  EXTRA_OPTIONS,
  addOnLabel,
  extraApplicability,
  type Applicability,
} from "@/lib/booker-quote";

const fmt = (cents: number) => `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;

function priceText(a: Applicability, unit?: string) {
  if (a.kind === "included") return "Included";
  if (a.kind === "not_applied") return "Not applied";
  return `+${fmt(a.cents)}${unit ? ` ${unit}` : ""}`;
}

export interface ExtrasPickerProps {
  /** Selected catalog IDs (the persisted shape — va_quotes/bookings add_ons). */
  value: string[];
  onChange: (next: string[]) => void;
  serviceType: string;
  /** id for the trigger, so "Still needed" links and jump links can focus it. */
  id?: string;
  disabled?: boolean;
}

export function ExtrasPicker({ value, onChange, serviceType, id, disabled }: ExtrasPickerProps) {
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const autoId = useId();
  const triggerId = id || `extras-${autoId}`;
  const selected = useMemo(() => new Set(value), [value]);
  const pickable = useMemo(() => new Set(EXTRA_OPTIONS.map((o) => o.id as string)), []);
  // IDs on the record that the picker no longer offers (legacy quotes, the
  // Glow first-visit deep add-on, ops-only findings). Kept, shown, removable.
  const legacy = value.filter((v) => !pickable.has(v));

  const toggle = (optionId: string) => {
    onChange(selected.has(optionId) ? value.filter((v) => v !== optionId) : [...value, optionId]);
  };
  const remove = (optionId: string) => {
    onChange(value.filter((v) => v !== optionId));
    // Keep focus in the field after removing the last chip.
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const list = (
    <Command
      // Search on label, group and unit; cmdk handles arrow keys + Enter.
      filter={(itemValue, query) => (itemValue.toLowerCase().includes(query.toLowerCase().trim()) ? 1 : 0)}
      className="rounded-lg"
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search extras — fridge, laundry, baseboards…"
        aria-label="Search extras"
      />
      <CommandList className="max-h-[min(60vh,380px)]" aria-multiselectable="true">
        <CommandEmpty>No extras match “{search}”.</CommandEmpty>
        {EXTRAS_GROUPS.map((group) => {
          const options = EXTRA_OPTIONS.filter((o) => o.group === group.id);
          if (!options.length) return null;
          return (
            <CommandGroup key={group.id} heading={group.label}>
              {options.map((o) => {
                const isOn = selected.has(o.id);
                const a = extraApplicability(o.id, serviceType);
                return (
                  <CommandItem
                    key={o.id}
                    value={`${o.label} ${group.label} ${o.unit || ""} ${o.id}`}
                    onSelect={() => toggle(o.id)}
                    aria-selected={isOn}
                    data-checked={isOn ? "true" : undefined}
                    className="gap-2.5"
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "grid h-4 w-4 shrink-0 place-items-center rounded border",
                        isOn ? "border-violet-600 bg-violet-600 text-white" : "border-slate-300 bg-white",
                      )}
                    >
                      {isOn ? <RiCheckLine className="!h-3 !w-3" /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-slate-800">{o.label}</span>
                      {a.kind === "included" ? (
                        <span className="block text-[11px] text-emerald-700">{a.reason}</span>
                      ) : o.note && o.note !== o.unit ? (
                        <span className="block truncate text-[11px] text-slate-500">{o.note}</span>
                      ) : null}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 text-[12px] tabular-nums",
                        a.kind === "included" ? "font-medium text-emerald-700" : "text-slate-600",
                      )}
                    >
                      {priceText(a, o.unit)}
                    </span>
                    <span className="sr-only">{isOn ? ", selected" : ", not selected"}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
      </CommandList>
      <div className="flex items-center justify-between border-t border-slate-100 px-3 py-2 text-[11px] text-slate-500">
        <span aria-live="polite">{value.length} selected</span>
        <Button type="button" size="sm" variant="secondary" className="h-7 px-2.5 text-xs" onClick={() => setOpen(false)}>
          Done
        </Button>
      </div>
    </Command>
  );

  const trigger = (
    <button
      ref={triggerRef}
      id={triggerId}
      type="button"
      disabled={disabled}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={() => setOpen(true)}
      className="flex h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-left text-sm text-slate-600 hover:border-violet-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40 disabled:opacity-50"
    >
      <span className="flex items-center gap-2">
        <RiAddLine className="h-4 w-4 text-slate-400" aria-hidden />
        {value.length ? `Add or change extras (${value.length} selected)` : "Add extras"}
      </span>
      <RiArrowDownSLine className="h-4 w-4 text-slate-400" aria-hidden />
    </button>
  );

  return (
    <div className="space-y-2">
      {isMobile ? (
        <>
          {trigger}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="bottom" className="max-h-[85vh] rounded-t-2xl p-0">
              <SheetHeader className="px-4 pb-1 pt-4 text-left">
                <SheetTitle className="text-base">Extras</SheetTitle>
                <SheetDescription className="text-xs">Tap to add or remove. Prices are per visit.</SheetDescription>
              </SheetHeader>
              {list}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent align="start" className="w-[min(92vw,440px)] p-0">
            {list}
          </PopoverContent>
        </Popover>
      )}

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Selected extras">
          {value.map((v) => {
            const option = EXTRA_OPTIONS.find((o) => o.id === v);
            const a = extraApplicability(v, serviceType);
            const isLegacy = legacy.includes(v);
            return (
              <li key={v}>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1 text-[12px]",
                    isLegacy
                      ? "border-amber-300 bg-amber-50 text-amber-900"
                      : a.kind === "included"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                        : "border-violet-200 bg-violet-50 text-violet-900",
                  )}
                >
                  <span className="font-medium">{option?.label || addOnLabel(v)}</span>
                  <span className="tabular-nums opacity-80">
                    {isLegacy ? "on record — not offered here" : priceText(a, option?.unit)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(v)}
                    aria-label={`Remove ${option?.label || addOnLabel(v)}`}
                    className="grid h-5 w-5 place-items-center rounded-full hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                  >
                    <RiCloseLine className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
