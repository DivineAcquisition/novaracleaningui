// Minimal .env loader for the operational Airtable scripts (no external deps).
// Loads .env.local then .env, filling in any process.env keys that aren't
// already set. Real env vars (CI / shell exports) always win.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

function parseAndApply(file: string): void {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

export function loadEnv(): void {
  const cwd = process.cwd();
  parseAndApply(resolve(cwd, ".env.local"));
  parseAndApply(resolve(cwd, ".env"));
}
