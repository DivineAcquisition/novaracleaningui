// ─── Spotlight annotation for video frames ────────────────────────────────
//
// The numbered callouts in annotate.ts suit a written guide ("badge 2 is the
// status filter"). A video talks about one thing at a time, so these frames
// get one spotlight instead: everything dimmed except the control being
// narrated, with a brand-purple ring around it. Nothing is drawn ON the
// target, so no label or badge can cover the words the viewer should read.
//
// The target is found in the live DOM (text or selector), and several targets
// can be merged into one box — "the three notes", "the checked items".

import type { Page } from "playwright";

export interface SpotTarget {
  selector?: string;
  text?: string;
  exact?: boolean;
  nth?: number;
  /** Container to search within (its first match). */
  within?: string;
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

const describe = (t: SpotTarget) => t.selector ?? `text "${t.text}"`;

function merge(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/**
 * Union of every target's box in VIEWPORT coordinates (what boundingBox()
 * returns), plus the ones that could not be found.
 */
export async function locateTargets(page: Page, targets: SpotTarget[]): Promise<{ box: Box | null; missing: string[] }> {
  let box: Box | null = null;
  const missing: string[] = [];
  for (const t of targets) {
    const scope = t.within ? page.locator(t.within).first() : page;
    const locator = t.selector
      ? scope.locator(t.selector).nth(t.nth ?? 0)
      : scope.getByText(t.text ?? "", { exact: t.exact ?? false }).nth(t.nth ?? 0);
    const found = (await locator.count().catch(() => 0)) > 0 ? await locator.boundingBox().catch(() => null) : null;
    if (!found || found.width === 0 || found.height === 0) {
      missing.push(describe(t));
      continue;
    }
    box = box ? merge(box, found) : found;
  }
  return { box, missing };
}

/**
 * Scroll so the box sits where a viewer's eye lands: vertically centered, or
 * near the top when it is taller than the space left under the sticky header.
 */
export async function frameBox(page: Page, box: Box, align: "center" | "top" = "center", headerOffset = 72): Promise<void> {
  await page.evaluate(
    ({ box, align, headerOffset }) => {
      const vh = window.innerHeight;
      const docTop = box.y + window.scrollY;
      const room = vh - headerOffset;
      const target =
        align === "top" || box.height > room - 48
          ? docTop - headerOffset - 20
          : docTop - headerOffset - (room - box.height) / 2;
      // The app sets scroll-behavior: smooth; a box measured mid-animation
      // lands the spotlight on the wrong row.
      window.scrollTo({ top: Math.max(0, target), behavior: "instant" });
    },
    { box, align, headerOffset },
  );
  // Belt and braces: wait until the scroll position stops moving.
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const y = await page.evaluate(() => window.scrollY);
    if (y === last) break;
    last = y;
    await page.waitForTimeout(100);
  }
}

/** Dim the page around the box and ring it. Viewport coordinates, fixed. */
export async function drawSpotlight(page: Page, box: Box, pad = 8, radius = 14): Promise<void> {
  await page.evaluate(
    ({ box, pad, radius }) => {
      document.querySelectorAll("[data-capture-spotlight]").forEach((n) => n.remove());
      const hole = document.createElement("div");
      hole.setAttribute("data-capture-spotlight", "1");
      Object.assign(hole.style, {
        position: "fixed",
        left: `${box.x - pad}px`,
        top: `${box.y - pad}px`,
        width: `${box.width + pad * 2}px`,
        height: `${box.height + pad * 2}px`,
        borderRadius: `${radius}px`,
        boxShadow:
          "0 0 0 3px #7C4DFF, 0 0 0 9px rgba(124,77,255,0.30), 0 0 34px 10px rgba(124,77,255,0.35), 0 0 0 200vmax rgba(20,12,44,0.55)",
        pointerEvents: "none",
        zIndex: "2147483600",
      } as CSSStyleDeclaration);
      document.body.appendChild(hole);
    },
    { box, pad, radius },
  );
}

export async function clearSpotlight(page: Page): Promise<void> {
  await page.evaluate(() => document.querySelectorAll("[data-capture-spotlight]").forEach((n) => n.remove()));
}
