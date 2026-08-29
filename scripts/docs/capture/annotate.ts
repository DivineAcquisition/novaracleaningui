// ─── Screenshot annotation ─────────────────────────────────────────────────
//
// A plain screenshot of a dense admin screen barely helps: the reader still
// has to guess which of forty controls the step is talking about. So every
// captured shot gets numbered callouts drawn over the real elements before
// the image is taken.
//
// The callouts are positioned from the live DOM (the element is located by
// its visible text or a CSS selector, then its bounding box is read), so they
// stay correct when the UI moves — a recapture re-finds the element rather
// than reusing stale pixel coordinates.

import type { Page } from "playwright";

export interface CalloutTarget {
  /** Visible text on the control, matched exactly-ish via Playwright. */
  text?: string;
  /** CSS selector, when text is ambiguous or the target is an icon. */
  selector?: string;
  /** Which match to use when several elements share the text. */
  nth?: number;
  /** Grow the highlight box by this many pixels on each side. */
  pad?: number;
  /** Require an exact text match — needed when sidebar copy repeats a tab name. */
  exact?: boolean;
  /** Scope the search to a container, for words that recur across the page. */
  within?: string;
}

export interface Callout extends CalloutTarget {
  /** Short label rendered next to the number, e.g. "Status filter". */
  label: string;
}

export interface ResolvedCallout {
  n: number;
  label: string;
  box: { x: number; y: number; width: number; height: number };
}

/** Resolve a callout target to a viewport-relative box, or null if missing. */
async function resolveBox(page: Page, target: CalloutTarget) {
  const nth = target.nth ?? 0;
  const scope = target.within ? page.locator(target.within).first() : page;
  let locator;
  if (target.selector) {
    locator = scope.locator(target.selector).nth(nth);
  } else if (target.text) {
    locator = scope.getByText(target.text, { exact: target.exact ?? false }).nth(nth);
  } else {
    return null;
  }
  try {
    if ((await locator.count()) === 0) return null;
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {});
    const box = await locator.boundingBox({ timeout: 2000 });
    if (!box || box.width === 0 || box.height === 0) return null;
    const pad = target.pad ?? 4;
    return { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 };
  } catch {
    return null;
  }
}

/**
 * Draw the callouts and return the ones that were actually found. A missing
 * target is reported rather than silently skipped: it usually means the
 * screen changed and the doc step needs revisiting.
 */
export async function drawCallouts(
  page: Page,
  callouts: Callout[],
  /**
   * Visible region the badges must stay inside. For a cropped shot this is
   * the crop box — without it a badge placed to the left of a control near
   * the crop's left edge is simply cut off the image.
   */
  bounds?: { x: number; width: number },
): Promise<{ drawn: ResolvedCallout[]; missing: string[] }> {
  const drawn: ResolvedCallout[] = [];
  const missing: string[] = [];

  for (let i = 0; i < callouts.length; i++) {
    const c = callouts[i];
    const box = await resolveBox(page, c);
    if (!box) {
      missing.push(c.label);
      continue;
    }
    drawn.push({ n: drawn.length + 1, label: c.label, box });
  }

  await page.evaluate((payload: { items: ResolvedCallout[]; bounds?: { x: number; width: number } }) => {
    const { items, bounds } = payload;
    document.querySelectorAll("[data-novara-callout]").forEach((n) => n.remove());
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const leftEdge = bounds ? bounds.x : 0;

    for (const item of items) {
      const wrap = document.createElement("div");
      wrap.setAttribute("data-novara-callout", "1");
      Object.assign(wrap.style, {
        position: "absolute",
        left: `${item.box.x + scrollX}px`,
        top: `${item.box.y + scrollY}px`,
        width: `${item.box.width}px`,
        height: `${item.box.height}px`,
        border: "2.5px solid #5C0FFE",
        borderRadius: "8px",
        boxShadow: "0 0 0 3px rgba(92,15,254,0.16)",
        pointerEvents: "none",
        zIndex: "2147483000",
      } as CSSStyleDeclaration);

      // Sit the badge OUTSIDE the box so it never covers the label it is
      // pointing at — to the left where there's room, otherwise to the right.
      const badgeSize = 26;
      const gap = 8;
      const hasRoomLeft = item.box.x - (badgeSize + gap) > leftEdge;
      const badge = document.createElement("div");
      Object.assign(badge.style, {
        position: "absolute",
        [hasRoomLeft ? "right" : "left"]: `${-(badgeSize + gap)}px`,
        top: "50%",
        transform: "translateY(-50%)",
        width: `${badgeSize}px`,
        height: `${badgeSize}px`,
        borderRadius: "999px",
        background: "#5C0FFE",
        color: "#fff",
        font: `700 14px/${badgeSize}px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif`,
        textAlign: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
      } as unknown as CSSStyleDeclaration);
      badge.textContent = String(item.n);
      wrap.appendChild(badge);
      document.body.appendChild(wrap);
    }
  }, { items: drawn, bounds });

  return { drawn, missing };
}

/**
 * Blur any element that could conceivably carry identifying information.
 * The capture harness already serves only invented data, so this is belt and
 * braces — it exists so that if a future capture is ever pointed at a real
 * instance by mistake, the obvious PII surfaces are still obscured.
 */
export async function redact(page: Page, selectors: string[]): Promise<void> {
  if (selectors.length === 0) return;
  await page.evaluate((sels: string[]) => {
    for (const sel of sels) {
      document.querySelectorAll<HTMLElement>(sel).forEach((el) => {
        el.style.filter = "blur(6px)";
      });
    }
  }, selectors);
}

/** Remove the overlay so the next shot on the same page starts clean. */
export async function clearCallouts(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelectorAll("[data-novara-callout]").forEach((n) => n.remove());
  });
}
