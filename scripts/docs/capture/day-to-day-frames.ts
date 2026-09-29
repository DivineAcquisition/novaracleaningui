// ─── 16:9 video frames for the Day To Day Operations video ────────────────
//
// A phone screenshot on its own is a tall sliver in a 1920×1080 timeline. So
// each shot also becomes a ready-to-drop frame: the guide's wording on the
// left, the spotlighted phone screen on the right, in the guide's own palette
// and with its own artwork (logo, the four figures), so the video looks like
// the handout contractors were given in onboarding.
//
// Frames are plain HTML rendered by Playwright — nothing to install, and the
// copy comes from day-to-day-shots.ts so a wording change there changes the
// frame on the next run.

import { readFileSync } from "node:fs";
import type { Browser, Route } from "playwright";

import { crop, encodePng, type RgbImage } from "./guide-artwork";
import { GUIDE_LINES, STAGES, type DayCard, type DayShot, type Section, type StageKey } from "./day-to-day-shots";

export const FRAME = { width: 1920, height: 1080 };

const C = {
  purple: "#3D00B8",
  violet: "#5601FF",
  gold: "#C59D2C",
  ink: "#1E1638",
  muted: "#5E5878",
  page: "#FAF8FF",
  ring: "#8C86FF",
  hairline: "#E7E2F6",
  lav: "#EDE9FE",
  label: "#C4B5FD",
  green: "#057635",
  greenInk: "#0B5E2B",
  greenBg: "#F0FCF4",
};

const ASSET_HOST = "https://frame-assets.local/";
const FONT_HOST = "https://capture-fonts.local/";

// ─── Guide artwork crops (coordinates in the 3000×4296 guide image) ───────

const FIGURES: Record<StageKey, { y: number; width: number }> = {
  1: { y: 600, width: 214 },
  2: { y: 1318, width: 218 },
  3: { y: 2040, width: 300 },
  4: { y: 2758, width: 214 },
};
const FIGURE_X = 100;
const FIGURE_H = 470;
// The numbered circles and the dotted timeline sit just right of each figure.
const CIRCLE_X = 390;
// Covers the circle's soft shadow too; a smaller radius leaves a faint halo.
const CIRCLE_R = 104;
const DOTS = { x0: 376, x1: 404 };
// Figure 3's mop head crosses the dotted line; keep those rows.
const MOP_ROWS = { y0: 2422, y1: 2472 };

function eraseTimeline(img: RgbImage, stage: StageKey): RgbImage {
  const { y } = FIGURES[stage];
  const out = crop(img, FIGURE_X, y, FIGURES[stage].width, FIGURE_H);
  const bg = [0xfa, 0xf8, 0xff];
  const circleY = y + 124;
  for (let row = 0; row < out.height; row++) {
    const gy = y + row;
    for (let col = 0; col < out.width; col++) {
      const gx = FIGURE_X + col;
      const inCircle = (gx - CIRCLE_X) ** 2 + (gy - circleY) ** 2 <= CIRCLE_R ** 2;
      const inDots = gx >= DOTS.x0 && gx <= DOTS.x1 && !(stage === 3 && gy >= MOP_ROWS.y0 && gy <= MOP_ROWS.y1);
      if (inCircle || inDots) {
        const i = (row * out.width + col) * 3;
        out.data[i] = bg[0];
        out.data[i + 1] = bg[1];
        out.data[i + 2] = bg[2];
      }
    }
  }
  return out;
}

export interface FrameAssets {
  guide: Buffer;
  logo: Buffer;
  figures: Record<StageKey, Buffer>;
}

export function buildAssets(guide: RgbImage): FrameAssets {
  return {
    guide: encodePng(guide),
    logo: encodePng(crop(guide, 140, 82, 164, 164)),
    figures: {
      1: encodePng(eraseTimeline(guide, 1)),
      2: encodePng(eraseTimeline(guide, 2)),
      3: encodePng(eraseTimeline(guide, 3)),
      4: encodePng(eraseTimeline(guide, 4)),
    },
  };
}

// ─── HTML pieces ───────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A drawn check: the ✓ glyph falls back to whatever font has it and looks thin. */
const CHECK_SVG = (size: number) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.6l4.3 4.3L19 7.2"/></svg>`;

function fontFaces(fonts: Map<string, Buffer> | null): string {
  if (!fonts) return "";
  return [...fonts.keys()]
    .map((file) => {
      const m = file.match(/^(inter|plus-jakarta-sans)-latin-(\d+)-normal\.woff2$/);
      if (!m) return "";
      const family = m[1] === "inter" ? "Inter" : "Plus Jakarta Sans";
      return `@font-face{font-family:"${family}";font-weight:${m[2]};font-style:normal;src:url(${FONT_HOST}${file}) format("woff2")}`;
    })
    .join("");
}

function page(body: string, fonts: Map<string, Buffer> | null, extraCss = ""): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${fontFaces(fonts)}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${FRAME.width}px;height:${FRAME.height}px;overflow:hidden}
body{background:${C.page};color:${C.ink};font-family:"Inter",system-ui,sans-serif;position:relative;-webkit-font-smoothing:antialiased}
.jk{font-family:"Plus Jakarta Sans","Inter",sans-serif}
.topbar{position:absolute;left:0;right:0;top:0;height:78px;background:${C.purple};display:flex;align-items:center;gap:18px;padding:0 96px}
.topbar img{width:44px;height:44px;border-radius:11px}
.topbar .brand{color:${C.label};font-weight:700;font-size:17px;letter-spacing:.24em}
.topbar .sep{width:1px;height:26px;background:rgba(255,255,255,.25)}
.topbar .name{color:#fff;font-weight:700;font-size:22px}
.gold{position:absolute;left:0;right:0;top:78px;height:6px;background:${C.gold}}
.foot{position:absolute;left:96px;bottom:34px;font-size:16px;color:#8A84A3;letter-spacing:.01em}
${extraCss}
</style></head><body>${body}</body></html>`;
}

const topbar = () =>
  `<div class="topbar"><img src="${ASSET_HOST}logo.png" alt=""><span class="brand">NOVARACLEANING</span><span class="sep"></span><span class="name jk">${esc(GUIDE_LINES.title)}</span></div><div class="gold"></div>`;

function stageTimeline(current: StageKey | "done"): string {
  const items = ([1, 2, 3, 4] as StageKey[]).map((n) => {
    const state = current === "done" || n < current ? "past" : n === current ? "now" : "next";
    return `<div class="tl-item ${state}"><span class="tl-dot">${state === "past" ? "&#10003;" : n}</span><span class="tl-label">${esc(STAGES[n].title)}</span></div>`;
  });
  return `<div class="timeline">${items.join('<span class="tl-line"></span>')}</div>`;
}

const TIMELINE_CSS = `
.timeline{display:flex;align-items:center;gap:0}
.tl-item{display:flex;align-items:center;gap:12px}
.tl-dot{width:40px;height:40px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;border:3px solid ${C.ring};color:${C.ring};background:#fff}
.tl-item.now .tl-dot{background:${C.violet};border-color:${C.violet};color:#fff}
.tl-item.past .tl-dot{background:${C.lav};border-color:${C.lav};color:${C.violet}}
.tl-label{font-size:18px;font-weight:600;color:#8A84A3;white-space:nowrap}
.tl-item.now .tl-label{color:${C.purple};font-weight:800}
.tl-line{width:44px;height:0;border-top:3px dotted ${C.ring};margin:0 14px}
`;

function phone(file: string): string {
  return `<div class="glow"></div><div class="phone"><div class="screen"><img src="${ASSET_HOST}phone/${file}" alt=""></div></div>`;
}

const PHONE_CSS = `
.glow{position:absolute;left:1180px;top:170px;width:560px;height:820px;border-radius:50%;background:radial-gradient(closest-side,rgba(124,77,255,.20),rgba(124,77,255,0));filter:blur(8px)}
.phone{position:absolute;left:1248px;top:128px;width:432px;height:906px;border-radius:60px;background:#15121D;padding:15px;box-shadow:0 50px 90px -30px rgba(40,18,110,.55),0 0 0 2px #2B2635 inset}
.screen{width:100%;height:100%;border-radius:46px;overflow:hidden;background:#fff}
.screen img{display:block;width:100%;height:100%;object-fit:cover;object-position:top}
`;

function chip(section: Section): string {
  if (section === "complete") {
    return `<div class="chip"><span class="chip-dot green">${CHECK_SVG(34)}</span><span class="chip-title green-ink">JOB COMPLETE</span></div>`;
  }
  if (section === "remember" || section === "call") {
    const label = section === "remember" ? "EVERY SINGLE JOB" : "WHEN IN DOUBT";
    return `<div class="chip"><span class="chip-dot">&#9733;</span><span class="chip-title">${label}</span></div>`;
  }
  return `<div class="chip"><span class="chip-dot">${section}</span><span class="chip-meta">STOP ${section} OF 4</span><span class="chip-title">${esc(
    STAGES[section].title.toUpperCase(),
  )}</span></div>`;
}

function bulletList(stage: StageKey, current: string): string {
  const idx = STAGES[stage].bullets.indexOf(current);
  return `<ul class="bullets">${STAGES[stage].bullets
    .map((b, i) => {
      const state = i < idx ? "past" : i === idx ? "now" : "next";
      return `<li class="${state}"><span class="ring">${state === "past" ? "&#10003;" : ""}</span>${esc(b)}</li>`;
    })
    .join("")}</ul>`;
}

const SHOT_CSS = `
${PHONE_CSS}
${TIMELINE_CSS}
.left{position:absolute;left:96px;top:150px;width:1010px}
.chip{display:flex;align-items:center;gap:16px}
.chip-dot{width:62px;height:62px;border-radius:50%;background:${C.violet};color:#fff;display:flex;align-items:center;justify-content:center;font:800 28px/1 "Plus Jakarta Sans",sans-serif;box-shadow:0 10px 24px -10px rgba(86,1,255,.7)}
.chip-dot.green{background:${C.green};box-shadow:0 10px 24px -10px rgba(5,118,53,.6)}
.chip-meta{font-size:17px;font-weight:700;letter-spacing:.18em;color:#8A84A3}
.chip-title{font:800 30px/1 "Plus Jakarta Sans",sans-serif;color:${C.purple};letter-spacing:.02em}
.green-ink{color:${C.green}}
.headline{margin-top:40px;font:800 70px/1.08 "Plus Jakarta Sans",sans-serif;letter-spacing:-.015em;color:${C.ink};max-width:1000px}
.screenline{margin-top:30px;display:flex;align-items:flex-start;gap:14px;font-size:29px;line-height:1.35;color:${C.muted};max-width:960px}
.screenline b{flex:none;margin-top:5px;font-size:14px;letter-spacing:.16em;color:${C.violet};background:${C.lav};border-radius:8px;padding:6px 10px}
.bullets{list-style:none;position:absolute;left:96px;bottom:150px;display:flex;flex-direction:column;gap:14px}
.bullets li{display:flex;align-items:center;gap:16px;font-size:24px;color:#9A94B2}
.bullets li .ring{width:26px;height:26px;border-radius:50%;border:3px solid ${C.ring};flex:none;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800}
.bullets li.past{color:#6F6989}
.bullets li.past .ring{background:${C.lav};border-color:${C.lav};color:${C.violet}}
.bullets li.now{color:${C.ink};font-weight:700}
.bullets li.now .ring{background:${C.violet};border-color:${C.violet};box-shadow:0 0 0 6px rgba(86,1,255,.14)}
.tl{position:absolute;left:96px;bottom:72px}
.closing{position:absolute;left:96px;bottom:150px;width:1000px;border-radius:22px;padding:30px 36px}
.closing.purple{background:${C.purple};color:#fff}
.closing.purple p{color:${C.label}}
.closing.green{background:${C.greenBg};border:3px solid ${C.green};color:${C.greenInk}}
.closing h3{font:800 32px/1.2 "Plus Jakarta Sans",sans-serif}
.closing p{margin-top:10px;font-size:23px;color:${C.muted}}
`;

export function shotFrameHtml(shot: DayShot, phoneFile: string, fonts: Map<string, Buffer> | null): string {
  const section = shot.section;
  const isStage = typeof section === "number";
  const headline = section === "complete" ? GUIDE_LINES.complete.line : shot.bullet;
  // The closing lines come in pairs; the headline carries one, the panel the
  // other, so neither frame says the same sentence twice.
  const lower = isStage
    ? bulletList(section, shot.bullet)
    : section === "remember"
      ? `<div class="closing purple"><h3>${esc(GUIDE_LINES.remember.title)}</h3></div>`
      : section === "call"
        ? `<div class="closing green"><h3>${esc(GUIDE_LINES.call.line)}</h3></div>`
        : "";
  const body =
    topbar() +
    `<div class="left">${chip(section)}<h1 class="headline">${esc(headline)}</h1>` +
    `<p class="screenline"><b>ON SCREEN</b><span>${esc(shot.onScreen)}</span></p></div>` +
    lower +
    `<div class="tl">${stageTimeline(isStage ? section : "done")}</div>` +
    phone(phoneFile) +
    `<div class="foot" style="left:1064px;width:800px;text-align:center;bottom:12px;font-size:15px">Sample job — every name, address and amount is invented.</div>`;
  return page(body, fonts, SHOT_CSS);
}

// ─── Cards ─────────────────────────────────────────────────────────────────

const CARD_CSS = `
${TIMELINE_CSS}
.stage-fig{position:absolute;left:150px;top:230px;height:620px}
.stage-num{position:absolute;left:470px;top:250px;width:170px;height:170px;border-radius:50%;background:${C.violet};color:#fff;display:flex;align-items:center;justify-content:center;font:800 92px/1 "Plus Jakarta Sans",sans-serif;box-shadow:0 20px 40px -18px rgba(86,1,255,.8)}
.stage-dots{position:absolute;left:553px;top:440px;height:420px;border-left:6px dotted ${C.ring}}
.card{position:absolute;left:760px;top:196px;width:1064px;background:#fff;border:2px solid ${C.hairline};border-left:12px solid ${C.violet};border-radius:26px;padding:56px 64px;box-shadow:0 30px 60px -40px rgba(40,18,110,.35)}
.card .meta{font-size:19px;font-weight:700;letter-spacing:.2em;color:#8A84A3}
.card h1{margin-top:14px;font:800 84px/1 "Plus Jakarta Sans",sans-serif;color:${C.purple};letter-spacing:-.01em}
.card ul{list-style:none;margin-top:44px;display:flex;flex-direction:column;gap:26px}
.card li{display:flex;align-items:center;gap:22px;font-size:38px;color:${C.ink}}
.card li span{width:30px;height:30px;border-radius:50%;border:4px solid ${C.ring};flex:none}
.tl{position:absolute;left:0;right:0;bottom:64px;display:flex;justify-content:center}
.center{position:absolute;left:0;right:0;top:84px;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
`;

function stageCardHtml(stage: StageKey, fonts: Map<string, Buffer> | null): string {
  const s = STAGES[stage];
  const body =
    topbar() +
    `<img class="stage-fig" src="${ASSET_HOST}figure-${stage}.png" alt="">` +
    `<div class="stage-num">${stage}</div><div class="stage-dots"></div>` +
    `<div class="card"><div class="meta">STOP ${stage} OF 4</div><h1>${esc(s.title.toUpperCase())}</h1><ul>${s.bullets
      .map((b) => `<li><span></span>${esc(b)}</li>`)
      .join("")}</ul></div>` +
    `<div class="tl">${stageTimeline(stage)}</div>`;
  return page(body, fonts, CARD_CSS);
}

function titleCardHtml(fonts: Map<string, Buffer> | null): string {
  const figs = ([1, 2, 3, 4] as StageKey[])
    .map(
      (n) =>
        `<div class="t-stop"><img src="${ASSET_HOST}figure-${n}.png" alt=""><div class="t-num">${n}</div><div class="t-name">${esc(
          STAGES[n].title,
        )}</div></div>`,
    )
    .join('<div class="t-line"></div>');
  const css = `
.hero{position:absolute;left:0;right:0;top:0;height:420px;background:${C.purple};display:flex;align-items:center;gap:52px;padding:0 150px}
.hero img{width:170px;height:170px;border-radius:40px}
.hero .brand{color:${C.label};font-weight:700;font-size:30px;letter-spacing:.3em}
.hero h1{margin-top:14px;color:#fff;font:800 118px/1 "Plus Jakarta Sans",sans-serif;letter-spacing:-.02em}
.band{position:absolute;left:0;right:0;top:420px;height:12px;background:${C.gold}}
.intro{position:absolute;left:0;right:0;top:486px;text-align:center;font-size:36px;color:${C.muted}}
.stops{position:absolute;left:0;right:0;top:580px;display:flex;justify-content:center;align-items:flex-start;gap:0}
.t-stop{width:300px;display:flex;flex-direction:column;align-items:center}
.t-stop img{height:250px}
.t-num{margin-top:-6px;width:64px;height:64px;border-radius:50%;background:${C.violet};color:#fff;display:flex;align-items:center;justify-content:center;font:800 30px/1 "Plus Jakarta Sans",sans-serif}
.t-name{margin-top:16px;font:800 28px/1.1 "Plus Jakarta Sans",sans-serif;color:${C.purple};text-transform:uppercase;letter-spacing:.02em}
.t-line{width:60px;margin-top:278px;border-top:5px dotted ${C.ring}}
`;
  const body =
    `<div class="hero"><img src="${ASSET_HOST}logo.png" alt=""><div><div class="brand">NOVARACLEANING</div><h1>${esc(
      GUIDE_LINES.title,
    )}</h1></div></div><div class="band"></div>` +
    `<p class="intro">${esc(GUIDE_LINES.intro)}</p><div class="stops">${figs}</div>`;
  return page(body, fonts, css);
}

function guideCardHtml(fonts: Map<string, Buffer> | null): string {
  const css = `
.gl{position:absolute;left:150px;top:250px;width:900px}
.gl .meta{font-size:20px;font-weight:700;letter-spacing:.2em;color:#8A84A3}
.gl h1{margin-top:18px;font:800 84px/1.04 "Plus Jakarta Sans",sans-serif;color:${C.purple};letter-spacing:-.015em}
.gl p{margin-top:34px;font-size:34px;line-height:1.4;color:${C.ink}}
.gl .where{margin-top:40px;display:inline-flex;flex-direction:column;gap:8px;background:#fff;border:2px solid ${C.hairline};border-radius:14px;padding:18px 24px}
.gl .where span{font-size:15px;font-weight:700;letter-spacing:.18em;color:#8A84A3}
.gl .where b{font-size:21px;color:${C.purple};white-space:nowrap}
.sheet{position:absolute;left:1180px;top:122px;height:920px;border-radius:14px;box-shadow:0 50px 90px -40px rgba(40,18,110,.55),0 0 0 1px ${C.hairline}}
`;
  const body =
    topbar() +
    `<div class="gl"><div class="meta">THE ONE-PAGE GUIDE</div><h1>Four stops.<br>Every single job.</h1>` +
    `<p>You read this guide during onboarding. This video walks through each stop on the screens you'll actually use.</p>` +
    `<div class="where"><span>KEEP IT HANDY</span><b>contractor.novaracleaning.com/cleaner/guides/day-to-day-job-operations</b></div></div>` +
    `<img class="sheet" src="${ASSET_HOST}guide.png" alt="">`;
  return page(body, fonts, css);
}

function completeCardHtml(fonts: Map<string, Buffer> | null): string {
  const css = `
${CARD_CSS}
.check{width:190px;height:190px;border-radius:50%;background:${C.green};display:flex;align-items:center;justify-content:center;box-shadow:0 26px 50px -24px rgba(5,118,53,.7)}
.center h1{margin-top:44px;font:800 118px/1 "Plus Jakarta Sans",sans-serif;color:${C.green};letter-spacing:.01em}
.center p{margin-top:28px;font-size:44px;color:${C.ink}}
`;
  const body =
    topbar() +
    `<div class="center"><div class="check">${CHECK_SVG(112)}</div><h1>JOB COMPLETE</h1><p>${esc(GUIDE_LINES.complete.line)}</p></div>` +
    `<div class="tl">${stageTimeline("done")}</div>`;
  return page(body, fonts, css);
}

function rememberCardHtml(fonts: Map<string, Buffer> | null): string {
  const css = `
body{background:${C.purple}}
.center{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 160px}
.center img{width:120px;height:120px;border-radius:30px}
.words{margin-top:56px;display:flex;flex-direction:column;gap:18px}
.words div{font:800 88px/1.05 "Plus Jakarta Sans",sans-serif;color:#fff;letter-spacing:-.015em}
.rule{margin:56px auto 0;width:180px;height:8px;border-radius:4px;background:${C.gold}}
.center p{margin-top:44px;font-size:42px;color:${C.label}}
`;
  const [a, b, c] = GUIDE_LINES.remember.title.split(". ").map((s) => s.replace(/\.$/, ""));
  const body =
    `<div class="center"><img src="${ASSET_HOST}logo.png" alt=""><div class="words"><div>${esc(a)}.</div><div>${esc(b)}.</div><div>${esc(
      c,
    )}.</div></div><div class="rule"></div><p>${esc(GUIDE_LINES.remember.line)}</p></div>`;
  return page(body, fonts, css);
}

function callCardHtml(fonts: Map<string, Buffer> | null): string {
  const css = `
.box{position:absolute;left:220px;right:220px;top:300px;height:480px;border-radius:36px;background:${C.greenBg};border:5px solid ${C.green};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px}
.icon{width:120px;height:120px;border-radius:50%;background:${C.green};display:flex;align-items:center;justify-content:center}
.box h1{margin-top:40px;font:800 76px/1.08 "Plus Jakarta Sans",sans-serif;color:${C.greenInk};letter-spacing:-.01em}
.box p{margin-top:26px;font-size:40px;color:${C.ink}}
`;
  const phoneIcon = `<svg width="62" height="62" viewBox="0 0 24 24" fill="#fff"><path d="M21 16.42v3.536a1 1 0 0 1-.93.998c-.437.03-.794.046-1.07.046-8.837 0-16-7.163-16-16 0-.276.015-.633.046-1.07A1 1 0 0 1 4.044 3H7.58a.5.5 0 0 1 .498.45c.023.23.044.413.064.552A13.901 13.901 0 0 0 9.35 8.003c.095.2.033.439-.147.567l-2.158 1.542a13.047 13.047 0 0 0 6.844 6.844l1.54-2.154a.462.462 0 0 1 .573-.149 13.901 13.901 0 0 0 4 1.205c.139.02.322.042.55.064a.5.5 0 0 1 .449.498Z"/></svg>`;
  // One line per sentence, so "office." never ends up alone on a line.
  const title = GUIDE_LINES.call.title.split("? ").map(esc).join("?<br>");
  const body =
    topbar() +
    `<div class="box"><div class="icon">${phoneIcon}</div><h1>${title}</h1><p>${esc(GUIDE_LINES.call.line)}</p></div>`;
  return page(body, fonts, css);
}

export function cardFrameHtml(card: DayCard, fonts: Map<string, Buffer> | null): string {
  switch (card.card) {
    case "title":
      return titleCardHtml(fonts);
    case "guide":
      return guideCardHtml(fonts);
    case "stage":
      return stageCardHtml(card.stage!, fonts);
    case "complete":
      return completeCardHtml(fonts);
    case "remember":
      return rememberCardHtml(fonts);
    case "call":
      return callCardHtml(fonts);
  }
}

// ─── Contact sheet ─────────────────────────────────────────────────────────

/** Every frame as a numbered thumbnail on one image — the video at a glance. */
export function contactSheetHtml(frames: Array<{ file: string; label: string }>, fonts: Map<string, Buffer> | null): string {
  const cells = frames
    .map(
      (f) =>
        `<figure><img src="${ASSET_HOST}frames/${f.file}" alt=""><figcaption><b>${esc(f.file.slice(0, 2))}</b>${esc(f.label)}</figcaption></figure>`,
    )
    .join("");
  const css = `
html,body{width:auto;height:auto;overflow:visible}
body{padding:48px 56px 56px}
h1{font:800 34px/1 "Plus Jakarta Sans",sans-serif;color:${C.purple}}
.sub{margin-top:10px;font-size:18px;color:${C.muted}}
.grid{margin-top:32px;display:grid;grid-template-columns:repeat(6,280px);gap:22px 18px}
figure img{display:block;width:280px;height:158px;border-radius:8px;box-shadow:0 0 0 1px ${C.hairline},0 8px 18px -12px rgba(40,18,110,.45)}
figcaption{margin-top:8px;width:280px;font-size:13px;line-height:1.35;color:${C.ink};display:flex;gap:8px}
figcaption b{color:${C.violet};font-weight:800}
`;
  return page(
    `<h1>${esc(GUIDE_LINES.title)} — video storyboard</h1><p class="sub">${frames.length} frames, in order. Sample job; every name, address and amount is invented.</p><div class="grid">${cells}</div>`,
    fonts,
    css,
  );
}

// ─── Rendering ─────────────────────────────────────────────────────────────

export async function renderFrame(
  browser: Browser,
  html: string,
  outPath: string,
  assets: FrameAssets,
  dirs: { phone: string; frames: string },
  fonts: Map<string, Buffer> | null,
  fullPage = false,
): Promise<void> {
  const context = await browser.newContext({ viewport: FRAME, deviceScaleFactor: 1 });
  await context.route(`${ASSET_HOST}**`, (route: Route) => {
    const name = route.request().url().slice(ASSET_HOST.length);
    let body: Buffer | null = null;
    if (name === "guide.png") body = assets.guide;
    else if (name === "logo.png") body = assets.logo;
    else if (/^figure-[1-4]\.png$/.test(name)) body = assets.figures[Number(name[7]) as StageKey];
    else if (name.startsWith("phone/")) body = readFileSync(`${dirs.phone}/${name.slice(6)}`);
    else if (name.startsWith("frames/")) body = readFileSync(`${dirs.frames}/${name.slice(7)}`);
    return body ? route.fulfill({ status: 200, contentType: "image/png", body }) : route.fulfill({ status: 404, body: "" });
  });
  await context.route(`${FONT_HOST}**`, (route: Route) => {
    const body = fonts?.get(route.request().url().slice(FONT_HOST.length));
    return body ? route.fulfill({ status: 200, contentType: "font/woff2", body }) : route.fulfill({ status: 404, body: "" });
  });
  const pageHandle = await context.newPage();
  await pageHandle.setContent(html, { waitUntil: "load" });
  await pageHandle.evaluate(() => document.fonts.ready);
  await pageHandle.screenshot({ path: outPath, type: "png", fullPage });
  await context.close();
}
