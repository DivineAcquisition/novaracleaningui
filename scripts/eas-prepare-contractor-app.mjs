/**
 * EAS Build runs with the GitHub "Base directory" defaulting to repo root (`/`).
 * The Expo app lives in contractor-app/. On EAS, copy that app to the build root
 * before npm install so type:build jobs use the right package.json / app.json.
 *
 * No-ops the promote when already building from contractor-app/ (correct Base
 * directory) or when not running on EAS. Always drops non-npm lockfiles so EAS
 * does not pick bun from the monorepo-root bun.lockb.
 */
import { cpSync, existsSync, readFileSync, rmSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

if (!process.env.EAS_BUILD) {
  process.exit(0);
}

function removeIfExists(filePath) {
  if (!existsSync(filePath)) return;
  unlinkSync(filePath);
  console.log(`[eas-prepare] Removed ${filePath}`);
}

/**
 * EAS picks the package manager from lockfiles (bun > yarn > npm > pnpm).
 * The monorepo root has bun.lockb for the Next app; contractor-app uses npm.
 * Drop non-npm lockfiles so install uses package-lock.json with --frozen-lockfile.
 */
function preferNpmLockfile() {
  for (const name of ["bun.lockb", "bun.lock", "yarn.lock", "pnpm-lock.yaml"]) {
    removeIfExists(join(root, name));
  }
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.name === "contractor-app") {
  console.log("[eas-prepare] Already in contractor-app; ensuring npm lockfile wins.");
  preferNpmLockfile();
  process.exit(0);
}

const src = join(root, "contractor-app");
if (!existsSync(join(src, "package.json")) || !existsSync(join(src, "app.json"))) {
  console.error("[eas-prepare] contractor-app/ is missing package.json or app.json");
  process.exit(1);
}

console.log("[eas-prepare] Promoting contractor-app/ to EAS build root…");

const files = [
  "package.json",
  "package-lock.json",
  "app.json",
  "tsconfig.json",
  "index.ts",
  ".gitignore",
];

for (const file of files) {
  const from = join(src, file);
  if (!existsSync(from)) continue;
  cpSync(from, join(root, file));
}

for (const dir of ["app", "src", "assets"]) {
  const from = join(src, dir);
  const to = join(root, dir);
  if (!existsSync(from)) continue;
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
}

preferNpmLockfile();

if (!existsSync(join(root, "package-lock.json"))) {
  console.error("[eas-prepare] package-lock.json missing after promote");
  process.exit(1);
}

console.log("[eas-prepare] Done (npm + package-lock.json).");
