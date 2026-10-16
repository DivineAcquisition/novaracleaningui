"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  acceptanceGate,
  acceptancesForSurface,
  extractLinks,
  legacyAgreementFlags,
  type AcceptanceContext,
  type AcceptanceKind,
  type RenderedAcceptance,
  type Surface,
  type WordingVersion,
} from "@/lib/compliance";

export interface AcceptanceGateState {
  ready: boolean;
  missing: AcceptanceKind[];
  checked: Partial<Record<AcceptanceKind, boolean>>;
  items: RenderedAcceptance[];
  legacy: ReturnType<typeof legacyAgreementFlags>;
}

function WordingText({ text }: { text: string }) {
  const parts: Array<{ type: "text" | "link"; value: string; href?: string }> = [];
  const re = /\[([^\]]+)\]\(([^)\s]+)\)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push({ type: "text", value: text.slice(last, match.index) });
    parts.push({ type: "link", value: match[1], href: match[2] });
    last = match.index + match[0].length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return (
    <>
      {parts.map((part, index) =>
        part.type === "link" ? (
          <a
            key={`${part.href}-${index}`}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 rounded"
          >
            {part.value}
          </a>
        ) : (
          <span key={index}>{part.value}</span>
        ),
      )}
    </>
  );
}

export function AcceptanceChecklist({
  surface,
  context,
  versions,
  showErrors = false,
  onChange,
}: {
  surface: Surface;
  context: AcceptanceContext;
  versions?: WordingVersion[];
  showErrors?: boolean;
  onChange: (state: AcceptanceGateState) => void;
}) {
  const contextKey = JSON.stringify(context);
  const items = useMemo(
    () => acceptancesForSurface(surface, context, versions),
    // context is serialized so a new object with the same booking does not rebuild the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [surface, contextKey, versions],
  );
  const [checked, setChecked] = useState<Partial<Record<AcceptanceKind, boolean>>>({});
  const [open, setOpen] = useState<Partial<Record<AcceptanceKind, boolean>>>({});
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    const gate = acceptanceGate(items, checked);
    onChangeRef.current({
      ready: gate.ready,
      missing: gate.missing,
      checked,
      items,
      legacy: legacyAgreementFlags(checked),
    });
  }, [items, checked]);

  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-semibold text-foreground">Agreements</legend>
      <p className="text-xs text-muted-foreground">
        Each box is its own agreement. None are pre-checked. Optional boxes are not required to book.
      </p>
      {items.map((item) => {
        const errorId = `acceptance-error-${item.kind}`;
        const showError = showErrors && item.required && checked[item.kind] !== true;
        const long = item.wordingShown.length > 280;
        const expanded = open[item.kind] === true || !long;
        const links = extractLinks(item.wordingShown);
        return (
          <div key={item.kind} className="rounded-lg border border-border bg-background p-3">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                name={item.kind}
                checked={checked[item.kind] === true}
                onChange={(event) => {
                  const on = event.target.checked;
                  setChecked((prev) => ({ ...prev, [item.kind]: on }));
                }}
                aria-invalid={showError || undefined}
                aria-describedby={showError ? errorId : undefined}
                className="mt-0.5 h-5 w-5 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
              <span className="text-sm leading-snug text-foreground">
                <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {item.title}
                  {item.required ? "" : " · optional"}
                </span>
                {expanded ? <WordingText text={item.wordingShown} /> : <WordingText text={`${item.wordingShown.slice(0, 220)}…`} />}
              </span>
            </label>
            {long ? (
              <button
                type="button"
                className="mt-2 ml-8 text-xs font-medium text-primary underline underline-offset-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
                onClick={() => setOpen((prev) => ({ ...prev, [item.kind]: !expanded }))}
                aria-expanded={expanded}
              >
                {expanded ? "Show less" : "Read the full text"}
              </button>
            ) : null}
            {!expanded && links.length > 0 ? (
              <p className="mt-1 ml-8 text-xs">
                {links.map((link) => (
                  <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="mr-3 text-primary underline">
                    {link.label}
                  </a>
                ))}
              </p>
            ) : null}
            {showError ? (
              <p id={errorId} role="alert" className="mt-2 ml-8 text-xs text-destructive">
                Check “{item.title}” to continue. This agreement is required.
              </p>
            ) : null}
          </div>
        );
      })}
    </fieldset>
  );
}
