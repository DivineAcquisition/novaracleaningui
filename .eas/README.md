# EAS (Novara Pro)

Expo GitHub integration defaults **Base directory** to `/` (this repo root).

- `eas.json` and `.eas/workflows/` live here so dashboard / workflow runs can
  find them at this git ref.
- The Expo app source is `contractor-app/`. On EAS Build,
  `eas-build-pre-install` → `scripts/eas-prepare-contractor-app.mjs` copies
  that app into the build root before `npm install`.

To skip the promote step, set Base directory to `contractor-app` in the Expo
project’s GitHub settings.
