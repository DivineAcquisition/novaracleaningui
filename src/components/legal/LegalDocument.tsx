// Renders a policy written in plain text with a few markers:
//   "## 1. TITLE"   section heading (listed in the table of contents)
//   "### 1.1 Title" subsection heading
//   blank line      new block
// Lines that follow a block ending in ":" render as a bulleted list.
// Emails, web addresses and bare novaracleaning.com links become links.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type LegalBlock =
  | { type: "h2"; id: string; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] };

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function parseLegal(text: string): LegalBlock[] {
  const raw = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter(Boolean);
  const blocks: LegalBlock[] = [];
  let listOpen = false;
  for (const line of raw) {
    if (line.startsWith("## ")) {
      const t = line.slice(3).trim();
      blocks.push({ type: "h2", id: slugify(t), text: t });
      listOpen = false;
      continue;
    }
    if (line.startsWith("### ")) {
      blocks.push({ type: "h3", text: line.slice(4).trim() });
      listOpen = false;
      continue;
    }
    const numbered = /^\d+\.\d+(\.\d+)?\s/.test(line);
    const prev = blocks[blocks.length - 1];
    // A full sentence after short items without periods closes the list
    // ("Email: …" items, then "Cancellation requests are only valid…").
    const closesList =
      listOpen && prev?.type === "ul" && /[.!]$/.test(line) && prev.items.every((item) => !/[.!]$/.test(item));
    if (!numbered && !closesList && (listOpen || (prev?.type === "p" && prev.text.endsWith(":"))) && line.length < 400 && !line.endsWith(":")) {
      if (prev?.type === "ul") prev.items.push(line);
      else blocks.push({ type: "ul", items: [line] });
      listOpen = true;
      continue;
    }
    listOpen = false;
    blocks.push({ type: "p", text: line });
  }
  return blocks;
}

const LINK_RE =
  /([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,})|(https?:\/\/[^\s)]+[^\s).,;])|((?:www\.|try\.|app\.|hiring\.)?novaracleaning\.com(?:\/[A-Za-z0-9\-/]*[A-Za-z0-9])?)/g;

function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK_RE)) {
    const start = m.index ?? 0;
    if (start > last) out.push(text.slice(last, start));
    const value = m[0];
    const href = m[1] ? `mailto:${value}` : m[2] ? value : `https://${value.replace(/^www\./, "")}`;
    out.push(
      <a key={`${start}-${value}`} href={href} className="font-medium text-[#5A1FD6] underline decoration-[#C9B6FF] underline-offset-2 hover:decoration-[#5A1FD6]">
        {value}
      </a>,
    );
    last = start + value.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** "1.4 BINDING EFFECT. Acceptance…" → number, bold lead-in, rest. */
function Paragraph({ text }: { text: string }) {
  const num = text.match(/^(\d+\.\d+(?:\.\d+)?)\s+(.*)$/s);
  const body = num ? num[2] : text;
  const lead = body.match(/^([A-Z0-9][A-Z0-9 ,'’&/\-—()]{3,80}[.:])\s+(.*)$/s);
  return (
    <p className="text-[15px] leading-[1.75] text-ink/85">
      {num ? <span className="mr-1.5 font-mono text-[13px] font-medium text-[#8E5BFF]">{num[1]}</span> : null}
      {lead ? (
        <>
          <strong className="font-semibold text-ink">{lead[1]}</strong> {linkify(lead[2])}
        </>
      ) : (
        linkify(body)
      )}
    </p>
  );
}

export function LegalDocument({ blocks, className }: { blocks: LegalBlock[]; className?: string }) {
  return (
    <div className={cn("space-y-4", className)}>
      {blocks.map((b, i) => {
        if (b.type === "h2") {
          return (
            <h2 key={i} id={b.id} className="scroll-mt-28 pt-8 text-[1.3rem] font-semibold tracking-[-0.02em] text-ink first:pt-0">
              {b.text}
            </h2>
          );
        }
        if (b.type === "h3") {
          return (
            <h3 key={i} className="pt-2 text-[16px] font-semibold tracking-[-0.01em] text-ink">
              {b.text}
            </h3>
          );
        }
        if (b.type === "ul") {
          return (
            <ul key={i} className="space-y-2 rounded-xl border border-line bg-[#FAFAFC] px-5 py-4">
              {b.items.map((item, j) => (
                <li key={j} className="flex gap-2.5 text-[14.5px] leading-relaxed text-ink/85">
                  <span aria-hidden="true" className="mt-[9px] h-1.5 w-1.5 flex-shrink-0 rounded-full bg-[#8E5BFF]" />
                  <span>{linkify(item)}</span>
                </li>
              ))}
            </ul>
          );
        }
        return <Paragraph key={i} text={b.text} />;
      })}
    </div>
  );
}

export function legalToc(blocks: LegalBlock[]) {
  return blocks.filter((b): b is Extract<LegalBlock, { type: "h2" }> => b.type === "h2");
}
