// ─── Behavioural checks for the docs ↔ workspace Ops Assistant ────────────
//
//   npm run ops-assistant:verify
//
// These are the "how to know it works" checks from the integration spec,
// run against the real guide files and the real answer engine — no model
// call, no database. If search and chat can drift, if a docs-page question
// forgets the page, if a write sneaks through, or if a VA is walked through
// Payroll, this fails.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { groundAnswer } from "../../src/lib/ops-assistant/answer";
import {
  buildKnowledgePack,
  chunkVisibleTo,
  isGuideFile,
  type ShotInput,
} from "../../src/lib/ops-assistant/guide-chunks";
import { detectEscalation, detectWriteIntent, isMoneyAdjacent, stripRecalledMoney } from "../../src/lib/ops-assistant/guardrails";
import { retrieveChunks, screenSlugFromPath } from "../../src/lib/ops-assistant/retrieval";
import { extractSteps } from "../../src/lib/ops-assistant/walkthrough";
import { BUILTIN_ARTICLES } from "../../src/lib/ops-assistant/policy-articles";

const ROOT = resolve(__dirname, "../..");
const problems: string[] = [];

function assert(cond: unknown, msg: string) {
  if (!cond) problems.push(msg);
}

function readSrc(rel: string): string {
  const full = join(ROOT, "src", rel);
  if (!existsSync(full)) {
    problems.push(`missing ${rel}`);
    return "";
  }
  return readFileSync(full, "utf8");
}

function loadPack() {
  const dir = join(ROOT, "docs/admin-workspace");
  const files = readdirSync(dir)
    .filter(isGuideFile)
    .map((name) => ({
      slug: name.replace(/\.md$/, ""),
      raw: readFileSync(join(dir, name), "utf8"),
    }));
  let shots: ShotInput[] = [];
  const shotsPath = join(dir, "screenshots/manifest.json");
  if (existsSync(shotsPath)) {
    const manifest = JSON.parse(readFileSync(shotsPath, "utf8")) as { shots?: ShotInput[] };
    shots = manifest.shots || [];
  }
  return buildKnowledgePack(files, shots);
}

function wiring() {
  const shell = readSrc("components/docs/DocsShell.tsx");
  assert(shell.includes("OpsAssistantSearch"), "docs search bar must be the assistant, not a keyword filter");
  assert(shell.includes('surface="docs"'), "docs shell must mount the assistant as the docs surface");
  assert(!/query\.trim\(\)\.toLowerCase\(\)/.test(shell), "docs shell must not keep a parallel keyword search");

  const layout = readSrc("components/admin/AdminLayout.tsx");
  assert(layout.includes('surface="workspace"'), "admin layout must mount the assistant as the workspace surface");
  assert(layout.includes("OpsAssistantPanel"), "admin layout must render the persistent panel");
  assert(layout.includes("OpsAssistantToggle"), "admin layout must open the panel from any screen");

  const api = readSrc("app/api/ops-assistant/route.ts");
  assert(api.includes("groundAnswer"), "chat and search must share groundAnswer");
  assert(
    api.includes('v === "search"') || api.includes('entry === "search"') || api.includes("asEntry"),
    "search entry must hit the same POST as chat",
  );
  assert(api.includes("loadGuideChunks"), "assistant knowledge must load the live guides, not a separate uploaded copy");
  assert(!/\.insert\(/.test(api) || !/from\(\"bookings\"\)/.test(api), "the ask route must not write bookings");

  const live = readSrc("lib/ops-assistant/live-data.ts");
  assert(live.includes("read-only") || live.includes("Read-only"), "live-data module must describe itself as read-only");
  assert(!/\.insert\(/.test(live) && !/\.update\(/.test(live) && !/\.delete\(/.test(live), "live-data must not insert, update, or delete");
  assert(live.includes("commercial_coi_status"), "COI status must be computed live, not recalled");

  const llm = readSrc("lib/ops-assistant/llm.ts");
  assert(llm.includes("assist-and-draft only"), "model prompt must keep the no-write guardrail");
  assert(llm.includes("NEVER recalled") || llm.includes("never recalled"), "model prompt must refuse recalled prices");
  assert(llm.includes("ops-assistant"), "model invocations must log the ops-assistant surface");
}

function knowledgeAndAnswers() {
  const pack = loadPack();
  assert(pack.chunks.length > 20, `expected real guide chunks, got ${pack.chunks.length}`);
  assert(
    pack.chunks.every((c) => c.docsPath.startsWith("/docs/")),
    "every how-to chunk must carry a docs.novaracleaning.com path",
  );
  assert(
    pack.chunks.some((c) => c.screenshotCaptions.length > 0),
    "screenshot captions must travel with the chunks so the assistant can point at the page",
  );

  const commercialPage = {
    surface: "docs" as const,
    path: "/docs/commercial",
    docSlug: "commercial",
    record: null,
  };

  const twoSites = groundAnswer({
    message: "what if the client wants two sites",
    surface: "docs",
    entry: "search",
    role: "admin",
    page: commercialPage,
    chunks: pack.chunks,
  });
  assert(
    twoSites.retrieved.some((r) => r.chunk.docSlug === "commercial" && r.onCurrentPage),
    "a question asked on the Commercial guide must retrieve that guide without restating the topic",
  );
  assert(
    twoSites.citations.some((c) => c.docsPath.includes("/docs/commercial")),
    "the answer must cite the Commercial docs page",
  );
  assert(twoSites.text.toLowerCase().includes("per the"), "answers must name the source doc");

  const sameViaChat = groundAnswer({
    message: "what if the client wants two sites",
    surface: "docs",
    entry: "chat",
    role: "admin",
    page: commercialPage,
    chunks: pack.chunks,
  });
  assert(
    sameViaChat.text === twoSites.text &&
      sameViaChat.citations.map((c) => c.id).join() === twoSites.citations.map((c) => c.id).join(),
    "docs search and the chat panel must produce the same grounded answer",
  );

  const walk = groundAnswer({
    message: "walk me through onboarding a new commercial account",
    surface: "workspace",
    entry: "chat",
    role: "admin",
    page: { surface: "workspace", path: "/admin/commercial", docSlug: "commercial", record: null },
    chunks: pack.chunks,
  });
  assert(walk.intent === "walkthrough", "walk-me-through must use the walkthrough path");
  assert(
    walk.actions.some((a) => a.kind === "workspace" && a.href.includes("/admin/commercial")),
    "a workspace walkthrough must point at the real next screen",
  );
  assert(
    walk.actions.some((a) => a.kind === "docs" && a.href.includes("/docs/")),
    "a walkthrough must still link the full docs page (screenshots live there)",
  );
  assert(
    extractSteps(walk.retrieved[0]?.chunk.text || "").length > 0 || walk.text.includes("Per the"),
    "walkthrough prose must come from the guide, not an invented sequence",
  );

  const write = groundAnswer({
    message: "go ahead and create this booking for me now",
    surface: "workspace",
    entry: "chat",
    role: "va",
    page: { surface: "workspace", path: "/admin/bookings", docSlug: "bookings", record: null },
    chunks: pack.chunks,
  });
  assert(write.writeRefused, "imperative creates must be refused");
  assert(/cannot take the action/i.test(write.text), "the refusal must say the assistant does not act");

  const legal = groundAnswer({
    message: "the customer said they will sue us, should I refund them?",
    surface: "workspace",
    entry: "chat",
    role: "va",
    chunks: pack.chunks,
    articles: BUILTIN_ARTICLES,
  });
  assert(legal.escalation, "legal threats must route to confirm-with-management");
  assert(/management/i.test(legal.text), "escalation answers must mention management");

  const price = groundAnswer({
    message: "how much do we charge for a 3 bed standard clean?",
    surface: "workspace",
    entry: "chat",
    role: "va",
    chunks: pack.chunks,
  });
  assert(price.moneyAdjacent, "a charge question is money-adjacent");
  assert(
    /live configuration/i.test(price.text) || /live inputs/i.test(price.text),
    "a price question without live inputs must refuse to recall a number",
  );
  assert(
    !/\$\d/.test(price.text.replace(/\[live figure[^\]]+\]/g, "")),
    "the answer must not quote a dollar figure recalled from a guide",
  );

  const payroll = retrieveChunks({
    query: "how do I run payroll",
    chunks: pack.chunks,
    role: "va",
    page: { surface: "workspace", path: "/admin/dashboard", docSlug: "dashboard" },
  });
  assert(
    payroll.every((r) => chunkVisibleTo(r.chunk, "va")),
    "VA retrieval must not surface Full-admins-only chunks",
  );
  assert(
    !payroll.some((r) => r.chunk.docSlug === "payroll"),
    "a VA asking about payroll must not be walked through the Payroll guide",
  );

  const mixed = groundAnswer({
    message: "what's this account's current COI status",
    surface: "workspace",
    entry: "chat",
    role: "admin",
    page: {
      surface: "workspace",
      path: "/admin/commercial",
      docSlug: "commercial",
      record: { kind: "account", id: "acct-1", label: "Example LLC" },
    },
    chunks: pack.chunks,
    liveFacts: [
      {
        label: "COI status",
        value: "expired",
        source: "commercial_coi_status() — computed from the certificate expiry, never stored",
      },
    ],
  });
  assert(mixed.intent === "mixed" || mixed.intent === "live" || mixed.intent === "howto", "live + docs is a single conversation turn");
  assert(/expired/i.test(mixed.text), "live COI status must appear in the answer");
  assert(/commercial_coi_status/.test(mixed.text), "the live fact must cite the computed function, not a recalled status");

  const slug = screenSlugFromPath("/admin/csr");
  assert(slug === "internal-booking", "workspace paths must map onto the matching guide");
  assert(screenSlugFromPath("/docs/bookings") === "bookings", "docs paths must map onto the matching guide");
}

function guardrailUnit() {
  assert(detectWriteIntent("send this invoice now").kind === "write_refused", "send-now is a write");
  assert(detectWriteIntent("how do I send an offer SMS").kind === "none", "how-do-I send is guidance, not a write");
  assert(detectEscalation("we should fire this cleaner").kind === "escalation", "termination is escalation");
  assert(isMoneyAdjacent("what's the payout for this job"), "payout is money-adjacent");
  assert(
    stripRecalledMoney("The quote is $189.00 for a 2,000 sqft home").includes("[live figure"),
    "recalled dollar amounts must be stripped from money-adjacent chunks",
  );
}

function exportMatchesLive() {
  const generated = join(ROOT, "docs/admin-workspace/_data/ops-assistant-knowledge.generated.json");
  if (!existsSync(generated)) {
    problems.push("ops-assistant-knowledge.generated.json is missing — run npm run docs:export");
    return;
  }
  const pack = loadPack();
  const disk = JSON.parse(readFileSync(generated, "utf8")) as { chunks: Array<{ id: string; docsPath?: string }> };
  const liveIds = new Set(pack.chunks.map((c) => c.id));
  const diskIds = new Set((disk.chunks || []).map((c) => c.id));
  for (const id of liveIds) {
    if (!diskIds.has(id)) {
      problems.push(`generated knowledge pack is missing chunk ${id} — run npm run docs:export`);
      break;
    }
  }
  assert(
    (disk.chunks || []).every((c) => typeof c.docsPath === "string" && c.docsPath.startsWith("/docs/")),
    "generated pack must include docsPath so citations can link the live page",
  );
}

function main() {
  wiring();
  knowledgeAndAnswers();
  guardrailUnit();
  exportMatchesLive();

  if (problems.length) {
    console.log("── Problems ──");
    for (const p of problems) console.log(`  ${p}`);
    console.log(`\n${problems.length} problem(s).`);
    process.exitCode = 1;
    return;
  }
  console.log("Ops Assistant integration checks out.");
}

main();
