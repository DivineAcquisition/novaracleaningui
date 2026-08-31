// Offline checks on model routing and secret hygiene.
//
// Two things worth failing a build over: an assistant question about money
// answered by the cheap tier, and an API key anywhere in the repository.
// Both are checkable without a network call.
//
// Run: npm run models:verify

import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_MODEL_CONTROL,
  MODEL_TIERS,
  fallbackIsDistinct,
  mergeModelControl,
  tierForIntent,
} from "../src/lib/model-control";

let failures = 0;

function check(name: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`  ok   ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log("\nTier configuration");
{
  const s = DEFAULT_MODEL_CONTROL;
  check("default tier is Sonnet 5", s.tiers.default === "claude-sonnet-5", s.tiers.default);
  check("strongest tier is Opus 5", s.tiers.strongest === "claude-opus-5", s.tiers.strongest);
  check("fallback tier is Sonnet 5", s.tiers.fallback === "claude-sonnet-5", s.tiers.fallback);
  check("every tier has a model", MODEL_TIERS.every((t) => Boolean(s.tiers[t])));
  check(
    "fallback differs from strongest, so a retry is not the same outage",
    fallbackIsDistinct(s),
  );
}

console.log("\nIntent routing");
{
  const s = DEFAULT_MODEL_CONTROL;
  const money = [
    "pricing question",
    "what is the quote for this job",
    "cleaner payout",
    "payroll run",
    "refund request",
    "invoice billing",
    "apply a discount",
    "customer credit balance",
  ];
  for (const intent of money) {
    check(`"${intent}" → strongest`, tierForIntent(intent, s) === "strongest");
  }

  const general = [
    "what is our cancellation policy",
    "draft a reply to this customer",
    "when is the next visit scheduled",
    "summarize this conversation",
  ];
  for (const intent of general) {
    check(`"${intent}" → default`, tierForIntent(intent, s) === "default");
  }

  check("no intent → default", tierForIntent(null, s) === "default");
  check("empty intent → default", tierForIntent("", s) === "default");
}

console.log("\nSettings merge");
{
  const partial = mergeModelControl({ tiers: { strongest: "claude-opus-5-20260101" } });
  check(
    "a partial edit keeps the other tiers",
    partial.tiers.default === DEFAULT_MODEL_CONTROL.tiers.default &&
      partial.tiers.strongest === "claude-opus-5-20260101",
  );
  check("garbage input falls back to defaults", mergeModelControl(null).tiers.strongest === "claude-opus-5");
  check(
    "an unknown provider resolves to anthropic",
    mergeModelControl({ provider: "wat" }).provider === "anthropic",
  );
  check("timeout has a floor", mergeModelControl({ timeout_ms: 1 }).timeout_ms >= 5000);
}

console.log("\nSecret hygiene");
{
  const root = process.cwd();

  // Matches a key's SHAPE — the prefix plus a long secret body — so the
  // detector patterns in this file and in the API guard don't trip it. A bare
  // "sk-ant-" in prose is not a leak; "sk-ant-" plus 30 secret characters is.
  const KEY_SHAPE = String.raw`sk-(ant|proj)-[A-Za-z0-9_-]{30,}`;

  let keyHits = "";
  try {
    keyHits = execSync(
      `rg -n --hidden -g '!.git' -g '!*.lock' -g '!package-lock.json' '${KEY_SHAPE}' . || true`,
      { cwd: root, encoding: "utf8" },
    ).trim();
  } catch {
    keyHits = "";
  }
  check("no API key literal in the working tree", keyHits === "", keyHits.slice(0, 300));

  let historyHits = "";
  try {
    historyHits = execSync(
      `git log --all --pickaxe-regex -S '${KEY_SHAPE}' --oneline || true`,
      { cwd: root, encoding: "utf8" },
    ).trim();
  } catch {
    historyHits = "";
  }
  check("no API key in git history", historyHits === "", historyHits.slice(0, 300));

  const gitignore = readFileSync(resolve(root, ".gitignore"), "utf8");
  check("`.env` is gitignored", /^\.env$/m.test(gitignore));
  check("`.env.*` is gitignored", /^\.env\.\*$/m.test(gitignore));
  check("`.env.example` is exempted so the template stays tracked", /^!\.env\.example$/m.test(gitignore));

  let tracked = "";
  try {
    tracked = execSync("git ls-files .env .env.local .env.production || true", {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    tracked = "";
  }
  check("no .env file is tracked by git", tracked === "", tracked);

  check(".env.example exists as the documented template", existsSync(resolve(root, ".env.example")));

  const example = existsSync(resolve(root, ".env.example"))
    ? readFileSync(resolve(root, ".env.example"), "utf8")
    : "";
  check(
    ".env.example names the AI keys without values",
    example.includes("ANTHROPIC_API_KEY=\"\"") && example.includes("OPENAI_API_KEY=\"\""),
  );

  // The key must be read by name, never inlined at a call site.
  const llm = readFileSync(resolve(root, "supabase/functions/_shared/llm.ts"), "utf8");
  check(
    "the model layer resolves keys by name",
    llm.includes('resolveSecret(sb, provider === "openai" ? "OPENAI_API_KEY" : "ANTHROPIC_API_KEY")'),
  );
  check("the model layer contains no key literal", !/sk-[A-Za-z0-9-]{16,}/.test(llm));
}

console.log("\nCall sites route through the layer");
{
  const root = process.cwd();
  const sites = [
    "supabase/functions/_shared/weekly-report/insights.ts",
    "supabase/functions/_shared/checklist-insights.ts",
    "supabase/functions/admin-chat-agent/index.ts",
  ];
  for (const site of sites) {
    const src = readFileSync(resolve(root, site), "utf8");
    check(`${site} uses callModel`, src.includes("callModel("));
    check(
      `${site} no longer calls a provider endpoint directly`,
      !src.includes("api.anthropic.com") && !src.includes("api.openai.com"),
    );
  }

  const weekly = readFileSync(resolve(root, sites[0]), "utf8");
  const checklist = readFileSync(resolve(root, sites[1]), "utf8");
  check("weekly report insights use the strongest tier", /tier:\s*"strongest"/.test(weekly));
  check("checklist insights use the strongest tier", /tier:\s*"strongest"/.test(checklist));

  const agent = readFileSync(resolve(root, sites[2]), "utf8");
  check("the assistant selects its tier by intent", agent.includes("tierForIntent("));
}

console.log(
  failures === 0
    ? "\nAll model control checks passed.\n"
    : `\n${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
