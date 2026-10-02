"use client";

import { RiMapPinLine } from "@remixicon/react";
import type { AddressSuggestion } from "@/lib/google-places-loader";

/** Suggestion list shared by every address field. Novara purple, not the browser default. */
export function AddressSuggestionMenu({
  suggestions,
  onPick,
}: {
  suggestions: AddressSuggestion[];
  onPick: (suggestion: AddressSuggestion) => void;
}) {
  if (suggestions.length === 0) return null;
  return (
    <ul
      role="listbox"
      className="absolute z-[10000] left-0 right-0 mt-1 max-h-64 overflow-auto rounded-xl border bg-white shadow-[0_8px_24px_rgba(92,15,254,0.14)]"
      style={{ borderColor: "rgba(var(--brand-rgb), 0.22)" }}
    >
      {suggestions.map((s) => (
        <li key={s.id} role="option">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(s);
            }}
            className="w-full text-left px-3 py-2.5 text-sm transition-colors flex items-start gap-2 hover:bg-[rgba(var(--brand-rgb),0.08)]"
          >
            <RiMapPinLine className="w-4 h-4 shrink-0 mt-0.5" style={{ color: "var(--brand)" }} />
            <span className="min-w-0">
              <span className="block font-medium truncate text-slate-900">{s.primary}</span>
              {s.secondary && (
                <span className="block text-xs truncate" style={{ color: "var(--brand-mid)" }}>
                  {s.secondary}
                </span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
