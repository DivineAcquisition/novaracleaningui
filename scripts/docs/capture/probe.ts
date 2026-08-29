// Throwaway helper: print candidate selectors for a region of a screen so the
// shot definitions can target a stable container instead of guessing.
//
//   npx tsx scripts/docs/capture/probe.ts /admin/csr "Live quote"

import { chromium } from "playwright";
import { handleApiRoute, handleSupabase } from "./supabase-mock";
import { DEMO_ADMIN } from "./demo-data";

const BASE = process.env.DOCS_CAPTURE_BASE_URL || "http://localhost:3100";

async function main() {
  const [path, needle] = process.argv.slice(2);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.route("**/*.supabase.co/**", (r, q) => handleSupabase(r, q));
  await ctx.route("**/api/**", (r, q) => handleApiRoute(r, q));
  await ctx.route(/googleapis|gstatic|google\.com|stripe\.com/, (r) => r.abort());
  const now = Math.floor(Date.now() / 1000);
  await ctx.addInitScript(
    ([key, session]) => window.localStorage.setItem(key as string, JSON.stringify(session)),
    [
      "sb-sxdraeptzuamsgjcvfeg-auth-token",
      {
        access_token: "demo-access-token",
        refresh_token: "demo-refresh-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: now + 3600,
        user: { id: DEMO_ADMIN.id, email: DEMO_ADMIN.email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
      },
    ] as const,
  );
  const page = await ctx.newPage();
  await page.goto(`${BASE}${path}`, { waitUntil: "commit" });
  await page.waitForTimeout(6000);

  const info = await page.evaluate((text: string) => {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    const hits: any[] = [];
    let node = walker.nextNode() as HTMLElement | null;
    while (node) {
      if (node.textContent?.trim().startsWith(text) && node.children.length < 6) {
        let el: HTMLElement | null = node;
        const chain: string[] = [];
        for (let i = 0; i < 6 && el; i++) {
          const r = el.getBoundingClientRect();
          chain.push(
            `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""}.${(el.className || "")
              .toString()
              .split(/\s+/)
              .slice(0, 6)
              .join(".")} [${Math.round(r.width)}x${Math.round(r.height)} @ ${Math.round(r.x)},${Math.round(r.y)}]`,
          );
          el = el.parentElement;
        }
        hits.push(chain);
      }
      node = walker.nextNode() as HTMLElement | null;
    }
    return hits.slice(0, 3);
  }, needle);

  for (const chain of info) {
    console.log("--- match ---");
    chain.forEach((c: string, i: number) => console.log(`  ${i}: ${c}`));
  }
  await browser.close();
}

main();
