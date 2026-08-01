// ─── Real page captures for dispute / chargeback evidence ────────────────
//
// Screenshots the ACTUAL checkout and agreement pages in the customer's own
// browser at the moment they complete each step, then hands the image to
// store-page-capture. qc-drive-mirror later embeds these captures in the
// job's dispute packet, so the packet shows exactly what the customer saw.
//
// Card fields live in Stripe's cross-origin iframe and are never rasterized
// by the browser — no PAN data can end up in a capture.

import { supabase } from "@/integrations/supabase/client";

export type PageCaptureKind = "checkout" | "agreement";

/** Max encoded bytes we'll ship; keeps mobile uploads and the packet sane. */
const MAX_UPLOAD_BYTES = 5_500_000;
/** Never block the customer's navigation for longer than this. */
const CAPTURE_TIMEOUT_MS = 4000;

interface CaptureResult {
  base64: string;
  width: number;
  height: number;
}

async function rasterize(el: HTMLElement): Promise<CaptureResult | null> {
  const { default: html2canvas } = await import("html2canvas");

  // Let webfonts and any late-loading imagery settle so the capture matches
  // what the customer is looking at rather than a half-painted frame.
  try {
    await (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
  } catch {
    /* fonts API unavailable — capture anyway */
  }
  await new Promise((r) => setTimeout(r, 120));

  const width = el.scrollWidth || el.offsetWidth;
  // Cap the raster width so a wide desktop viewport can't produce a 4k image.
  const scale = Math.max(1, Math.min(2, width > 0 ? 1400 / width : 1.5));

  const canvas = await html2canvas(el, {
    backgroundColor: "#ffffff",
    scale,
    useCORS: true,
    logging: false,
    windowWidth: document.documentElement.clientWidth,
    scrollX: 0,
    scrollY: -window.scrollY,
  });

  for (const quality of [0.85, 0.7, 0.55]) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality);
    const base64 = dataUrl.split(",")[1] || "";
    if (base64 && base64.length * 0.75 <= MAX_UPLOAD_BYTES) {
      return { base64, width: canvas.width, height: canvas.height };
    }
  }
  return null;
}

/**
 * Capture `el` and persist it against the booking. Never throws and never
 * rejects — evidence capture must not be able to break the booking funnel.
 * Returns true when the image reached the server.
 */
export async function capturePageForEvidence(
  el: HTMLElement | null,
  opts: { bookingId: string | null | undefined; kind: PageCaptureKind },
): Promise<boolean> {
  if (!el || !opts.bookingId || typeof window === "undefined") return false;
  try {
    const shot = await Promise.race([
      rasterize(el),
      new Promise<null>((r) => setTimeout(() => r(null), CAPTURE_TIMEOUT_MS)),
    ]);
    if (!shot) return false;

    const { error } = await supabase.functions.invoke("store-page-capture", {
      body: {
        bookingId: opts.bookingId,
        kind: opts.kind,
        pageUrl: window.location.href,
        imageBase64: shot.base64,
        imageWidth: shot.width,
        imageHeight: shot.height,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      },
    });
    return !error;
  } catch (err) {
    console.warn(`[page-capture] ${opts.kind} capture failed`, err);
    return false;
  }
}
