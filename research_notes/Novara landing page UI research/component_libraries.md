# React/Tailwind UI component libraries for landing-page + agentic visuals (Nov 2026)

> **Research-environment caveat (read first):** In this session, WebFetch could not reach any library docs host (magicui.design, ui.aceternity.com, ai-sdk.dev, elements.ai-sdk.dev, ui.elevenlabs.io, 21st.dev all failed DNS resolution because they are outside the session's allowed network), and the GitHub API was not enabled for these repos. So: (a) stars and last-commit dates were **not** collected; (b) facts were verified through the npm registry (`npm view` / `npm pack`, which worked), WebSearch snippets (mostly secondary sources), and the project's own `package.json` / `components.json`. To confirm the catalog, allow the doc hosts in network settings and re-check. Where this note names components from the researcher's prior knowledge (training data up to mid-2026) and not from a source fetched in this session, it says so under **Inferences** and does not list them as cited facts.

> **Project baseline (verified locally, `/home/user/novaracleaningui/package.json` and `components.json`):** next ^14.2.20, react ^18.3.1, tailwindcss ^3.4.17, @heroui/react ^2.8.10, framer-motion ^12.23.24, motion ^13.1.1, lucide-react ^1.35.0, @remixicon/react ^4.9.0. No three / ogl / gsap / cobe / ai / @ai-sdk/react installed. `components.json` already registers the `@magicui` registry (`https://magicui.design/r/{name}`) and `@coss` (`https://coss.com/ui/r/{name}.json`); `rsc: false`, `cssVariables: true`, Tailwind config at `tailwind.config.ts`. **React 18 + Tailwind v3 is the binding constraint for everything below.**

## Q1. Library-by-library catalog: which named components map to the landing-page needs?

### Takeaway
Magic UI, Aceternity, and React Bits cover most hero backgrounds, bento grids, beams, globes, marquees, and counters. Vercel AI Elements and ElevenLabs UI are the only purpose-built "agentic" sets (chat, reasoning, tool calls, voice orb, waveform). Origin UI/coss, Tailark, Launch UI, shadcnblocks, and shadcn blocks cover the plain sections: pricing, FAQ, forms, steppers, and calendars. **Most of these registries now target Tailwind v4 and React 19 by default.** Copy-paste code usually works on a v3/React 18 stack, but class names such as `size-*`, `bg-linear-*`, and `@theme` CSS variables will need hand back-porting.

### Cited Findings

**Vercel AI Elements (agentic chat/reasoning UI)**
- The `ai-elements` npm CLI is at v1.9.1, Apache-2.0, last modified 2026-10-14. — [npm: ai-elements](https://www.npmjs.com/package/ai-elements)
- **Deprecation notice (from the package README, read in this session via `npm pack`):** "AI Elements is moving to shadcn/ui. This project will be deprecated at the end of November 2026 and replaced by AI Elements from shadcn/ui (https://ui.shadcn.com/docs/ai-elements). New projects should use the shadcn/ui version once it's available." — [npm: ai-elements README](https://www.npmjs.com/package/ai-elements)
- Install: `npx ai-elements@latest add <name>` (e.g. `message`, `conversation`, `code-block`), or `npx shadcn@latest add https://elements.ai-sdk.dev/api/registry/<name>.json` (all components: `.../registry/all.json`). Prerequisites: Node 18+, a Next.js project with the AI SDK installed, shadcn/ui initialized, and Tailwind in **CSS-variables mode only**. — [npm: ai-elements README](https://www.npmjs.com/package/ai-elements)
- The README describes it as "components specifically designed for AI applications, including conversations, messages, code blocks, reasoning displays". — [npm: ai-elements README](https://www.npmjs.com/package/ai-elements)
- The **Chain of Thought** component shows reasoning steps with complete/active/pending status, search-result badges, and images, inside a collapsible Radix-based UI. Subparts: ChainOfThoughtSearchResults, ChainOfThoughtSearchResult, ChainOfThoughtContent, ChainOfThoughtImage. Install: `npx ai-elements@latest add chain-of-thought`. — [elements.ai-sdk.dev/components/chain-of-thought](https://elements.ai-sdk.dev/components/chain-of-thought) (via search snippet)
- **Reasoning** (a collapsible "thinking" display) and **Tool** (tool invocation with input/output/status) are separate components. — [elements.ai-sdk.dev](https://elements.ai-sdk.dev/components/chain-of-thought.md) (via search snippet); [skills.lc AI Elements listing](https://www.skills.lc/vercel-labs/vercel-plugin/vercel-labs-vercel-plugin-skills-ai-elements-skill-md)
- A third-party listing says AI Elements requires React 19 and Tailwind CSS 4 (unverified against official docs). — [skills.sh ai-sdk-elements](https://www.skills.sh/site/smithery.ai/ai-sdk-elements)
- The streaming markdown renderer behind `Response` / `MessageResponse` is `streamdown` v2.7.1 (Apache-2.0). Its peer deps are `react ^18 || ^19`, so this dependency is React-18-compatible. — [npm: streamdown](https://www.npmjs.com/package/streamdown)

**ElevenLabs UI (voice/agent visuals)**
- A shadcn-based registry of "components specifically designed for agent & audio applications". It includes **Orb, Waveform, Live Waveform, Bar Visualizer, Voice Button, Voice Picker**, MIT-licensed. — [21st.dev ElevenLabs UI listing](https://21st.dev/@ElevenLabs/library/elevenlabs-ui) (via search snippet); [shadcn.io awesome: elevenlabs-ui](https://shadcn.io/awesome/item/elevenlabs-ui)
- Install: `npx @elevenlabs/cli@latest components add orb`, or `npx shadcn@latest add https://ui.elevenlabs.io/r/orb.json`. Prerequisites: Node 18+, shadcn/ui initialized, Tailwind configured. — same sources
- Sources disagree on the component count: 10 in a 21st.dev crawl, 28 in other listings. — [21st.dev](https://21st.dev/@ElevenLabs-crawled/library/elevenlabs-ui); [gittrend](https://gittrend.io/repo/elevenlabs/ui)
- `@elevenlabs/cli` v1.9.0 was updated 2026-11-04. `@elevenlabs/react` (conversational agent SDK) v1.21.1 is MIT with peer `react >=16.8.0`. — [npm: @elevenlabs/cli](https://www.npmjs.com/package/@elevenlabs/cli); [npm: @elevenlabs/react](https://www.npmjs.com/package/@elevenlabs/react)

**Magic UI (already in use)**
- An aggregator lists about 62 components, including **Animated Beam, Bento Grid, Globe, Border Beam, Flickering Grid, Ripple, Retro Grid**. Install via `npx shadcn@latest add https://magicui.design/r/animated-beam`. The legacy `magicui-cli` (npm v0.1.6, last modified 2024-07) is stale. — [21st.dev Magic UI listing](https://21st.dev/@dillionverma/library/magic-ui) (via search snippet); [npm: magicui-cli](https://www.npmjs.com/package/magicui-cli)
- The project already resolves `@magicui/<name>` through components.json, so `npx shadcn@latest add @magicui/animated-beam` works. — local `components.json`
- `cobe` (the WebGL globe library behind Magic UI Globe) is v2.0.1, MIT. — [npm: cobe](https://www.npmjs.com/package/cobe)

**Aceternity UI**
- Publishes a shadcn registry. One listing says 262 components are installable via the shadcn CLI, using the `@aceternity` namespace in components.json, e.g. `npx shadcn@latest add @aceternity/background-beams`. — [skills.sh aceternity-ui](https://skills.sh/nguyenvanchiens/my-skills/aceternity-ui); [21st.dev aceternity](https://21st.dev/@manuarora700/library/aceternity-ui)
- Includes **Aurora Background**, **Timeline** (animated timeline), and **Compare** (before/after comparison slider). — [skills.sh aceternity-ui](https://skills.sh/nguyenvanchiens/my-skills/aceternity-ui); [21st.dev Aurora Background](https://21st.dev/@manuarora700/components/aurora-background.md)
- Installing from 21st.dev mirrors requires an `API_KEY_21ST`, and free accounts get a limited number of installs per day. Prefer the official `@aceternity` registry. — [21st.dev aceternity](https://21st.dev/@manuarora700/library/aceternity-ui) (via search snippet)

**React Bits**
- License is **MIT + Commons Clause**. Per the maintainer, using it in a production app is allowed. Repackaging components into another UI library, or selling templates built mainly from React Bits, is not. — [GitHub discussion #1101](https://github.com/DavidHDev/react-bits/discussions/1101); [pkgpulse guide](https://www.pkgpulse.com/guides/react-bits-animated-components-2026)
- Mostly CSS animation. GSAP, Three.js, or Matter.js are pulled in only for components that need them, and the wrapper lists `ogl` and `matter-js` among its deps. — [pkgpulse guide](https://www.pkgpulse.com/guides/react-bits-animated-components-2026); [PyPI reflex-reactbits](https://pypi.org/project/reflex-reactbits/0.2.2/)
- Dependency licenses: `ogl` v1.0.11 is Unlicense; `three` v0.187.0 is MIT; `gsap` v3.15.1 uses GSAP's "Standard 'no charge' license" (not OSI MIT); `@react-three/fiber` v9.8.2 is MIT. — [npm: ogl](https://www.npmjs.com/package/ogl); [npm: three](https://www.npmjs.com/package/three); [npm: gsap](https://www.npmjs.com/package/gsap); [npm: @react-three/fiber](https://www.npmjs.com/package/@react-three/fiber)

**Motion Primitives**
- 39 components, including **Accordion, Animated Number, Dock, Morphing Dialog, Spotlight**, and text effects, built on Motion and Tailwind. A 21st.dev blog says the repo last shipped in March (secondhand claim). — [21st.dev Motion Primitives](https://21st.dev/@ibelick/library/motion-primitives); [21st.dev blog](https://21st.dev/blog/motion-primitives-alternatives)
- The `motion-primitives` npm package is v0.1.0, MIT. Components are normally copied from the site or the shadcn registry rather than npm-installed. — [npm: motion-primitives](https://www.npmjs.com/package/motion-primitives)

**Cult UI**
- "150+ free shadcn/ui components, built with Tailwind CSS and Motion. MIT licensed", including Floating Panel, Dock, and Expandable. — [GitHub nolly-studio/cult-ui](https://github.com/nolly-studio/cult-ui)

**Kibo UI**
- Focuses on complex stateful components: Gantt, Kanban, code editor, AI chat elements, color picker, file dropzone. Sources disagree on counts (about 41 components, 6 blocks, 1,101 patterns vs. 40+, 30+, 1,000+). — [designrevision Kibo alternatives](https://designrevision.com/alternatives/kibo-ui); [shadcndeck](https://www.shadcndeck.com/blog/shadcn-component-libraries)
- npm `kibo-ui` is v1.1.5, last modified 2026-04-11. — [npm: kibo-ui](https://www.npmjs.com/package/kibo-ui)

**Animate UI**
- Animated versions of shadcn/Radix primitives (accordion, checkbox, dialog, sheet, etc.) using Motion, keeping Radix accessibility. Also offers animated icons. — [21st.dev blog](https://21st.dev/blog/motion-primitives-alternatives); [untitledui vibe-coding libraries](https://www.untitledui.com/blog/vibe-coding-libraries)

**Origin UI → coss**
- Origin UI is now **COSS**, compatible with shadcn projects, described as powered by Tailwind CSS v4. — [shadcn.io origin-space/originui](https://www.shadcn.io/template/origin-space-originui) (third-party listing)
- The project already has the `@coss` registry configured: `https://coss.com/ui/r/{name}.json`. — local `components.json`

**Tailark / Launch UI / Skiper UI / Eldora UI / shadcnblocks**
- **Tailark**: a shadcn registry of marketing blocks (hero, pricing, etc.), installed by URL via the shadcn CLI. One source says MIT and Tailwind v4; another says 300+ blocks on a freemium model. — [adminlte block libraries](https://adminlte.io/blog/shadcn-ui-block-libraries/); [uicentral Tailark](https://uicentral.fyi/copy-paste-kits/tailark); [allshadcn Tailark](https://allshadcn.com/blocks/tailark-blocks/)
- **Launch UI**: an MIT landing-page kit (shadcn + Tailwind). v2.0 supports Tailwind v4, React 19, and Next.js 16, and **Tailwind 3 support is maintained on a separate branch**. — [GitHub launch-ui/launch-ui](https://github.com/launch-ui/launch-ui); [launchuicomponents.com](https://www.launchuicomponents.com/)
- **Skiper UI**: "un-common production-ready blocks for shadcn/ui", installed as `npx shadcn add @skiper-ui/skiper40`, freemium. — [adminlte landing templates](https://adminlte.io/blog/shadcn-ui-landing-page-templates/)
- **Eldora UI**: free, open-source animated components (React, TS, Tailwind, Framer Motion). Tailwind v4 status not confirmed, and it may be confused with "Velora UI" in directories. — [adminlte block libraries](https://adminlte.io/blog/shadcn-ui-block-libraries/)
- **shadcnblocks.com**: named as a block library in roundups. No fetched detail. — [adminlte block libraries](https://adminlte.io/blog/shadcn-ui-block-libraries/)

**Tremor**
- `@tremor/react` was last published as v3.18.7 on 2025-01-13, with peer `react ^18.0.0`. A `4.0.0-beta-tremor-v4.4` dates from 2024-12. The npm package is effectively frozen, and Tremor's newer distribution is copy-paste "Tremor Raw" (per prior knowledge; not verified this session). — [npm: @tremor/react](https://www.npmjs.com/package/@tremor/react)

**Platform packages (compatibility-critical)**
- **HeroUI v3 (`@heroui/react` 3.2.7, 2026-10-28) requires `tailwindcss >=4.0.0` and `react >=19`** (peer deps), and is built on react-aria-components. The project's **2.8.10** (peers: react >=18, framer-motion >=11.5.6) is the last Tailwind-v3-compatible line. Do not upgrade HeroUI casually. — [npm: @heroui/react](https://www.npmjs.com/package/@heroui/react)
- `shadcn` CLI is v4.23.0, MIT, updated 2026-10-27. — [npm: shadcn](https://www.npmjs.com/package/shadcn)
- shadcn/ui components are updated for Tailwind v4 and React 19 (forwardRef removed). Existing v3/React 18 projects keep working, and only *new* projects default to v4/React 19. — [ui.shadcn.com/docs/tailwind-v4](https://ui.shadcn.com/docs/tailwind-v4); [v3.shadcn.com/docs/tailwind-v4](https://v3.shadcn.com/docs/tailwind-v4)
- `motion` and `framer-motion` are both v14.9.1 (MIT, 2026-11-04). The project pins framer-motion ^12 and motion ^13, two majors behind. — [npm: motion](https://www.npmjs.com/package/motion); [npm: framer-motion](https://www.npmjs.com/package/framer-motion)
- Single-purpose helpers usable instead of library code: `@number-flow/react` 0.6.2 (MIT, React 18/19) for animated counters, and `react-compare-slider` 4.0.0 (MIT, React >=16.8) for before/after sliders. — [npm: @number-flow/react](https://www.npmjs.com/package/@number-flow/react); [npm: react-compare-slider](https://www.npmjs.com/package/react-compare-slider)

### Inferences
- **Need → component map.** These names come from the researcher's prior knowledge; the docs could not be fetched to confirm them. Verify each at the listed site before installing.
  - *Hero backgrounds*: Magic UI `dot-pattern`, `grid-pattern`, `animated-grid-pattern`, `flickering-grid`, `retro-grid`, `ripple`, `meteors`, `warp-background`, `light-rays`, `particles` (already installed). Aceternity `aurora-background` (cited), `background-beams` (cited), `background-beams-with-collision`, `spotlight`, `lamp`, `wavy-background`, `sparkles` (tsparticles). React Bits backgrounds `Aurora`/`Particles`/`Orb`/`Threads` (ogl), `Silk`/`Beams` (three), `Dot Grid` (gsap), `Squares`, `Light Rays`.
  - *Bento grids*: Magic UI `bento-grid` (cited), Aceternity `bento-grid`, React Bits `MagicBento` (gsap).
  - *Integration/beam diagrams*: Magic UI `animated-beam` (cited), `orbiting-circles`, `icon-cloud`. Aceternity `tracing-beam`.
  - *Notification feeds*: Magic UI `animated-list` (classic "agent dispatched cleaner" feed), React Bits `AnimatedList`.
  - *Terminal/typing*: Magic UI `terminal`, `typing-animation`, `text-animate`, `word-rotate`, `aurora-text`. Aceternity `typewriter-effect`, `text-generate-effect`. React Bits `TextType`, `DecryptedText`.
  - *Voice/audio*: ElevenLabs `orb`, `waveform`, `live-waveform`, `bar-visualizer`, `voice-button` (cited). React Bits `Orb` (ogl) as a lighter non-ElevenLabs orb.
  - *Chat/agent UI*: AI Elements `conversation`, `message`, `response`, `reasoning`, `chain-of-thought`, `tool`, `task`, `prompt-input`, `suggestion`, `loader`/`shimmer`, `sources` (first several cited). ElevenLabs `conversation`, `message`, `response`, `shimmering-text`.
  - *Before/after*: Aceternity `compare` (cited), or the `react-compare-slider` npm package (cited, lighter, better keyboard a11y).
  - *Pricing, FAQ, testimonials*: Tailark, Launch UI, and shadcnblocks pricing/FAQ/testimonial blocks. shadcn `accordion` + Animate UI accordion. Magic UI `marquee` (installed) + `tweet-card` / `avatar-circles`. Aceternity `infinite-moving-cards`, `animated-testimonials`.
  - *Stepper/timeline*: Aceternity `timeline` (cited), React Bits `Stepper`, Origin UI/coss stepper and timeline components.
  - *Counters*: Magic UI `number-ticker` (installed), Motion Primitives `animated-number` (cited), `@number-flow/react` (cited).
  - *Maps/globes*: Magic UI `globe` (cobe, cited), Aceternity `world-map` (dotted-map SVG) and `github-globe` (three-globe + R3F, heavy).
  - *Sticky CTA, multi-step forms, calendars*: no library has a dedicated "sticky CTA". Build it from a shadcn button + Motion. Use the shadcn `calendar` (react-day-picker) and Origin UI/coss date-picker and input variants. Multi-step forms come from shadcn form + stepper, or HeroUI 2.x `DatePicker`/`Calendar`, which are already available on the v3-compatible line.
- **Most compatible picks for this stack (React 18, Tailwind v3)**: Magic UI and Aceternity code generally back-ports. AI Elements and ElevenLabs UI are the riskiest, since they likely assume React 19 and Tailwind v4. For a *marketing* page, consider recreating their look (orb, chat bubbles, reasoning steps) with existing Magic UI + Motion, rather than taking on the AI SDK.
- **AI Elements timing**: given the end-of-November-2026 deprecation, any AI Elements code should come from the shadcn/ui-hosted version, or be vendored and frozen.
- **Heavy dependencies to watch**: three/R3F (Aceternity globe, React Bits Silk/Beams, possibly the ElevenLabs Orb), ogl (React Bits Aurora/Orb/Particles), gsap (React Bits Dot Grid/SplitText/MagicBento), tsparticles (Aceternity Sparkles), cobe (small, around 5 KB per its own claims, not verified this session).

### Gaps
- GitHub stars and last-commit dates for every library: not collected, because GitHub API access was not enabled and the github.com pages were not fetched.
- Official, current component indexes for Magic UI, Aceternity, AI Elements, ElevenLabs UI, React Bits, Cult UI, Kibo, Animate UI, Skiper, Eldora, Tailark, and shadcnblocks could not be fetched because the hosts are blocked. The names in Inferences need verification.
- Magic UI Pro templates (agent/startup/SaaS templates and pricing): nothing found this session.
- 21st.dev registry specifics beyond the API-key and rate-limit note.
- Whether ElevenLabs UI and AI Elements officially support React 18 / Tailwind v3, and whether ElevenLabs Orb depends on three.js: unconfirmed.
- Official Tailwind v3 vs v4 status for Magic UI, Aceternity, React Bits, and Eldora: unconfirmed. Launch UI is the only one with a confirmed v3 branch.
- Whether the shadcn/ui-hosted AI Elements (ui.shadcn.com/docs/ai-elements) is live yet: the README says "once it's available".

## Q2. License, install method, dependencies, Tailwind compatibility, bundle

### Takeaway
Almost everything is a copy-in source registry installed with `npx shadcn@latest add <url or @namespace/name>`, so bundle cost comes from the transitive deps (three, ogl, gsap, R3F), not from the library. The licenses to watch are React Bits (MIT + Commons Clause), GSAP's no-charge license, and the paid tiers of Aceternity Pro, Magic UI Pro, Tailark, and Skiper. On Tailwind, HeroUI v3 and most new registry output require v4.

### Cited Findings
- MIT: Cult UI ([GitHub](https://github.com/nolly-studio/cult-ui)), ElevenLabs UI ([shadcn.io](https://shadcn.io/awesome/item/elevenlabs-ui)), Launch UI ([GitHub](https://github.com/launch-ui/launch-ui)), motion-primitives ([npm](https://www.npmjs.com/package/motion-primitives)), shadcn CLI ([npm](https://www.npmjs.com/package/shadcn)).
- Apache-2.0: AI Elements CLI ([npm](https://www.npmjs.com/package/ai-elements)), streamdown ([npm](https://www.npmjs.com/package/streamdown)), HeroUI ([npm](https://www.npmjs.com/package/@heroui/react)), Tremor ([npm](https://www.npmjs.com/package/@tremor/react)).
- MIT + Commons Clause: React Bits. — [GitHub discussion](https://github.com/DavidHDev/react-bits/discussions/1101)
- GSAP: "Standard 'no charge' license". — [npm: gsap](https://www.npmjs.com/package/gsap)
- Freemium/paid tiers: Tailark ([uicentral](https://uicentral.fyi/copy-paste-kits/tailark)), Skiper UI ([adminlte](https://adminlte.io/blog/shadcn-ui-landing-page-templates/)). The 21st.dev installs are rate-limited for free accounts ([21st.dev](https://21st.dev/@manuarora700/library/aceternity-ui)).
- Tailwind v4 required or targeted: HeroUI v3 (peer `tailwindcss >=4.0.0`, [npm](https://www.npmjs.com/package/@heroui/react)), coss/Origin ([shadcn.io](https://www.shadcn.io/template/origin-space-originui)), Tailark ([adminlte](https://adminlte.io/blog/shadcn-ui-block-libraries/)), Launch UI v2 with a v3 branch ([GitHub](https://github.com/launch-ui/launch-ui)), and new shadcn projects by default ([shadcn docs](https://ui.shadcn.com/docs/tailwind-v4)).
- Under npm, React 19 peer conflicts may need an install flag (`--legacy-peer-deps` / `--force`). pnpm and bun generally install cleanly. — [shadcn React 19 guide](https://ui.shadcn.com/react-19)
- A Three.js scene typically ships a rendering library of several hundred KB, plus models and textures. — [landerkit WebGL hero](https://landerkit.fr/en/blog/hero-3d-webgl-landing-page-conversion)

### Inferences
- The project already has `cssVariables: true`, which AI Elements requires.
- `rsc: false` in components.json means the shadcn CLI will not add `"use client"` automatically. Animated components will need it added by hand in the Next App Router.
- Keep framer-motion and motion on one major version to avoid shipping two copies of the motion runtime. Today they are on ^12 and ^13.

### Gaps
- Measured gzip sizes per component: none found (bundlephobia was not reachable).
- Aceternity Pro and Magic UI Pro pricing: not found.

## Q3. Performance and accessibility guidance (CWV, reduced motion, lazy loading)

### Takeaway
Keep the LCP element a server-rendered text headline or a `next/image` with priority. Load WebGL/canvas/particle layers after first paint, client-only through `next/dynamic` with `ssr:false`, with a static poster fallback. Freeze them for `prefers-reduced-motion`, and don't fade the LCP element in from opacity 0. **No web.dev or Vercel primary pages could be fetched this session**, so these findings come from secondary sources.

### Cited Findings
- A hero that starts fully transparent delays LCP until the fade-in completes. Starting at slight opacity fixes it. A canvas particle loop competed with the LCP element for the main thread, and deferring it helped. — [savvy.co.il hero animation LCP](https://savvy.co.il/en/blog/wordpress-speed/hero-animation-lcp-optimization/)
- Load the WebGL scene after the headline and CTA paint, so LCP is measured on text. Keep a static fallback image sized to avoid layout shift. — [landerkit](https://landerkit.fr/en/blog/hero-3d-webgl-landing-page-conversion); [shadcnspace animated hero guide](https://shadcnspace.com/blog/how-to-build-animated-hero-section)
- Under `prefers-reduced-motion: reduce`, skip pointer tracking and draw a single still frame. Consider data-saver and device-memory signals for freezing the scene. Canvas content is invisible to screen readers and crawlers, and text over it must keep 4.5:1 contrast. — [shadcnspace guide](https://shadcnspace.com/blog/how-to-build-animated-hero-section)
- Images drawn into canvas don't count toward LCP. Moving hero content into canvas just to game the metric is discouraged; use a poster image that swaps to canvas once drawn. — [core-web-vitals skill (secondary)](https://smithery.ai/skills/tech-leads-club/core-web-vitals)
- For INP, break long tasks up and yield (`scheduler.yield()`, setTimeout, rAF). Use `next/image` `priority` for the hero image and `dynamic(..., { ssr: false })` for heavy components. — [core-web-vitals skills (secondary)](https://kortix.com/marketplace/addyosmani--web-quality-skills/core-web-vitals); [DEV performance guide](https://dev.to/mahmoudz/frontend-performance-optimization-guide-3od6)
- Thresholds: LCP good is ≤2.5 s and INP good is ≤200 ms. One secondary source mis-states LCP as 200 ms. — [seobyrole CWV engineering](https://seobyrole.pages.dev/articles/core-web-vitals-engineering.html) (noted as unreliable on LCP)

### Inferences
- Practical rules for this page:
  1. One WebGL context at most above the fold. Prefer CSS/SVG backgrounds (Magic UI dot/grid patterns, Aceternity aurora) over ogl/three.
  2. Wrap Globe, Orb, and Particles in `next/dynamic({ ssr:false })` and mount them only when in view (IntersectionObserver).
  3. Use `useReducedMotion()` from motion (already installed) to render static frames, and pause Marquee/NumberTicker.
  4. Pause rAF loops when the tab is hidden or the element is offscreen.
  5. Never set `initial={{opacity:0}}` on the H1.
  6. Give canvases `aria-hidden` and keep real text in the DOM.

### Gaps
- Direct web.dev pages (Optimize LCP, Optimize INP, Animations guide) and Vercel/Next.js docs (lazy loading, `next/dynamic`, Speed Insights) could not be fetched or surfaced in search. Re-cite from web.dev/articles/optimize-lcp, web.dev/articles/optimize-inp, and nextjs.org/docs/app/guides/lazy-loading once those hosts are reachable.
- No measured CWV numbers for any specific library component were found.
