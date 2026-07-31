"use client";

import { RiCheckLine, RiSubtractLine, RiAddLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  FOCUSED_SAME_DAY_DEFAULTS,
  calculateFocusedPrice,
  type FocusedAreaId,
  type FocusedAreaSelection,
  type FocusedCondition,
  type FocusedSameDaySettings,
} from "@/lib/focused-same-day";

const CONDITIONS: { id: FocusedCondition; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "normal", label: "Standard" },
  { id: "heavy", label: "Heavy" },
  { id: "severe", label: "Severe" },
];

interface Props {
  selections: FocusedAreaSelection[];
  condition: FocusedCondition;
  onChange: (next: { selections: FocusedAreaSelection[]; condition: FocusedCondition }) => void;
  settings?: FocusedSameDaySettings;
  className?: string;
}

export function FocusedCleanPicker({
  selections,
  condition,
  onChange,
  settings = FOCUSED_SAME_DAY_DEFAULTS,
  className,
}: Props) {
  const qtyFor = (areaId: string) =>
    selections.find((s) => s.areaId === areaId)?.quantity || 0;

  const toggleArea = (areaId: string, isQty: boolean) => {
    const existing = selections.find((s) => s.areaId === areaId);
    let next: FocusedAreaSelection[];
    if (existing) {
      next = selections.filter((s) => s.areaId !== areaId);
    } else {
      next = [...selections, { areaId: areaId as FocusedAreaId, quantity: 1 }];
    }
    onChange({ selections: next, condition });
  };

  const setBedroomQty = (delta: number) => {
    const current = qtyFor("bedroom");
    const nextQty = Math.max(0, current + delta);
    let next = selections.filter((s) => s.areaId !== "bedroom");
    if (nextQty > 0) next = [...next, { areaId: "bedroom", quantity: nextQty }];
    onChange({ selections: next, condition });
  };

  const price = calculateFocusedPrice(selections, condition, false, settings);

  return (
    <div className={cn("space-y-4", className)}>
      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Select areas
        </Label>
        <div className="mt-2 grid gap-2">
          {settings.areas.map((area) => {
            const selected = qtyFor(area.id) > 0;
            return (
              <div
                key={area.id}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors",
                  selected ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <button
                  type="button"
                  className="flex items-center gap-2 text-left flex-1 min-w-0"
                  onClick={() => toggleArea(area.id, area.quantity)}
                >
                  <span
                    className={cn(
                      "h-5 w-5 rounded border flex items-center justify-center shrink-0",
                      selected ? "bg-primary border-primary text-white" : "border-muted-foreground/40",
                    )}
                  >
                    {selected ? <RiCheckLine className="h-3.5 w-3.5" /> : null}
                  </span>
                  <span className="text-sm font-medium truncate">{area.label}</span>
                  <Badge variant="outline" className="text-[10px] ml-1 shrink-0">
                    ${area.price}{area.quantity ? " ea" : ""}
                  </Badge>
                </button>
                {area.quantity && selected ? (
                  <div className="flex items-center gap-1.5 ml-2">
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => setBedroomQty(-1)}
                    >
                      <RiSubtractLine className="h-3.5 w-3.5" />
                    </Button>
                    <span className="w-5 text-center text-sm font-semibold tabular-nums">
                      {qtyFor("bedroom")}
                    </span>
                    <Button
                      type="button"
                      size="icon"
                      variant="outline"
                      className="h-7 w-7"
                      onClick={() => setBedroomQty(1)}
                    >
                      <RiAddLine className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <Label className="text-xs uppercase tracking-wider text-muted-foreground">
          Condition
        </Label>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-4 gap-2">
          {CONDITIONS.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange({ selections, condition: c.id })}
              className={cn(
                "rounded-lg border px-2 py-2 text-xs font-medium transition-colors",
                condition === c.id
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/40",
              )}
            >
              {c.label}
              <span className="block text-[10px] opacity-70 mt-0.5">
                ×{settings.condition_multipliers[c.id]}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-primary/5 border border-primary/15 px-3 py-3 space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">Areas</span>
          <span className="font-medium">${price.areasSubtotal.toFixed(2)}</span>
        </div>
        {price.conditionMultiplier !== 1 ? (
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Condition (×{price.conditionMultiplier})
            </span>
            <span className="font-medium">${price.afterCondition.toFixed(2)}</span>
          </div>
        ) : null}
        {price.minimumApplied ? (
          <div className="flex items-center justify-between text-xs text-amber-700">
            <span>${settings.minimum_dollars} minimum applied</span>
          </div>
        ) : null}
        <div className="flex items-center justify-between text-base pt-1 border-t border-primary/10">
          <span className="font-semibold">Total (paid in full)</span>
          <span className="font-extrabold text-primary tabular-nums">
            ${price.total.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}
