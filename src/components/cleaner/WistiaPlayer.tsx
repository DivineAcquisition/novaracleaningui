"use client";

// ─── WistiaPlayer ────────────────────────────────────────────────────────
//
// Lightweight wrapper around Wistia's web-component embed. We inject the
// two Wistia scripts once (player runtime + the per-media module) and a
// placeholder style, then render the <wistia-player> custom element via
// dangerouslySetInnerHTML so TypeScript/JSX doesn't need a declaration for
// the non-standard tag. Safe to mount multiple times — script injection
// is idempotent (keyed by src).

import { useEffect, useRef } from "react";

interface WistiaPlayerProps {
  mediaId: string;
  aspect?: number;
  /** padding-top % used for the blurred placeholder (height / width * 100). */
  placeholderPaddingTop?: string;
  className?: string;
  autoPlay?: boolean;
  muted?: boolean;
  /**
   * Fires when playback reaches the end. If Wistia reports how much was
   * actually watched and that share is under 90%, this waits — seeking to
   * the end does not count as finishing the video.
   */
  onEnded?: () => void;
}

function ensureScript(src: string, asModule = false) {
  if (typeof document === "undefined") return;
  if (document.querySelector(`script[src="${src}"]`)) return;
  const s = document.createElement("script");
  s.src = src;
  s.async = true;
  if (asModule) s.type = "module";
  document.head.appendChild(s);
}

export function WistiaPlayer({
  mediaId,
  aspect = 1.6783216783216783,
  placeholderPaddingTop = "59.58%",
  className,
  autoPlay = false,
  muted = false,
  onEnded,
}: WistiaPlayerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  useEffect(() => {
    ensureScript("https://fast.wistia.com/player.js");
    ensureScript(`https://fast.wistia.com/embed/${mediaId}.js`, true);
  }, [mediaId]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root || !onEnded) return;
    let player: Element | null = null;

    const finishIfWatched = () => {
      const watched = (player as { percentWatched?: number } | null)?.percentWatched;
      if (typeof watched === "number" && watched > 0 && watched < 0.9) return;
      onEndedRef.current?.();
    };

    const bind = () => {
      const next = root.querySelector("wistia-player");
      if (!next || next === player) return;
      player?.removeEventListener("end", finishIfWatched);
      player?.removeEventListener("ended", finishIfWatched);
      player = next;
      player.addEventListener("end", finishIfWatched);
      player.addEventListener("ended", finishIfWatched);
    };

    bind();
    const observer = new MutationObserver(bind);
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      player?.removeEventListener("end", finishIfWatched);
      player?.removeEventListener("ended", finishIfWatched);
    };
  }, [mediaId, onEnded]);

  const placeholderStyle = `wistia-player[media-id='${mediaId}']:not(:defined) { background: center / contain no-repeat url('https://fast.wistia.com/embed/medias/${mediaId}/swatch'); display: block; filter: blur(5px); padding-top:${placeholderPaddingTop}; }`;

  return (
    <div ref={rootRef} className={className}>
      <style dangerouslySetInnerHTML={{ __html: placeholderStyle }} />
      <div
        dangerouslySetInnerHTML={{
          __html: `<wistia-player media-id="${mediaId}" aspect="${aspect}"${autoPlay ? ' autoplay="true"' : ""}${muted ? ' muted="true"' : ""}></wistia-player>`,
        }}
      />
    </div>
  );
}
