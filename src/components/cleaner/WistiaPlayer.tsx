"use client";

// ─── WistiaPlayer ────────────────────────────────────────────────────────
//
// Lightweight wrapper around Wistia's web-component embed. We inject the
// two Wistia scripts once (player runtime + the per-media module) and a
// placeholder style, then render the <wistia-player> custom element via
// dangerouslySetInnerHTML so TypeScript/JSX doesn't need a declaration for
// the non-standard tag. Safe to mount multiple times — script injection
// is idempotent (keyed by src).

import { useEffect } from "react";

interface WistiaPlayerProps {
  mediaId: string;
  aspect?: number;
  /** padding-top % used for the blurred placeholder (height / width * 100). */
  placeholderPaddingTop?: string;
  className?: string;
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
}: WistiaPlayerProps) {
  useEffect(() => {
    ensureScript("https://fast.wistia.com/player.js");
    ensureScript(`https://fast.wistia.com/embed/${mediaId}.js`, true);
  }, [mediaId]);

  const placeholderStyle = `wistia-player[media-id='${mediaId}']:not(:defined) { background: center / contain no-repeat url('https://fast.wistia.com/embed/medias/${mediaId}/swatch'); display: block; filter: blur(5px); padding-top:${placeholderPaddingTop}; }`;

  return (
    <div className={className}>
      <style dangerouslySetInnerHTML={{ __html: placeholderStyle }} />
      <div
        dangerouslySetInnerHTML={{
          __html: `<wistia-player media-id="${mediaId}" aspect="${aspect}"></wistia-player>`,
        }}
      />
    </div>
  );
}
