# Novara Pro — Contractor Mobile App

The contractor portal ships as a **true native app** (iOS + Android) built
with Capacitor. The app bundles a static build of the cleaner portal
(`/mobile`) which reuses the existing `src/views/cleaner/*` screens and talks
to Supabase + edge functions directly over HTTPS. It is **not** a webview of
the live site.

- **App name:** Novara Pro
- **Bundle id:** `com.novaracleaning.contractor`
- **Web layer:** `mobile/` (Vite SPA) → builds to `mobile/dist`
- **Native shell:** Capacitor 7 (`capacitor.config.ts`, `webDir: mobile/dist`)

---

## Architecture

```
mobile/                     Vite SPA (the app's web layer)
  src/App.tsx               HashRouter + providers + native bootstrap
  src/shims/                next/navigation, next/link, next/image → react-router
  vite.config.ts            aliases @ -> ../src and the next/* shims
  resources/icon.png        1024x1024 source icon for asset generation
src/views/cleaner/*         the actual screens (shared with the web app)
src/hooks/use-*             native plugin hooks (camera, geo, haptics, push)
```

The SPA reuses the web screens unchanged; only the three Next-specific
imports are shimmed to react-router. Supabase auth persists the session in
localStorage (PKCE), which works inside the Capacitor WebView.

---

## Build & run (local)

Prereqs: Node 18+, and for native builds Xcode (macOS) / Android Studio.

```bash
npm install

# 1. Build the contractor SPA -> mobile/dist
npm run mobile:build

# 2. Add native platforms (first time only)
npx cap add ios        # macOS + CocoaPods required
npx cap add android

# 3. Generate icons & splash from mobile/resources/icon.png
npx @capacitor/assets generate --assetPath mobile/resources

# 4. Copy web build + plugins into the native projects
npx cap sync

# 5. Open in the native IDE
npx cap open ios
npx cap open android
```

`npm run mobile:sync` runs steps 1 + 4 together.

> iOS archiving/signing must happen on macOS (or a cloud Mac build such as
> Codemagic / Ionic Appflow / EAS). Android can build on Linux/CI.

---

## Push notifications

Device tokens are stored in `public.cleaner_device_tokens` (the
`use-push-notifications` hook upserts the APNs/FCM token on launch). The
`send-push` edge function delivers to a cleaner's devices and is invoked
alongside SMS in the dispatch/new-opportunity flow.

`send-push` no-ops until these secrets are set (Supabase → app_secrets / env):

| Secret | Purpose |
| --- | --- |
| `FCM_SERVICE_ACCOUNT_JSON` | Android (FCM HTTP v1) — full service-account JSON |
| `APNS_KEY_P8` | iOS — contents of the `AuthKey_XXXX.p8` |
| `APNS_KEY_ID`, `APNS_TEAM_ID` | iOS — from the Apple developer portal |
| `APNS_BUNDLE_ID` | defaults to `com.novaracleaning.contractor` |
| `APNS_PRODUCTION` | `"true"` for the production APNs host |

Native config also required:
- **iOS:** enable the Push Notifications capability + upload the APNs key.
- **Android:** add `google-services.json` to `android/app/` and the Google
  Services Gradle plugin.

---

## Permissions to declare

**iOS** (`ios/App/App/Info.plist`):
```xml
<key>NSCameraUsageDescription</key><string>Take before/after photos of cleaning jobs.</string>
<key>NSPhotoLibraryUsageDescription</key><string>Attach job photos.</string>
<key>NSLocationWhenInUseUsageDescription</key><string>Verify job check-ins.</string>
```

**Android** (`android/app/src/main/AndroidManifest.xml`): `CAMERA`,
`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `POST_NOTIFICATIONS`,
`VIBRATE`.

---

## Distribution

Recommended: publish to the **App Store** and **Google Play**, gated by login
(only approved cleaners can sign in). Share the store links in the onboarding
SMS/email. For faster testing use **TestFlight** (iOS) and **Play internal
testing** (Android).

Accounts required: Apple Developer Program ($99/yr), Google Play Developer
($25 one-time).

---

## Updating

After changing the web layer:
```bash
npm run mobile:build && npx cap sync
```
Then re-archive/submit from Xcode / Android Studio (bump versions in
`package.json`, iOS project, and `android/app/build.gradle`).
