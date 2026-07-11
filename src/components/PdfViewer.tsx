"use client";

// ─── PdfViewer — render a whole PDF in-page with pdf.js ─────────────────────
//
// Renders EVERY page of the document as responsive canvases stacked in a
// scrollable column, so the reader can see the entire document without
// downloading it. This replaces <iframe src="...pdf">, which mobile browsers
// (iOS Safari especially) render as a blank box or only the first page.
//
// The `url` should be same-origin or CORS-enabled (see /api/va/agreement,
// which proxies DocuSeal PDFs for exactly this reason).

import { useEffect, useRef, useState } from "react";
import { RiErrorWarningLine, RiExternalLinkLine, RiLoader4Line } from "@remixicon/react";

interface PdfViewerProps {
  url: string;
  /** Accessible label for the document. */
  title?: string;
  className?: string;
}

export function PdfViewer({ url, title = "Document", className }: PdfViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [pagesDone, setPagesDone] = useState(0);
  const [numPages, setNumPages] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    setPagesDone(0);
    setNumPages(0);

    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        // The worker is served as a static asset (public/pdf.worker.min.mjs,
        // copied from pdfjs-dist on install) — letting webpack bundle it via
        // `new URL(...)` breaks the Next build on pdf.js's wasm glue code.
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;
        setNumPages(doc.numPages);

        const container = containerRef.current;
        if (!container) return;
        container.innerHTML = "";
        const cssWidth = container.clientWidth || 600;
        // Cap the backing-store multiplier so huge documents don't blow up
        // memory on mobile, while staying crisp on retina screens.
        const dpr = Math.min(window.devicePixelRatio || 1, 2);

        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          if (cancelled) return;
          const base = page.getViewport({ scale: 1 });
          const viewport = page.getViewport({ scale: (cssWidth / base.width) * dpr });

          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(viewport.width);
          canvas.height = Math.floor(viewport.height);
          canvas.style.width = "100%";
          canvas.style.height = "auto";
          canvas.style.display = "block";
          canvas.setAttribute("role", "img");
          canvas.setAttribute("aria-label", `${title} — page ${i} of ${doc.numPages}`);
          canvas.className = "bg-white border-b border-slate-200 last:border-b-0";
          container.appendChild(canvas);

          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvas, canvasContext: ctx, viewport }).promise;
          if (cancelled) return;
          setPagesDone(i);
        }
        if (!cancelled) setState("ready");
      } catch (e) {
        console.warn("[PdfViewer] failed to render", e instanceof Error ? e.message : String(e));
        if (!cancelled) setState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [url, title]);

  if (state === "error") {
    return (
      <div className={className}>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center space-y-2">
          <RiErrorWarningLine className="w-6 h-6 text-amber-600 mx-auto" />
          <p className="text-xs text-amber-900">
            The in-page preview couldn&apos;t load on this device.
          </p>
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-violet-700 underline underline-offset-2"
          >
            <RiExternalLinkLine className="w-3.5 h-3.5" /> Open the full document in a new tab
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {state === "loading" && (
        <div className="flex items-center justify-center gap-2 py-8 text-slate-400 text-xs">
          <RiLoader4Line className="w-4 h-4 animate-spin" />
          Loading the document{numPages ? ` — page ${Math.min(pagesDone + 1, numPages)} of ${numPages}` : "…"}
        </div>
      )}
      <div ref={containerRef} />
      {state === "ready" && numPages > 0 && (
        <p className="text-center text-[10px] text-slate-400 py-1.5 bg-slate-50 border-t border-slate-200">
          End of document · {numPages} page{numPages === 1 ? "" : "s"}
        </p>
      )}
    </div>
  );
}
