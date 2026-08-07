# Novara Pro — Expo contractor app

React Native (Expo SDK 57) rebuild of the contractor portal. It runs against
the **existing** Novara Supabase project (`sxdraeptzuamsgjcvfeg`) — same tables,
same RLS, same edge functions. The only backend change was teaching `send-push`
to speak Expo (see below); no schema or RLS change was needed.

This lives alongside the older Capacitor app in `/mobile`, which wraps the web
portal in a WebView. Both target bundle id `com.novaracleaning.contractor`, so
only one should be submitted to the stores.

## Run it

```bash
cd contractor-app
npm install
npx expo start
```

Scan the QR code with Expo Go. Sign in with any contractor's portal login —
push notifications are the only thing that needs a real build.

Supabase config comes from `expo.extra` in `app.json`, so it works with no
setup. Override per-environment with `EXPO_PUBLIC_SUPABASE_URL` /
`EXPO_PUBLIC_SUPABASE_ANON_KEY` (see `.env.example`).

## Link to EAS and build

Always run EAS commands from **this directory** (`contractor-app/`), not the
monorepo root. `eas.json` and `.eas/workflows/` live here.

```bash
npm i -g eas-cli
eas login
eas init            # links to the Expo project, writes extra.eas.projectId
eas build --profile preview --platform android   # installable APK
eas build --profile production --platform ios    # TestFlight
```

### EAS Workflows (Expo dashboard / GitHub)

Workflow YAML files are under `.eas/workflows/`:

| File | What it builds |
| --- | --- |
| `preview-android.yml` | Internal Android APK (`preview`) |
| `production-builds.yml` | Android + iOS store builds (`production`) |
| `development-builds.yml` | Dev-client builds (`development`) |

```bash
eas workflow:run .eas/workflows/preview-android.yml
```

In the Expo project’s **GitHub** settings, set the app directory / base
directory to `contractor-app` so the dashboard looks for
`contractor-app/.eas/workflows/` (not the repo root). After that, workflows
appear for the connected git ref (e.g. `main`).

`eas init` is also what enables push: `registerForPush` needs
`extra.eas.projectId` and no-ops without it.

## What it does

| Screen | File | Backend |
| --- | --- | --- |
| Sign in | `app/sign-in.tsx` | `signInWithPassword`, `send-auth-email` for reset |
| Jobs + offers | `app/index.tsx` | `job_assignments` + `bookings` |
| Offer detail | `app/offer/[token].tsx` | `accept-job-offer` |
| Job detail | `app/job/[id].tsx` | `job-check-in`, `cleaner-mark-complete` |
| Profile | `app/profile.tsx` | resolved cleaner row |

Auth resolution (`src/lib/cleaner-auth.ts`) calls the same
`resolve_or_link_cleaner_for_user` RPC the web portal uses, so an admin-invited
cleaner whose `cleaners.user_id` is still NULL gets linked by email on first
sign-in. Terminated/deactivated accounts are blocked; suspended ones keep
access, matching the web gate.

Writes go through edge functions rather than direct table updates —
`accept-job-offer` owns the double-booking check, pay locking and checklist
provisioning, and `cleaner-mark-complete` moves the booking to `pending_review`
for QC rather than finalizing it.

Push tokens upsert into `cleaner_device_tokens` on the existing `token`
conflict key. `send-push` picks its transport from the token's shape, so the
`ExponentPushToken[...]` this app registers goes out through Expo while any
legacy raw APNs/FCM tokens keep using the direct transports. Expo holds the
Apple/Google push credentials, so no `APNS_*` / `FCM_*` secret is needed for
this app — set `EXPO_ACCESS_TOKEN` only if you turn on Expo's "Enhanced
Security for Push Notifications".

## Not ported yet

Onboarding wizard, in-app photo capture (mark-complete hands off to the
existing photo upload web page), the job checklist (opens the web page), the
availability editor and earnings history. The web portal still covers all of
these.
