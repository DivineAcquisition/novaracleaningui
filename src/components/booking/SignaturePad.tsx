"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { RiEraserLine } from "@remixicon/react";

interface SignaturePadProps {
  onChange: (dataUrl: string | null) => void;
  height?: number;
}

// Dependency-free canvas signature pad. Emits a PNG data URL (or null when
// cleared). Works with mouse + touch/stylus via pointer events.
export function SignaturePad({ onChange, height = 160 }: SignaturePadProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const hasInk = useRef(false);
  const [empty, setEmpty] = useState(true);

  const ctxOf = () => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    return canvas.getContext("2d");
  };

  // Size the canvas backing store to its display size * DPR for crisp lines.
  // Idempotent: a no-op when the size hasn't actually changed, so a stray
  // window "resize" (mobile keyboard open, URL bar collapse) can't silently
  // wipe a signature the customer already drew. Also never sizes to 0 — a
  // 0-width backing store (when the card animates in before layout settles)
  // is what made the pad look "broken" / uncapturable.
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.round(rect.width * dpr);
    const h = Math.round(rect.height * dpr);
    if (w === 0 || h === 0) return;
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#1e1b2e";
    }
  }, []);

  useEffect(() => {
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [resize]);

  const pos = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const start = (e: React.PointerEvent) => {
    e.preventDefault();
    // Ensure the backing store is sized before the first stroke (handles a
    // canvas that mounted at 0-width inside an animating card).
    resize();
    const ctx = ctxOf();
    if (!ctx) return;
    drawing.current = true;
    const { x, y } = pos(e);
    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    e.preventDefault();
    const ctx = ctxOf();
    if (!ctx) return;
    const { x, y } = pos(e);
    ctx.lineTo(x, y);
    ctx.stroke();
    if (!hasInk.current) {
      hasInk.current = true;
      setEmpty(false);
    }
  };

  const end = () => {
    if (!drawing.current) return;
    drawing.current = false;
    if (hasInk.current && canvasRef.current) {
      onChange(canvasRef.current.toDataURL("image/png"));
    }
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = ctxOf();
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    hasInk.current = false;
    setEmpty(true);
    onChange(null);
  };

  return (
    <div className="space-y-2">
      <div className="relative rounded-lg border-2 border-dashed border-primary/30 bg-white">
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height, touchAction: "none" }}
          className="rounded-lg cursor-crosshair"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerLeave={end}
        />
        {empty && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Sign here with your finger or mouse
          </div>
        )}
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" size="sm" onClick={clear} disabled={empty}>
          <RiEraserLine className="w-4 h-4 mr-1.5" />
          Clear
        </Button>
      </div>
    </div>
  );
}
