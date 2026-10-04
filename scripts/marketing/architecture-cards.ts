// ─── Architecture cards for X ─────────────────────────────────────────────
//
//   npx tsx scripts/marketing/architecture-cards.ts
//
// One 1600×900 image (rendered at 2×) per area of the platform breakdown —
// booking, pricing, recurring, sales, operations, QC, back office, other
// channels — plus a cover and a by-the-numbers card. Written to
// docs/architecture-cards/ with a README of draft post copy.
//
// Every node names the real edge function, table or route behind it, and
// every number on the stats card was measured from this repository. If a
// function is renamed or a claim stops being true, change it here; the
// cards are meant to be pitched in public.
//
// Environment (same as the docs capture scripts):
//   DOCS_CAPTURE_CHROMIUM   Chromium binary when Playwright's build is absent
//   DOCS_CAPTURE_FONT_DIR   folder with @fontsource Inter, Plus Jakarta Sans and
//                           JetBrains Mono — without it, system fonts are used

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Route } from "playwright";

import { crop, encodePng, loadGuideImage } from "../docs/capture/guide-artwork";

const ROOT = resolve(__dirname, "../..");
const OUT = resolve(ROOT, "docs/architecture-cards");
const SIZE = { width: 1600, height: 900 };
const ASSET = "https://card-assets.local/";

// ─── Content ───────────────────────────────────────────────────────────────

interface Node {
  t: string;
  c?: string;
  /** Small chips inside the node (tools an agent can call, etc.). */
  list?: string[];
  hi?: boolean;
}
interface Row {
  label?: string;
  nodes: Node[];
}
interface Chip {
  t: string;
  c?: string;
}
interface SectionCard {
  kind: "section";
  slug: string;
  title: string;
  pitch: string;
  rows: Row[];
  note?: string;
  aroundLabel?: string;
  around?: Chip[];
  post: string;
}

const SECTIONS: SectionCard[] = [
  {
    kind: "section",
    slug: "customer-booking",
    title: "Customer booking",
    pitch: "An exact price and a confirmed booking in one flow. No “we'll call you with a quote.”",
    rows: [
      {
        nodes: [
          { t: "ZIP code", c: "pricing_zone_zips" },
          { t: "Home size", c: "sq ft band" },
          { t: "Instant price", c: "quote-dynamic-price", hi: true },
          { t: "Deposit or card on file", c: "create-payment-intent" },
          { t: "Booked", c: "stripe-webhook" },
        ],
      },
    ],
    around: [
      { t: "Abandoned checkouts tracked", c: "track-abandoned-cart" },
      { t: "Self-serve rescheduling", c: "reschedule-booking" },
      { t: "Saved cards", c: "get-saved-payment-methods" },
      { t: "Tips to the cleaner", c: "tip-cleaner" },
    ],
    post:
      "Most cleaning companies still answer “how much?” with “we'll call you.” Ours answers with a number: ZIP → home size → exact price → deposit → booked. One flow, no phone tag.",
  },
  {
    kind: "section",
    slug: "pricing-engine",
    title: "The pricing engine",
    pitch: "Same home, same date, same address: same price. Every layer is its own line, so any quote can be explained.",
    rows: [
      {
        nodes: [
          { t: "Base rate", c: "size band × service" },
          { t: "× Condition", c: "how much work" },
          { t: "× Zone", c: "where, by ZIP" },
          { t: "× Demand*", c: "how busy the date is" },
          { t: "Floor & ceiling", c: "guardrails", hi: true },
          { t: "+ Add-ons", c: "flat, never multiplied" },
        ],
      },
    ],
    note: "* Demand layer is built and switched off today. Add-ons and the same-day fee are flat amounts, added last.",
    around: [
      { t: "Live quotes", c: "quote-dynamic-price" },
      { t: "Every quote logged", c: "price_quote_audit" },
      { t: "Logged manual overrides", c: "price_overrides" },
      { t: "Separate commercial formula", c: "quote-commercial-price" },
    ],
    post:
      "Our pricing is a pipeline, not a guess: base rate × condition × zone × demand, clamped by a floor and a ceiling, then flat add-ons. Same inputs, same price, every time, and every layer shows as its own line.",
  },
  {
    kind: "section",
    slug: "recurring-revenue",
    title: "Recurring revenue",
    pitch: "Glow memberships turn a one-off clean into a standing relationship, with the same cleaner every visit.",
    rows: [
      {
        nodes: [
          { t: "Join Glow", c: "create-membership-intent" },
          { t: "Schedule saved", c: "manage-recurring-schedule" },
          { t: "Next visit booked, same cleaner", c: "customer-recurring-generate", hi: true },
          { t: "Synced everywhere", c: "GHL · Airtable · Google Calendar" },
        ],
      },
    ],
    around: [
      { t: "At-risk member alerts", c: "at-risk board" },
      { t: "Credits and expiry", c: "check-credit-expiry" },
      { t: "Pause and resume", c: "pause-subscription" },
      { t: "MRR tracking", c: "admin-memberships" },
    ],
    post:
      "The most valuable thing a cleaning company can build is a recurring customer. Members get their next visit booked automatically with the same cleaner, and an at-risk board flags quiet cancellations before they happen.",
  },
  {
    kind: "section",
    slug: "speed-to-lead",
    title: "Speed-to-lead",
    pitch: "Every lead gets answered fast: by a VA, by automation, or by an AI agent that can actually book.",
    rows: [
      {
        label: "LEAD RECOVERY",
        nodes: [
          { t: "Facebook lead lands", c: "lead-intake" },
          { t: "VA assigned", c: "lead alert" },
          { t: "No call in 10 min?", c: "pg_cron · every minute" },
          { t: "Auto-text + escalate", c: "escalate-stale-leads", hi: true },
        ],
      },
      {
        label: "AI SMS AGENT",
        nodes: [
          { t: "Customer texts", c: "Telnyx" },
          { t: "AI agent picks a tool", c: "ai-tool-router", hi: true },
          {
            t: "Tools it can call",
            list: ["price estimate", "open slots", "create booking + Stripe link", "service area", "waitlist", "hand off to a human"],
          },
        ],
      },
    ],
    post:
      "Leads go cold in minutes. Ours don't get the chance: a cron checks every minute for leads nobody has called in 10 minutes and texts them, and an AI SMS agent can quote, find a slot and send a payment link on its own.",
  },
  {
    kind: "section",
    slug: "dispatch",
    title: "Dispatch without a dispatcher",
    pitch: "Postgres holds the clock and the rules; edge functions do the texting. Jobs get offered, claimed and covered on their own.",
    rows: [
      {
        nodes: [
          { t: "Booking confirmed" },
          { t: "Rank cleaners", c: "location · rating · workload" },
          { t: "SMS offer, first to claim", c: "dispatch-job", hi: true },
          { t: "Check in on site", c: "job-check-in" },
          { t: "Checklist + photo proof", c: "cleaner-job-checklist" },
        ],
      },
    ],
    around: [
      { t: "Unclaimed offers roll to the next closest", c: "expire-job-offers" },
      { t: "Coverage brain in Postgres", c: "run_coverage_cycle" },
      { t: "Reliability scores every 6h", c: "compute-cleaner-scores" },
      { t: "Live map of crews", c: "apploye-live-tracking" },
    ],
    post:
      "We don't have a dispatcher. Postgres owns the clock and the rules, edge functions send the texts: ranked cleaners get an SMS offer, first to claim wins, and unclaimed offers roll to the next closest automatically.",
  },
  {
    kind: "section",
    slug: "quality-control",
    title: "Quality control",
    pitch: "Every complaint becomes a case: a free re-clean for the customer, and a file that holds up in a dispute.",
    rows: [
      {
        nodes: [
          { t: "Complaint logged", c: "qc-issues" },
          { t: "Verified + classified" },
          { t: "Free re-clean", c: "Spotless Guarantee · qc-reclean", hi: true },
          { t: "Live case file", c: "qc-case-file" },
          { t: "Dispute packet PDF", c: "Drive archive" },
        ],
      },
    ],
    aroundLabel: "IN THE CASE FILE",
    around: [
      { t: "Signed agreements" },
      { t: "Live Stripe charges + refunds" },
      { t: "Before/after photos" },
      { t: "Checklist + audit timeline" },
    ],
    post:
      "A complaint shouldn't be a he-said-she-said. Every one opens a case: a free re-clean under our Spotless Guarantee, plus a file built live from signed agreements, Stripe charges, photos, the checklist and a full audit trail.",
  },
  {
    kind: "section",
    slug: "back-office",
    title: "Pay and paperwork",
    pitch: "From a finished job to a contractor payout to a 1099, with no spreadsheet in the middle.",
    rows: [
      {
        nodes: [
          { t: "Job approved", c: "admin-review-completion" },
          { t: "Pay = job value × tier", c: "process-payout" },
          { t: "Approve & Pay", c: "payroll-execute", hi: true },
          { t: "Stripe Connect transfer", c: "pay-cleaner-transfer" },
          { t: "1099-NEC from the pay ledger", c: "nec-1099" },
        ],
      },
    ],
    around: [
      { t: "W-9 collected in onboarding", c: "cleaner_w9" },
      { t: "P&L synced", c: "pl-sheet-sync" },
      { t: "Weekly report", c: "weekly-report-generate" },
      { t: "Tips passed through 100%", c: "cleaner_tips" },
    ],
    post:
      "Paying 1099 cleaners usually means a spreadsheet and a late night. Ours: job approved → pay calculated from job value × tier → one Approve & Pay → Stripe Connect transfers → 1099-NEC built from the same ledger.",
  },
  {
    kind: "section",
    slug: "other-channels",
    title: "Two more revenue lines, same rails",
    pitch: "Airbnb hosts and commercial buildings run on the same dispatch, checklists and payouts as homes.",
    rows: [
      {
        label: "AIRBNB / SHORT-TERM RENTAL",
        nodes: [
          { t: "Host signs up", c: "partner-host-onboarding" },
          { t: "Turnovers generated", c: "partner-jobs-generate" },
          { t: "On Google Calendar + GHL", c: "sync-turnover-calendar", hi: true },
          { t: "Dispatched like any job", c: "dispatch-job" },
        ],
      },
      {
        label: "COMMERCIAL",
        nodes: [
          { t: "Site walkthrough", c: "walkthrough-pipeline-sweep" },
          { t: "Priced proposal", c: "sq ft × facility × scope × size" },
          { t: "Signed agreement", c: "DocuSeal" },
          { t: "Hourly sweep keeps deals moving", c: "commercial-proposal-sweep", hi: true },
        ],
      },
    ],
    post:
      "Once dispatch, checklists and payouts exist, a new revenue line is mostly a new front door. Airbnb turnovers land on the calendar and get dispatched like any job; commercial runs walkthrough → priced proposal → signed agreement.",
  },
];

const AREAS: Array<{ title: string; line: string }> = [
  { title: "Customer booking", line: "Instant quote to paid booking" },
  { title: "Pricing engine", line: "Layered, explainable, deterministic" },
  { title: "Recurring revenue", line: "Glow memberships, same cleaner" },
  { title: "Speed-to-lead", line: "VA, automation and an AI agent" },
  { title: "Dispatch", line: "First to claim wins, no dispatcher" },
  { title: "Quality control", line: "Re-cleans and dispute-proof files" },
  { title: "Pay and paperwork", line: "Payouts, payroll, 1099s" },
  { title: "Other channels", line: "Airbnb turnovers and commercial" },
];

// Measured from this repository (see README for how).
const STATS: Array<{ n: string; label: string }> = [
  { n: "363k", label: "lines of code" },
  { n: "225", label: "backend functions" },
  { n: "373", label: "database migrations" },
  { n: "118", label: "web pages" },
  { n: "2", label: "apps: web portal + contractor mobile" },
  { n: "12", label: "integrations" },
];
const INTEGRATIONS = [
  "Stripe Connect",
  "GoHighLevel",
  "Telnyx",
  "Resend",
  "Airtable",
  "Google Calendar",
  "Google Drive",
  "DocuSeal",
  "Discord",
  "Zapier",
  "Cal.com",
  "Apploye",
];
const STACK = ["Next.js", "Supabase Postgres", "225 Deno edge functions", "pg_cron", "Stripe Connect", "Expo"];

// ─── HTML ──────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const TOTAL = SECTIONS.length;

const C = {
  bg: "#0B0817",
  panel: "#151129",
  panel2: "#1B1535",
  line: "#2C2550",
  ink: "#F4F1FF",
  muted: "#A9A2CB",
  dim: "#6F6894",
  violet: "#7C4DFF",
  brand: "#5C0FFE",
  lav: "#C4B5FD",
  gold: "#E2B94B",
};

function fontFaces(fonts: Map<string, Buffer> | null): string {
  if (!fonts) return "";
  return [...fonts.keys()]
    .map((file) => {
      const m = file.match(/^(inter|plus-jakarta-sans|jetbrains-mono)-latin-(\d+)-normal\.woff2$/);
      if (!m) return "";
      const family = { inter: "Inter", "plus-jakarta-sans": "Plus Jakarta Sans", "jetbrains-mono": "JetBrains Mono" }[m[1]];
      return `@font-face{font-family:"${family}";font-weight:${m[2]};src:url(${ASSET}fonts/${file}) format("woff2")}`;
    })
    .join("");
}

function shell(body: string, fonts: Map<string, Buffer> | null, css = ""): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces(fonts)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${SIZE.width}px;height:${SIZE.height}px;overflow:hidden}
body{background:${C.bg};color:${C.ink};font-family:"Inter",system-ui,sans-serif;position:relative;-webkit-font-smoothing:antialiased}
body::before{content:"";position:absolute;inset:0;background-image:radial-gradient(rgba(196,181,253,.10) 1.2px,transparent 1.2px);background-size:28px 28px;mask-image:linear-gradient(180deg,rgba(0,0,0,.9),rgba(0,0,0,.25))}
body::after{content:"";position:absolute;right:-220px;top:-260px;width:820px;height:820px;border-radius:50%;background:radial-gradient(closest-side,rgba(92,15,254,.28),rgba(92,15,254,0))}
.wrap{position:absolute;inset:0;padding:64px 80px;z-index:1}
.jk{font-family:"Plus Jakarta Sans","Inter",sans-serif}
.mono{font-family:"JetBrains Mono",ui-monospace,monospace}
.top{display:flex;justify-content:space-between;align-items:center;font-family:"JetBrains Mono",monospace;font-size:17px;letter-spacing:.14em;color:${C.dim}}
.top b{color:${C.lav};font-weight:500}
.foot{position:absolute;left:80px;right:80px;bottom:52px;display:flex;justify-content:space-between;align-items:center}
.brand{display:flex;align-items:center;gap:14px;font:800 22px/1 "Plus Jakarta Sans",sans-serif;letter-spacing:.04em}
.brand img{width:40px;height:40px;border-radius:10px}
.brand span{color:${C.dim};font:500 17px/1 "JetBrains Mono",monospace;letter-spacing:.06em;margin-left:6px}
.pager{font:500 17px/1 "JetBrains Mono",monospace;color:${C.dim};letter-spacing:.12em}
${css}
</style></head><body><div class="wrap">${body}</div></body></html>`;
}

const brandFoot = (right: string) =>
  `<div class="foot"><div class="brand"><img src="${ASSET}logo.png" alt="">NOVARA<span>novaracleaning.com</span></div><div class="pager">${right}</div></div>`;

const ARROW = `<svg class="arrow" width="40" height="18" viewBox="0 0 40 18"><path d="M1 9h32" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-dasharray="1 7"/><path d="M29 3l8 6-8 6" fill="none" stroke="${C.violet}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function nodeHtml(n: Node, i: number): string {
  const list = n.list ? `<div class="tools">${n.list.map((x) => `<span>${esc(x)}</span>`).join("")}</div>` : "";
  return `<div class="node${n.hi ? " hi" : ""}${n.list ? " wide" : ""}"><div class="step">${String(i + 1).padStart(2, "0")}</div><h3>${esc(n.t)}</h3>${
    n.c ? `<code>${esc(n.c)}</code>` : ""
  }${list}</div>`;
}

function sectionHtml(card: SectionCard, index: number, fonts: Map<string, Buffer> | null): string {
  const two = card.rows.length > 1;
  const rows = card.rows
    .map(
      (r) =>
        `<div class="row">${r.label ? `<div class="rowlabel">${esc(r.label)}</div>` : ""}<div class="flow">${r.nodes
          .map((n, i) => nodeHtml(n, i))
          .join(ARROW)}</div></div>`,
    )
    .join("");
  const around = card.around
    ? `<div class="around"><div class="rowlabel">${esc(card.aroundLabel ?? "AROUND IT")}</div><div class="chips">${card.around
        .map((a) => `<div class="chip"><b>${esc(a.t)}</b>${a.c ? `<code>${esc(a.c)}</code>` : ""}</div>`)
        .join("")}</div></div>`
    : "";
  const css = `
h1{margin-top:38px;font:800 70px/1.02 "Plus Jakarta Sans",sans-serif;letter-spacing:-.02em}
.pitch{margin-top:18px;font-size:28px;line-height:1.38;color:${C.muted};max-width:1300px}
.rows{margin-top:${two ? 44 : 70}px;display:flex;flex-direction:column;gap:${two ? 22 : 0}px}
.rowlabel{font:500 15px/1 "JetBrains Mono",monospace;letter-spacing:.16em;color:${C.gold};margin-bottom:12px}
.flow{display:flex;align-items:center;gap:10px}
.arrow{flex:none}
.node{flex:1 1 0;min-width:0;align-self:stretch;background:${C.panel};border:1.5px solid ${C.line};border-radius:18px;padding:${two ? "20px 20px" : "28px 22px"};display:flex;flex-direction:column;gap:10px}
.node.wide{flex:2.3 1 0}
.node.hi{border-color:${C.violet};background:linear-gradient(180deg,#221846,${C.panel});box-shadow:0 0 0 4px rgba(124,77,255,.14),0 18px 40px -18px rgba(124,77,255,.6)}
.step{font:500 14px/1 "JetBrains Mono",monospace;color:${C.dim};letter-spacing:.08em}
.node.hi .step{color:${C.lav}}
.node h3{font:700 ${two ? 26 : 28}px/1.2 "Plus Jakarta Sans",sans-serif;letter-spacing:-.005em}
.node code{font:500 17px/1.3 "JetBrains Mono",monospace;color:${C.lav};overflow-wrap:anywhere}
.tools{display:flex;flex-wrap:wrap;gap:7px;margin-top:2px}
.tools span{font:500 14px/1 "JetBrains Mono",monospace;color:${C.ink};background:${C.panel2};border:1px solid ${C.line};border-radius:8px;padding:7px 9px}
.note{margin-top:14px;font-size:17px;color:${C.dim}}
.around{margin-top:${two ? 30 : 64}px}
.chips{display:grid;grid-template-columns:repeat(${card.around?.length ?? 4},1fr);gap:12px}
.chip{background:rgba(21,17,41,.6);border:1px dashed ${C.line};border-radius:14px;padding:18px 18px;display:flex;flex-direction:column;gap:6px}
.chip b{font:600 21px/1.25 "Inter",sans-serif}
.chip code{font:500 15px/1.2 "JetBrains Mono",monospace;color:${C.dim}}
`;
  const body =
    `<div class="top"><span><b>NOVARA OS</b> · SYSTEM BREAKDOWN</span><span>${String(index + 1).padStart(2, "0")} / ${String(TOTAL).padStart(2, "0")}</span></div>` +
    `<h1>${esc(card.title)}</h1><p class="pitch">${esc(card.pitch)}</p><div class="rows">${rows}</div>` +
    (card.note ? `<p class="note">${esc(card.note)}</p>` : "") +
    around +
    brandFoot("");
  return shell(body, fonts, css);
}

function coverHtml(fonts: Map<string, Buffer> | null): string {
  const css = `
.kicker{margin-top:44px;font:500 18px/1 "JetBrains Mono",monospace;letter-spacing:.16em;color:${C.gold}}
h1{margin-top:18px;font:800 76px/1.02 "Plus Jakarta Sans",sans-serif;letter-spacing:-.025em;max-width:1300px}
h1 em{font-style:normal;color:${C.lav}}
.grid{margin-top:56px;display:grid;grid-template-columns:repeat(4,1fr);gap:16px}
.tile{background:${C.panel};border:1.5px solid ${C.line};border-radius:16px;padding:24px 22px}
.tile .n{font:500 14px/1 "JetBrains Mono",monospace;color:${C.violet};letter-spacing:.08em}
.tile h3{margin-top:12px;font:700 26px/1.15 "Plus Jakarta Sans",sans-serif}
.tile p{margin-top:8px;font-size:18px;color:${C.muted}}
.stack{margin-top:34px;display:flex;flex-wrap:wrap;gap:8px}
.stack span{font:500 15px/1 "JetBrains Mono",monospace;color:${C.lav};border:1px solid ${C.line};border-radius:999px;padding:8px 12px}
`;
  const body =
    `<div class="top"><span><b>NOVARA OS</b> · SYSTEM BREAKDOWN</span><span>A THREAD</span></div>` +
    `<div class="kicker">FIRST CLICK → THE CLEANER'S 1099</div>` +
    `<h1>How we run a cleaning company <em>on software</em></h1>` +
    `<div class="grid">${AREAS.map(
      (a, i) => `<div class="tile"><div class="n">${String(i + 1).padStart(2, "0")}</div><h3>${esc(a.title)}</h3><p>${esc(a.line)}</p></div>`,
    ).join("")}</div>` +
    `<div class="stack">${STACK.map((s) => `<span>${esc(s)}</span>`).join("")}</div>` +
    brandFoot("");
  return shell(body, fonts, css);
}

function statsHtml(fonts: Map<string, Buffer> | null): string {
  const css = `
h1{margin-top:34px;font:800 66px/1.02 "Plus Jakarta Sans",sans-serif;letter-spacing:-.02em}
.pitch{margin-top:16px;font-size:26px;color:${C.muted}}
.stats{margin-top:52px;display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.stat{background:${C.panel};border:1.5px solid ${C.line};border-radius:18px;padding:30px 30px}
.stat .n{font:800 64px/1 "Plus Jakarta Sans",sans-serif;letter-spacing:-.02em;background:linear-gradient(90deg,#fff,${C.lav});-webkit-background-clip:text;color:transparent}
.stat p{margin-top:10px;font-size:21px;color:${C.muted}}
.ints{margin-top:40px}
.ints .rowlabel{font:500 15px/1 "JetBrains Mono",monospace;letter-spacing:.16em;color:${C.gold};margin-bottom:14px}
.ints .list{display:grid;grid-template-columns:repeat(6,1fr);gap:10px}
.ints .list span{font:500 16px/1 "JetBrains Mono",monospace;color:${C.lav};border:1px solid ${C.line};border-radius:999px;padding:11px 12px;text-align:center}
`;
  const body =
    `<div class="top"><span><b>NOVARA OS</b> · SYSTEM BREAKDOWN</span><span>BY THE NUMBERS</span></div>` +
    `<h1>One cleaning company. One platform.</h1><p class="pitch">Everything below runs Novara today.</p>` +
    `<div class="stats">${STATS.map((s) => `<div class="stat"><div class="n">${esc(s.n)}</div><p>${esc(s.label)}</p></div>`).join("")}</div>` +
    `<div class="ints"><div class="rowlabel">WIRED INTO</div><div class="list">${INTEGRATIONS.map((i) => `<span>${esc(i)}</span>`).join("")}</div></div>` +
    brandFoot("");
  return shell(body, fonts, css);
}

// ─── Render ────────────────────────────────────────────────────────────────

function loadFonts(): Map<string, Buffer> | null {
  const dir = process.env.DOCS_CAPTURE_FONT_DIR;
  if (!dir) return null;
  const files = [
    ...[400, 500, 600, 700, 800].map((w) => `inter-latin-${w}-normal.woff2`),
    ...[500, 600, 700, 800].map((w) => `plus-jakarta-sans-latin-${w}-normal.woff2`),
    ...[400, 500, 700].map((w) => `jetbrains-mono-latin-${w}-normal.woff2`),
  ];
  const fonts = new Map<string, Buffer>();
  for (const file of files) {
    const family = file.replace(/-latin-.*/, "");
    const hit = [join(dir, file), join(dir, "node_modules/@fontsource", family, "files", file)].find((p) => existsSync(p));
    if (hit) fonts.set(file, readFileSync(hit));
  }
  return fonts.size ? fonts : null;
}

async function main() {
  const fonts = loadFonts();
  if (!fonts) console.warn("No DOCS_CAPTURE_FONT_DIR — rendering with system fonts.");
  const guide = await loadGuideImage(resolve(ROOT, "public/cleaner/guide-pdfs/day-to-day-job-operations.pdf"));
  const logo = encodePng(crop(guide, 140, 82, 164, 164));

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });

  const cards: Array<{ file: string; html: string; title: string; post: string }> = [
    {
      file: "00-cover.png",
      html: coverHtml(fonts),
      title: "Cover",
      post: "We run a cleaning company on software we built ourselves. Here's the whole system, one piece at a time. 🧵",
    },
    ...SECTIONS.map((s, i) => ({
      file: `${String(i + 1).padStart(2, "0")}-${s.slug}.png`,
      html: sectionHtml(s, i, fonts),
      title: s.title,
      post: s.post,
    })),
    {
      file: `${String(SECTIONS.length + 1).padStart(2, "0")}-by-the-numbers.png`,
      html: statsHtml(fonts),
      title: "By the numbers",
      post: "All of it, by the numbers: 363k lines, 225 backend functions, 373 migrations, 118 pages, a contractor mobile app and 12 integrations. Built for one cleaning company. Running it today.",
    },
  ];

  const executablePath = process.env.DOCS_CAPTURE_CHROMIUM || undefined;
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  for (const card of cards) {
    const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 2 });
    await context.route(`${ASSET}**`, (route: Route) => {
      const name = route.request().url().slice(ASSET.length);
      if (name === "logo.png") return route.fulfill({ status: 200, contentType: "image/png", body: logo });
      const font = name.startsWith("fonts/") ? fonts?.get(name.slice(6)) : undefined;
      return font ? route.fulfill({ status: 200, contentType: "font/woff2", body: font }) : route.fulfill({ status: 404, body: "" });
    });
    const page = await context.newPage();
    await page.setContent(card.html, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    // A node whose text overflows its box would be cut off on the card.
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll(".node, .chip, .tile, .stat")]
        .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
        .map((el) => (el.textContent || "").slice(0, 40)),
    );
    const bottom = await page.evaluate(() => {
      const els = [...document.querySelectorAll(".rows, .around, .note, .grid, .stack, .stats, .ints")];
      return Math.max(0, ...els.map((e) => e.getBoundingClientRect().bottom));
    });
    await page.screenshot({ path: join(OUT, card.file), type: "png" });
    await context.close();
    const warn = [overflow.length ? `overflow: ${overflow.join(" | ")}` : "", bottom > SIZE.height - 110 ? `content reaches y=${Math.round(bottom)}` : ""]
      .filter(Boolean)
      .join("; ");
    console.log(`  ${card.file.padEnd(28)} ${warn || "ok"}`);
  }
  await browser.close();

  const readme = [
    "# Architecture cards for X",
    "",
    "One image per area of the Novara platform breakdown, plus a cover and a by-the-numbers card.",
    "Each is 1600×900 (X's in-feed size), rendered at 2× for sharp text. Post them in order as a thread.",
    "",
    "Every node names the real edge function, table or route behind it. Regenerate with",
    "`npx tsx scripts/marketing/architecture-cards.ts` after changing anything in that file.",
    "",
    "| Image | Area | Draft post |",
    "| --- | --- | --- |",
    ...cards.map((c) => `| \`${c.file}\` | ${c.title} | ${c.post.replace(/\|/g, "\\|")} |`),
    "",
    "## Where the numbers come from",
    "",
    "Measured from this repository on the day the cards were made:",
    "",
    "- **363k lines of code** — TypeScript and SQL tracked in git under `src`, `supabase`, `contractor-app`, `mobile` and `scripts`.",
    "- **225 backend functions** — folders in `supabase/functions`, not counting `_shared`.",
    "- **373 database migrations** — files in `supabase/migrations`.",
    "- **118 web pages** — `page.tsx` files under `src/app`.",
    "- **12 integrations** — services the edge functions call: " + INTEGRATIONS.join(", ") + ".",
    "",
    "The pricing card notes that the demand layer is built but switched off today; keep that",
    "footnote if you crop the image.",
    "",
  ].join("\n");
  writeFileSync(join(OUT, "README.md"), readme);
  console.log(`\nDone → ${OUT}`);
}

main();
