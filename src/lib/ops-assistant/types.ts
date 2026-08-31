// ─── Ops Assistant — shared types ─────────────────────────────────────────
//
// One assistant, two doors (the admin workspace and docs.novaracleaning.com).
// Everything that crosses the API boundary is shaped here so the panel, the
// search bar, and the server all agree.

export type AssistantSurface = "docs" | "workspace";
export type AssistantEntry = "chat" | "search";
export type AssistantRole = "admin" | "va";

export type RecordKind = "booking" | "customer" | "account" | "cleaner";

export interface PageRecord {
  kind: RecordKind;
  id: string;
  label?: string;
}

export interface PageContext {
  surface: AssistantSurface;
  /** Path the person is looking at, e.g. /docs/commercial or /admin/bookings. */
  path: string;
  /** Docs slug when the surface is the guides (or a workspace screen that has one). */
  docSlug?: string | null;
  record?: PageRecord | null;
}

export interface KnowledgeChunk {
  id: string;
  category: string;
  docSlug: string;
  docTitle: string;
  area: string;
  section: string;
  headingId: string;
  whoCanSee: string;
  /** Workspace path this guide describes, e.g. /admin/bookings. */
  where: string;
  lastVerified: string;
  containsGate: boolean;
  containsDiscrepancy: boolean;
  /** Relative URL on the docs host. */
  docsPath: string;
  screenshotCaptions: string[];
  text: string;
}

export interface PolicyArticle {
  id: string;
  slug: string;
  title: string;
  category: string;
  body: string;
  escalation: boolean;
  adminOnly: boolean;
  updatedAt: string | null;
}

export interface Citation {
  id: string;
  title: string;
  section: string;
  /** Path on docs.novaracleaning.com, e.g. /docs/bookings#staffing-a-job. */
  docsPath: string;
  lastVerified: string;
  hasScreenshot: boolean;
  category: string;
}

export interface NextAction {
  label: string;
  href: string;
  kind: "workspace" | "docs" | "drive";
}

export interface LiveFact {
  label: string;
  value: string;
  /** Where this number/status came from, so it cannot be mistaken for recall. */
  source: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  actions: NextAction[];
  surface: AssistantSurface;
  entry: AssistantEntry;
  escalation: boolean;
  writeRefused: boolean;
  createdAt: string;
  rating?: "helpful" | "not_helpful" | null;
  ratingNote?: string | null;
  didNotKnow?: boolean;
}

export interface AskRequest {
  message: string;
  surface: AssistantSurface;
  entry?: AssistantEntry;
  page?: PageContext;
}

export interface AskResponse {
  message: ChatMessage;
  threadId: string;
}

export interface ThreadResponse {
  threadId: string;
  messages: ChatMessage[];
}

export type GuardrailKind = "none" | "escalation" | "write_refused";

export interface GuardrailResult {
  kind: GuardrailKind;
  /** Why this fired — quoted back so the person knows it is a rule, not a preference. */
  reason: string | null;
}

export interface Retrieved {
  chunk: KnowledgeChunk | PolicyArticleChunk;
  score: number;
  /** True when this chunk belongs to the page the person is currently on. */
  onCurrentPage: boolean;
}

export interface PolicyArticleChunk {
  id: string;
  category: string;
  docSlug: string;
  docTitle: string;
  area: string;
  section: string;
  headingId: string;
  whoCanSee: string;
  where: string;
  lastVerified: string;
  containsGate: boolean;
  containsDiscrepancy: boolean;
  docsPath: string;
  screenshotCaptions: string[];
  text: string;
  escalation: boolean;
  source: "policy";
}

export type AnyChunk = KnowledgeChunk | PolicyArticleChunk;

export function isPolicyChunk(c: AnyChunk): c is PolicyArticleChunk {
  return (c as PolicyArticleChunk).source === "policy";
}
