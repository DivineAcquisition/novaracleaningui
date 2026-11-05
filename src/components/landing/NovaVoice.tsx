"use client";

// "Meet Nova" — the AI receptionist that answers the inbound line. The orb is
// a small 2D canvas (no WebGL) that only animates while on screen and stays
// still under reduced motion. The conversation is labelled as a sample and
// quotes real starting prices passed in from the pricing config.

import { useCallback, useEffect, useRef, useState } from "react";
import { RiPauseLine, RiPhoneLine, RiPlayLine } from "@remixicon/react";
import { INBOUND_PHONE } from "@/config/brand-config";
import { cn } from "@/lib/utils";
import { useOnScreen, useReducedMotion } from "./shared";

interface Turn {
  who: "nova" | "caller";
  text: string;
}

/** "1,000 – 1,500 sq ft" → "between 1,000 and 1,500 square feet". */
function spokenSize(label: string): string {
  const m = label.match(/([\d,]+)\s*[–-]\s*([\d,]+)/);
  return m ? `between ${m[1]} and ${m[2]} square feet` : label.replace("sq ft", "square feet");
}

function buildConversation(deep: string, bandLabel: string, oven: string | null): Turn[] {
  return [
    { who: "nova", text: "Thanks for calling Novara Cleaning, this is Nova, an AI assistant. Would you like a price, or to book a clean?" },
    { who: "caller", text: `Hi, I need a deep clean. My place is ${spokenSize(bandLabel)}.` },
    { who: "nova", text: `A deep clean for that size starts at ${deep}. What's your ZIP code? I'll give you the exact price and the next open times.` },
    { who: "caller", text: oven ? "20814. Can you do the inside of the oven too?" : "20814." },
    {
      who: "nova",
      text: oven
        ? `Yes, the oven is ${oven} extra. Let me check 20814, then I'll give you your exact total and we can pick a time.`
        : "Thanks. Let me check 20814, then I'll give you your exact total and we can pick a time.",
    },
  ];
}

const ORB_COLORS = ["#6810FE", "#B49AFE", "#F2B98A"];

function useOrb(canvasRef: React.RefObject<HTMLCanvasElement>, active: boolean, level: number, reduced: boolean) {
  const levelRef = useRef(level);
  levelRef.current = level;
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    let raf = 0;
    let t = 0;
    let current = 0.05;
    const draw = () => {
      const w = canvas.width;
      const c = w / 2;
      current += (levelRef.current - current) * 0.12;
      t += reduced ? 0 : 0.012 + current * 0.05;
      ctx.clearRect(0, 0, w, w);
      ctx.save();
      ctx.beginPath();
      ctx.arc(c, c, c - 2, 0, Math.PI * 2);
      ctx.clip();
      const bg = ctx.createRadialGradient(c, c * 0.8, 10, c, c, c);
      bg.addColorStop(0, "#F6F2FF");
      bg.addColorStop(1, "#E4D9FF");
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, w);
      ctx.globalCompositeOperation = "multiply";
      ORB_COLORS.forEach((color, i) => {
        const phase = i * 2.1;
        const r = c * (0.55 + current * 0.35);
        const x = c + Math.cos(t + phase) * c * 0.32;
        const y = c + Math.sin(t * 1.3 + phase) * c * 0.32;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `${color}cc`);
        g.addColorStop(1, `${color}00`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, w);
      });
      ctx.globalCompositeOperation = "source-over";
      const shine = ctx.createRadialGradient(c * 0.7, c * 0.55, 0, c * 0.7, c * 0.55, c * 0.6);
      shine.addColorStop(0, "rgba(255,255,255,0.65)");
      shine.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = shine;
      ctx.fillRect(0, 0, w, w);
      ctx.restore();
      if (active && !reduced) raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [canvasRef, active, reduced]);
}

export function NovaVoice({
  deepStartingPrice,
  bandLabel,
  ovenPrice,
}: {
  deepStartingPrice: string;
  bandLabel: string;
  ovenPrice: string | null;
}) {
  const reduced = useReducedMotion();
  const { ref: sectionRef, visible } = useOnScreen<HTMLDivElement>(0.2);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const conversation = buildConversation(deepStartingPrice, bandLabel, ovenPrice);

  const [shown, setShown] = useState<Array<{ who: Turn["who"]; text: string }>>(
    conversation.slice(0, 3),
  );
  const [playing, setPlaying] = useState(false);
  const [level, setLevel] = useState(0.05);
  const timers = useRef<number[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const clearTimers = () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current = [];
  };

  const stop = useCallback(() => {
    clearTimers();
    setPlaying(false);
    setLevel(0.05);
  }, []);

  const play = () => {
    clearTimers();
    setPlaying(true);
    if (reduced) {
      setShown(conversation);
      setPlaying(false);
      return;
    }
    setShown([]);
    let at = 0;
    conversation.forEach((turn, i) => {
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

  useEffect(() => () => clearTimers(), []);
  useEffect(() => {
    if (!visible && playing) stop();
  }, [visible, playing, stop]);
  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [shown]);

  useOrb(canvasRef, visible, level, reduced);

  return (
    <div ref={sectionRef} className="grid items-center gap-6 rounded-2xl border border-border bg-card p-5 md:grid-cols-[auto_1fr] md:gap-8 md:p-8">
      <div className="flex flex-col items-center gap-4">
        <canvas ref={canvasRef} width={280} height={280} className="h-36 w-36 md:h-40 md:w-40" aria-hidden="true" />
        <div className="flex h-7 items-center gap-[3px]" aria-hidden="true">
          {Array.from({ length: 22 }).map((_, i) => (
            <span
              key={i}
              className={cn("w-[3px] rounded-full bg-primary transition-[height] duration-150", playing ? "" : "opacity-40")}
              style={{
                height: playing ? `${20 + ((i * 37) % 70) * level}%` : "18%",
              }}
            />
          ))}
        </div>
        <button
          type="button"
          onClick={playing ? stop : play}
          className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-semibold text-background hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {playing ? <RiPauseLine className="h-4 w-4" aria-hidden="true" /> : <RiPlayLine className="h-4 w-4" aria-hidden="true" />}
          {playing ? "Stop" : "Play a sample call"}
        </button>
      </div>

      <div className="min-w-0">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sample conversation
        </p>
        <div
          ref={transcriptRef}
          className="flex h-64 flex-col gap-2 overflow-y-auto rounded-xl border border-border bg-background p-3 text-sm"
          aria-live="polite"
        >
          {shown.map((turn, i) => (
            <div
              key={i}
              className={cn(
                "max-w-[88%] rounded-2xl px-3 py-2 leading-snug",
                turn.who === "nova"
                  ? "self-start rounded-bl-md bg-primary/[0.08] text-foreground"
                  : "self-end rounded-br-md bg-muted text-foreground",
              )}
            >
              <span className="mb-0.5 block font-mono text-[10.5px] text-muted-foreground">
                {turn.who === "nova" ? "Nova" : "Caller"}
              </span>
              {turn.text}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <a
            href={INBOUND_PHONE.tel}
            className="inline-flex flex-shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RiPhoneLine className="h-4 w-4 text-primary" aria-hidden="true" />
            Call Nova: {INBOUND_PHONE.display}
          </a>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Nova is an AI assistant. It answers day and night, quotes and books. Ask for a person and our team follows up with you.
          </p>
        </div>
      </div>
    </div>
  );
}
