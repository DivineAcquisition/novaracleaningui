"use client";

// Nova, the booking assistant. The skills are the tools the live voice agent
// actually has (quote, address, checklist, book, waitlist, hand-off). The call
// is a labelled sample that quotes real starting prices passed in as props.

import { useCallback, useEffect, useRef, useState } from "react";
import { RiPauseFill, RiPhoneLine, RiPlayFill } from "@/components/icons";
import { INBOUND_PHONE } from "@/config/brand-config";
import { NOVA } from "@/lib/landing/content";
import { cn } from "@/lib/utils";
import { useOnScreen, useReducedMotion } from "./motion";
import { Chip, Eyebrow, Frame, Index, gutter, lead, sectionTitle, shell } from "./primitives";

interface Turn {
  who: "nova" | "caller";
  text: string;
}

function spokenSize(label: string): string {
  const m = label.match(/([\d,]+)\s*[–-]\s*([\d,]+)/);
  return m ? `between ${m[1]} and ${m[2]} square feet` : label.replace("sq ft", "square feet");
}

function conversation(deep: string, bandLabel: string, oven: string | null): Turn[] {
  return [
    { who: "nova", text: "Thanks for calling Novara Cleaning. I'm Nova, an AI assistant. Would you like a price, or to book a clean?" },
    { who: "caller", text: `A price for a deep clean. My place is ${spokenSize(bandLabel)}.` },
    { who: "nova", text: `A deep clean for that size starts at ${deep}. What's your ZIP code? I'll text you what's included, then give you the exact total.` },
    { who: "caller", text: oven ? "20814. Can you do the inside of the oven too?" : "20814." },
    {
      who: "nova",
      text: oven
        ? `Yes, the oven adds ${oven}. I've texted you the checklist. Want me to look at Thursday morning?`
        : "I've texted you the checklist. Want me to look at Thursday morning?",
    },
  ];
}

const ORB = ["#6810FE", "#B49AFE", "#F2B98A"];

function Orb({ active, level }: { active: boolean; level: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  const levelRef = useRef(level);
  levelRef.current = level;
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    let t = 0;
    let cur = 0.05;
    const draw = () => {
      const w = canvas.width;
      const c = w / 2;
      cur += (levelRef.current - cur) * 0.12;
      t += reduced ? 0 : 0.012 + cur * 0.05;
      ctx.clearRect(0, 0, w, w);
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, c - 2, 0, Math.PI * 2);
      ctx.clip();
      const bg = ctx.createRadialGradient(c, c * 0.8, 10, c, c, c);
      bg.addColorStop(0, "#F7F3FF");
      bg.addColorStop(1, "#E6DCFF");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, w);
      ctx.globalCompositeOperation = "multiply";
      ORB.forEach((color, i) => {
        const r = c * (0.55 + cur * 0.35);
        const x = c + Math.cos(t + i * 2.1) * c * 0.32;
        const y = c + Math.sin(t * 1.3 + i * 2.1) * c * 0.32;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `${color}cc`);
        g.addColorStop(1, `${color}00`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, w);
      });
      ctx.globalCompositeOperation = "source-over";
      const shine = ctx.createRadialGradient(c * 0.7, c * 0.55, 0, c * 0.7, c * 0.55, c * 0.6);
      shine.addColorStop(0, "rgba(255,255,255,0.7)");
      shine.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shine;
      ctx.fillRect(0, 0, w, w);
      ctx.restore();
      if (active && !reduced) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [active, reduced]);
  return <canvas ref={canvasRef} width={256} height={256} className="h-28 w-28" aria-hidden="true" />;
}

function CallDemo({ deep, bandLabel, oven }: { deep: string; bandLabel: string; oven: string | null }) {
  const reduced = useReducedMotion();
  const { ref, visible } = useOnScreen<HTMLDivElement>(0.2);
  const turns = conversation(deep, bandLabel, oven);
  const [shown, setShown] = useState<Turn[]>(turns.slice(0, 3));
  const [playing, setPlaying] = useState(false);
  const [level, setLevel] = useState(0.05);
  const timers = useRef<number[]>([]);
  const listRef = useRef<HTMLDivElement>(null);

  const clear = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };
  const stop = useCallback(() => {
    clear();
    setPlaying(false);
    setLevel(0.05);
  }, []);
  const play = () => {
    clear();
    if (reduced) {
      setShown(turns);
      return;
    }
    setPlaying(true);
    setShown([]);
    let at = 0;
    turns.forEach((turn, i) => {
      const words = turn.text.split(" ");
      timers.current.push(
        window.setTimeout(() => {
          setLevel(turn.who === "nova" ? 0.75 : 0.3);
          setShown((cur) => [...cur, { who: turn.who, text: "" }]);
        }, at),
      );
      words.forEach((_, w) => {
        timers.current.push(
          window.setTimeout(() => {
            setShown((cur) => {
              const next = cur.slice();
              next[i] = { who: turn.who, text: words.slice(0, w + 1).join(" ") };
              return next;
            });
          }, at + 60 + w * 65),
        );
      });
      at += 60 + words.length * 65 + 650;
    });
    timers.current.push(window.setTimeout(stop, at));
  };

  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (!visible && playing) stop();
  }, [visible, playing, stop]);
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  return (
    <div ref={ref}>
      <Frame glow label={NOVA.transcriptLabel}>
        <div className="grid gap-5 sm:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3">
            <Orb active={visible} level={level} />
            <div className="flex h-6 items-center gap-[3px]" aria-hidden="true">
              {Array.from({ length: 18 }).map((_, i) => (
                <span
                  key={i}
                  className={cn("w-[3px] rounded-full bg-[#8E5BFF] transition-[height] duration-150", !playing && "opacity-40")}
                  style={{ height: playing ? `${20 + ((i * 37) % 70) * level}%` : "20%" }}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={playing ? stop : play}
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3.5 py-2 text-[13px] font-medium text-white hover:bg-ink/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#6810FE] focus-visible:ring-offset-2"
            >
              {playing ? <RiPauseFill className="h-4 w-4" aria-hidden="true" /> : <RiPlayFill className="h-4 w-4" aria-hidden="true" />}
              {playing ? NOVA.stop : NOVA.play}
            </button>
          </div>
          <div ref={listRef} className="flex h-72 flex-col gap-2 overflow-y-auto rounded-xl border border-line bg-[#FAFAFC] p-3 text-[14px]" aria-live="polite">
            {shown.map((turn, i) => (
              <div
                key={i}
                className={cn(
                  "max-w-[88%] rounded-2xl px-3 py-2 leading-snug",
                  turn.who === "nova" ? "self-start rounded-bl-md border border-[#E3D7FF] bg-white text-ink" : "self-end rounded-br-md bg-[#EFEDF4] text-ink",
                )}
              >
                <span className="mb-0.5 block font-mono text-[10.5px] text-ink-muted">{turn.who === "nova" ? "Nova" : "Caller"}</span>
                {turn.text}
              </div>
            ))}
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[13px] leading-relaxed text-ink-muted">{NOVA.disclosure}</p>
          <a
            href={INBOUND_PHONE.tel}
            className="inline-flex flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-[9px] border border-line bg-white px-4 py-2.5 text-[14px] font-medium text-ink hover:bg-[#F6F5F9]"
          >
            <RiPhoneLine className="h-4 w-4 text-[#6810FE]" aria-hidden="true" />
            {NOVA.callLabel} · {INBOUND_PHONE.display}
          </a>
        </div>
      </Frame>
    </div>
  );
}

export function NovaSection({ deep, bandLabel, oven }: { deep: string; bandLabel: string; oven: string | null }) {
  return (
    <section id={NOVA.id} aria-labelledby="nova-title" className={cn(gutter, "scroll-mt-20 border-t border-line py-20 sm:py-28")}>
      <div className={shell}>
        <Eyebrow>{NOVA.eyebrow}</Eyebrow>
        <h2 id="nova-title" className={sectionTitle}>
          {NOVA.headline}
        </h2>
        <p className={cn(lead, "mt-4")}>{NOVA.lead}</p>
        <div className="mt-10 grid items-start gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <ul className="grid gap-3 sm:grid-cols-2">
            {NOVA.skills.map((skill, i) => (
              <li
                key={skill.id}
                className={cn(
                  "rounded-2xl border bg-white p-4 shadow-[0_16px_40px_-30px_rgba(11,10,17,0.35)]",
                  i === 0 ? "border-[#E3D7FF] shadow-[0_0_60px_-30px_rgba(104,16,254,0.6)]" : "border-line",
                )}
              >
                <div className="flex items-center justify-between">
                  <Index n={i + 1} />
                  <Chip tone="good" dot>
                    {NOVA.statusLabel[skill.status]}
                  </Chip>
                </div>
                <h3 className="mt-2 text-[18px] font-medium tracking-[-0.02em] text-ink">{skill.name}</h3>
                <p className="mt-1 text-[14px] leading-relaxed text-ink-muted">{skill.body}</p>
              </li>
            ))}
          </ul>
          <CallDemo deep={deep} bandLabel={bandLabel} oven={oven} />
        </div>
      </div>
    </section>
  );
}
