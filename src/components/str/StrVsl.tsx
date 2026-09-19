"use client";

// Autoplaying VSL for the STR landing page. Plays immediately — no email
// gate. A recorded Wistia id, when configured, wins; otherwise the branded
// animation is the ~2-minute landing-page cut.

import { useEffect, useMemo, useState } from "react";
import { RiPauseFill, RiPlayFill, RiVolumeMuteLine, RiVolumeUpLine } from "@remixicon/react";
import { WistiaPlayer } from "@/components/cleaner/WistiaPlayer";
import { Particles } from "@/components/magicui/particles";
import { BRAND } from "@/lib/brand";
import { cn } from "@/lib/utils";

const SCENES = [
  {
    kicker: "The problem",
    title: "A no-show on turnover day is a 1-star review.",
    body: "The guest is already on the way. The listing is still a mess. Hoping a group-chat cleaner shows is not a system.",
  },
  {
    kicker: "The problem",
    title: "Reliability you can't see until it fails.",
    body: "One turnover looks guest-ready. The next one doesn't. You find out from the review, not from the cleaner.",
  },
  {
    kicker: "The difference",
    title: "Backup coverage if the assigned cleaner can't make it.",
    body: "The turnover still happens on time. That's the point — not just that we clean Airbnbs.",
  },
  {
    kicker: "The difference",
    title: "Timed to checkout and check-in. Not a Tuesday route.",
    body: "Same-day turnovers are the job. Before-and-after photos go out after every visit.",
  },
  {
    kicker: "The close",
    title: "Typical listing: claim the rate. Anything larger: book a call.",
    body: "A standard home with a small number of listings starts onboarding now. Unusual properties get a person.",
  },
];

const SCENE_MS = 5200;
const WISTIA_ID = (process.env.NEXT_PUBLIC_STR_VSL_WISTIA_ID || "").trim();

export function StrVsl({ className }: { className?: string }) {
  if (WISTIA_ID) {
    return (
      <div className={cn("overflow-hidden rounded-2xl border border-white/10 shadow-[0_20px_60px_-24px_rgba(92,15,254,0.55)]", className)}>
        <WistiaPlayer mediaId={WISTIA_ID} aspect={16 / 9} placeholderPaddingTop="56.25%" autoPlay muted />
      </div>
    );
  }

  return <AnimatedVsl className={className} />;
}

function AnimatedVsl({ className }: { className?: string }) {
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [muted, setMuted] = useState(true);
  const scene = SCENES[index];
  const progress = useMemo(() => ((index + 1) / SCENES.length) * 100, [index]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => {
      setIndex((i) => (i + 1) % SCENES.length);
    }, SCENE_MS);
    return () => window.clearTimeout(id);
  }, [index, playing]);

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border border-white/10 bg-[#12062b] text-white shadow-[0_20px_60px_-24px_rgba(92,15,254,0.55)]",
        className,
      )}
      style={{ aspectRatio: "16 / 9" }}
      role="region"
      aria-label="Short-term rental video sales letter"
    >
      <Particles className="absolute inset-0 z-0" quantity={36} color={BRAND.primaryLight} ease={80} size={0.45} />
      <div
        className="absolute inset-0 opacity-80"
        style={{ background: "radial-gradient(ellipse at 20% 20%, rgba(92,15,254,0.45), transparent 55%)" }}
      />
      <div
        className="absolute -right-10 -bottom-16 h-56 w-56 rounded-full blur-3xl"
        style={{ background: "rgba(143,123,253,0.35)" }}
      />

      <div className="relative z-10 flex h-full flex-col justify-between p-5 sm:p-8">
        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.18em] text-white/70">
          <span>Novara Cleaning · STR hosts</span>
          <span>
            {index + 1} / {SCENES.length}
          </span>
        </div>

        <div key={scene.title} className="max-w-xl animate-in fade-in slide-in-from-bottom-2 duration-500">
          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#C4B5FD]">{scene.kicker}</p>
          <h3 className="mt-2 font-heading text-xl font-bold leading-tight tracking-tight sm:text-3xl">
            {scene.title}
          </h3>
          <p className="mt-3 max-w-lg text-sm leading-relaxed text-white/80 sm:text-base">{scene.body}</p>
        </div>

        <div className="space-y-3">
          <div className="h-1 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${progress}%`, background: BRAND.gradient }}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label={playing ? "Pause" : "Play"}
            >
              {playing ? <RiPauseFill className="h-4 w-4" /> : <RiPlayFill className="h-4 w-4" />}
            </button>
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 hover:bg-white/20"
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted ? <RiVolumeMuteLine className="h-4 w-4" /> : <RiVolumeUpLine className="h-4 w-4" />}
            </button>
            <span className="text-[11px] text-white/55">Playing immediately · no email gate</span>
          </div>
        </div>
      </div>
    </div>
  );
}
