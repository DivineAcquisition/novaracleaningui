# AGENTS.md

## Cursor Cloud specific instructions

### What this repo is
- Primary product: a **Next.js 14 (App Router)** web app — `novara-cleaning-nextjs` — a home‑cleaning booking/dispatch platform. Source lives in `src/app` (routes) and `src/views` (screens).
- Backend is a **remote, hosted Supabase project** (project ref `sxdraeptzuamsgjcvfeg`). Connection config is committed in `.env` (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_PROJECT_ID`). There is **no local Supabase stack to start** — the dev server talks directly to the live project over HTTPS, so no Docker/`supabase start` is needed to run the web app.
- `supabase/functions/*` are Deno edge functions deployed to the remote project via CI (`.github/workflows/deploy-supabase-functions.yml`); you don't run them locally to develop the web app.
- `mobile/` is a Capacitor + Vite SPA wrapper of the cleaner portal (see `README_NATIVE_APP.md`). Native iOS/Android builds require Xcode/Android Studio and are **not** possible in this Linux VM.

### Running / building / linting
- Package manager is **npm** (`package-lock.json`). A stale `bun.lockb` is also present — ignore it; the README and scripts use npm.
- Dev server: `npm run dev` → http://localhost:3000 (this is the main way to develop; do not use `npm run build`/`npm start` for iterative dev).
- Lint: `npm run lint` (Next.js ESLint; currently exits clean with only `react-hooks/exhaustive-deps` warnings).
- Production build: `npm run build`.
- Mobile web layer only: `npm run mobile:dev` / `npm run mobile:build` (Vite). `cap`/native steps won't work here.

### Testing
- There is **no automated test framework/test script** in `package.json`. Verify changes via `npm run lint` and manual/browser testing against the running dev server.

### Gotchas
- The core booking flow entry point is `/book/sqft`; the homepage ZIP entry funnels into it. Reaching `/book/checkout` shows a real Supabase‑computed quote (good smoke test of backend connectivity).
- Because the app uses the live shared Supabase backend, actions that write data (bookings, auth, payments) hit production data — avoid submitting real payments/bookings when testing.
