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
  RiThumbUpLine,
  RiThumbDownLine,
} from "@/components/icons";

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
      aria-label={open ? "Close Ask Novara" : "Open Ask Novara"}
    >
      <RiSparklingLine className="h-4 w-4 text-primary" />
      <span className="hidden sm:inline">Ask Novara</span>
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
  const { open, setOpen, messages, sending, error, ask, page, surface, rate } = useOpsAssistant();
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, sending, open]);

  const suggestions = [
    "How does dispatch work?",
    "What should I do with a late job?",
    "Where do I refund a booking?",
  ];

  const sendDraft = () => {
    const q = draft.trim();
    if (!q || sending) return;
    void ask(q, "chat");
    setDraft("");
  };

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
      // Selestial's raised surface: white, hairline edge, soft shadow.
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-[420px] lg:max-w-[360px] 2xl:max-w-[420px] flex-col border-l border-slate-200 bg-white shadow-[-16px_0_40px_-24px_rgba(33,26,53,0.28)]"
      role="complementary"
      aria-label="Ask Novara"
    >
      <header className="flex min-h-14 items-center gap-2.5 border-b border-slate-200 px-4 py-2.5">
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg border border-violet-800/40 bg-gradient-to-b from-violet-400 via-violet-600 to-violet-700 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.35),0_8px_20px_-12px_rgba(104,56,239,0.9)]">
          <RiSparklingLine className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold tracking-tight text-slate-900">Ask Novara</p>
          <p className="truncate text-[11px] text-slate-500">{contextLine}</p>
        </div>
        <span className="hidden shrink-0 rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[10px] font-semibold text-violet-700 sm:inline">Assist &amp; draft</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-2 focus-visible:outline-violet-600"
          aria-label="Close Ask Novara"
        >
          <RiCloseLine className="h-5 w-5" />
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-slate-500">
              Ask how a screen works, or about the record in front of you. The same conversation stays open on the docs site and in the workspace.
            </p>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  disabled={sending}
                  onClick={() => void ask(prompt, "chat")}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-left text-xs font-medium text-slate-700 transition-colors hover:border-violet-300 hover:bg-violet-50 hover:text-violet-800 disabled:opacity-50"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <article
            key={m.id}
            className={cn(
              "px-3.5 py-2.5 text-sm leading-relaxed",
              m.role === "user"
                ? "ml-8 rounded-2xl rounded-tr-md border border-violet-200 bg-violet-50 text-slate-900"
                : "mr-4 rounded-2xl rounded-tl-md border border-slate-200 bg-white text-slate-800 shadow-[0_1px_2px_rgba(33,26,53,0.04)]",
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
                {m.actions.map((a) =>
                  a.kind === "drive" || /^https?:\/\//i.test(a.href) ? (
                    <a
                      key={a.href}
                      href={a.href}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-primary/20 bg-brand-50 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-brand-100"
                    >
                      {a.label}
                      <RiExternalLinkLine className="h-3 w-3" />
                    </a>
                  ) : (
                    <Link
                      key={a.href}
                      href={a.href}
                      className="inline-flex items-center rounded-lg border border-primary/20 bg-brand-50 px-2 py-1 text-[11px] font-semibold text-primary hover:bg-brand-100"
                    >
                      {a.label}
                    </Link>
                  ),
                )}
              </div>
            )}
            {m.role === "assistant" && !m.id.startsWith("local-") && (
              <div className="mt-2 flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void rate(m.id, "helpful")}
                  className={cn(
                    "rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground",
                    m.rating === "helpful" && "bg-emerald-50 text-emerald-700",
                  )}
                  aria-label="Helpful"
                  aria-pressed={m.rating === "helpful"}
                >
                  <RiThumbUpLine className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const note =
                      typeof window !== "undefined"
                        ? window.prompt("What was unhelpful? Optional — leave blank if nothing to add.")
                        : "";
                    if (note === null) return;
                    void rate(m.id, "not_helpful", note);
                  }}
                  className={cn(
                    "rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground",
                    m.rating === "not_helpful" && "bg-rose-50 text-rose-700",
                  )}
                  aria-label="Not helpful"
                  aria-pressed={m.rating === "not_helpful"}
                >
                  <RiThumbDownLine className="h-3.5 w-3.5" />
                </button>
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
        className="border-t border-slate-200 bg-white p-3"
        onSubmit={(e) => {
          e.preventDefault();
          sendDraft();
        }}
      >
        <div className="rounded-xl border border-slate-300 bg-white p-2 transition-shadow focus-within:border-violet-400 focus-within:shadow-[0_0_0_3px_rgba(104,56,239,0.14)]">
          <textarea
            data-bare
            aria-label="Message Ask Novara"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendDraft();
              }
            }}
            rows={2}
            placeholder={surface === "docs" ? "Ask about this guide…" : "Ask about this screen…"}
            className="min-h-[44px] w-full resize-none border-0 bg-transparent px-2 py-1.5 text-sm text-slate-900 outline-none placeholder:text-slate-400"
          />
          <div className="flex justify-end">
            <Button type="submit" size="icon" className="h-8 w-8 rounded-lg" disabled={sending || !draft.trim()} aria-label="Send">
              <RiSendPlane2Line className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <p className="mt-1.5 text-[10px] text-slate-500">
          Assist and draft only. Same history on both the workspace and the docs site.
        </p>
      </form>
    </aside>
  );
}
