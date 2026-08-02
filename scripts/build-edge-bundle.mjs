// Bundles one edge function (entrypoint + its `_shared` imports) into a single
// self-contained ES module under scripts/edge-bundles/.
//
// Why this exists: `supabase functions deploy` is the normal path, but it needs
// SUPABASE_ACCESS_TOKEN (see .github/workflows/deploy-supabase-functions.yml).
// When that token is missing the only way to ship a function is the Management
// API, which takes file contents inline — and a multi-file function has to be
// flattened first. Remote imports (deno.land, esm.sh) stay external; Supabase
// resolves those itself at deploy time.
//
//   node scripts/build-edge-bundle.mjs book-as-va
//
// The output is byte-reproducible, so the sha256 printed here is what should be
// verified against whatever ends up deployed.

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const name = process.argv[2];
if (!name) {
  console.error("usage: node scripts/build-edge-bundle.mjs <function-name>");
  process.exit(1);
}

const result = await esbuild.build({
  entryPoints: [resolve(repoRoot, "supabase/functions", name, "index.ts")],
  bundle: true,
  format: "esm",
  target: "esnext",
  platform: "neutral",
  minify: true,
  charset: "ascii",
  legalComments: "none",
  write: false,
  external: ["https://*", "http://*", "npm:*", "jsr:*", "node:*"],
});

const code = result.outputFiles[0].text;
const outPath = resolve(repoRoot, "scripts/edge-bundles", `${name}.js`);
await mkdir(dirname(outPath), { recursive: true });
await writeFile(outPath, code);

console.log(`${name}: ${code.length} bytes`);
console.log(`sha256: ${createHash("sha256").update(code).digest("hex")}`);
console.log(`wrote:  scripts/edge-bundles/${name}.js`);
