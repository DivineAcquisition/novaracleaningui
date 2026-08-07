/**
 * EAS Build runs with the GitHub "Base directory" defaulting to repo root (`/`).
 * The Expo app lives in contractor-app/. On EAS, copy that app to the build root
 * before npm install so type:build jobs use the right package.json / app.json.
 *
 * No-ops when already building from contractor-app/ (correct Base directory)
 * or when not running on EAS.
 */
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

if (!process.env.EAS_BUILD) {
  process.exit(0);
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.name === "contractor-app") {
  console.log("[eas-prepare] Already in contractor-app; skipping promote.");
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

console.log("[eas-prepare] Done.");
