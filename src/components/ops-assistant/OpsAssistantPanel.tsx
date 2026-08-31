"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  RiSparklingLine,
  RiCloseLine,
  RiSendPlane2Line,
  RiLoader4Line,
  RiExternalLinkLine,
  RiAlertLine,
} from "@remixicon/react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useOpsAssistant } from "./OpsAssistantProvider";

export function OpsAssistantToggle({ className }: { className?: string }) {
  const { open, setOpen } = useOpsAssistant();
  return (
    <Button
      type="button"
      variant={open ? "secondary" : "outline"}
      size="sm"
      className={cn("gap-1.5", className)}
      onClick={() => setOpen(!open)}
      aria-pressed={open}
      aria-label={open ? "Close the assistant" : "Open the assistant"}
    >
      <RiSparklingLine className="h-4 w-4 text-primary" />
      <span className="hidden sm:inline">Assistant</span>
    </Button>
  );
}

export function OpsAssistantSearch({
  placeholder = "Ask the guides…",
}: {
  placeholder?: string;
}) {
  const { askFromSearch, sending } = useOpsAssistant();
  const [value, setValue] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const q = value.trim();
        if (!q) return;
        void askFromSearch(q);
        setValue("");
      }}
    >
      <label className="relative block">
        <span className="sr-only">Search the guides — this is the assistant</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          disabled={sending}
          className="w-full rounded-lg border border-[color:var(--hairline)] bg-background py-2 pl-3 pr-10 text-sm outline-none focus:border-primary/40"
        />
        <button
          type="submit"
          disabled={sending || !value.trim()}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground disabled:opacity-40"
          aria-label="Ask"
        >
          {sending ? <RiLoader4Line className="h-4 w-4 animate-spin" /> : <RiSendPlane2Line className="h-4 w-4" />}
        </button>
      </label>
    </form>
  );
}

export function OpsAssistantPanel() {
  const { open, setOpen, messages, sending, error, ask, page, surface } = useOpsAssistant();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sending, open]);

  if (!open) return null;

  const contextLine =
    surface === "docs"
      ? page.docSlug
        ? `Reading the ${page.docSlug} guide`
        : "On the guides"
      : page.record
        ? `Looking at ${page.record.kind} ${page.record.label || page.record.id.slice(0, 8)}`
        : page.docSlug
          ? `On ${page.docSlug}`
          : "In the workspace";

  return (
    <aside
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] flex-col border-l border-[color:var(--hairline)] bg-card shadow-[-12px_0_32px_-18px_rgba(0,0,0,0.25)]"
      role="complementary"
      aria-label="Ops Assistant"
    >
      <header className="flex items-center gap-2 border-b border-[color:var(--hairline)] px-4 py-3">
        <RiSparklingLine className="h-4 w-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight">Ops Assistant</p>
          <p className="truncate text-[11px] text-muted-foreground">{contextLine}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Close the assistant"
        >
          <RiCloseLine className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Ask how a screen works, or — in the workspace — about the record in front of you.
            Same conversation on the docs site and in the admin workspace.
          </p>
        )}
        {messages.map((m) => (
          <article
            key={m.id}
            className={cn(
              "rounded-xl px-3 py-2 text-sm leading-relaxed",
              m.role === "user"
                ? "ml-6 bg-brand-50 text-foreground"
                : "mr-2 border border-[color:var(--hairline)] bg-background",
            )}
          >
            <div className="whitespace-pre-wrap">{m.content}</div>
            {m.role === "assistant" && (m.escalation || m.writeRefused) && (
              <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
                <RiAlertLine className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                {m.escalation
                  ? "Confirm with management before acting."
                  : "Assist and draft only — nothing was created, sent, or changed."}
              </p>
            )}
            {m.citations.length > 0 && (
              <ul className="mt-2 space-y-1">
                {m.citations.map((c) => (
                  <li key={c.id}>
                    {c.docsPath ? (
                      <Link
                        href={c.docsPath}
                        className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                      >
                        {c.title}
                        {c.section ? ` — ${c.section}` : ""}
                        {c.hasScreenshot ? " (has screenshots)" : ""}
                        <RiExternalLinkLine className="h-3 w-3" />
                      </Link>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">
                        {c.title}
                        {c.section ? ` — ${c.section}` : ""}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {m.actions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {m.actions.map((a) => (
                  <Link
                    key={a.href}
                    href={a.href}
                    className="inline-flex items-center rounded-lg border border-primary/20 bg-brand-50 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-brand-100"
                  >
                    {a.label}
                  </Link>
                ))}
              </div>
            )}
          </article>
        ))}
        {sending && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <RiLoader4Line className="h-3.5 w-3.5 animate-spin" />
            Looking it up…
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div ref={endRef} />
      </div>

      <form
        className="border-t border-[color:var(--hairline)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const q = draft.trim();
          if (!q) return;
          void ask(q, "chat");
          setDraft("");
        }}
      >
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const q = draft.trim();
                if (!q) return;
                void ask(q, "chat");
                setDraft("");
              }
            }}
            rows={2}
            placeholder={surface === "docs" ? "Ask about this guide…" : "Ask about this screen…"}
            className="min-h-[44px] flex-1 resize-none rounded-lg border border-[color:var(--hairline)] bg-background px-3 py-2 text-sm outline-none focus:border-primary/40"
          />
          <Button type="submit" size="icon" disabled={sending || !draft.trim()} aria-label="Send">
            <RiSendPlane2Line className="h-4 w-4" />
          </Button>
        </div>
        <p className="mt-1.5 text-[10px] text-muted-foreground">
          Assist and draft only. Same history on both the workspace and the docs site.
        </p>
      </form>
    </aside>
  );
}
