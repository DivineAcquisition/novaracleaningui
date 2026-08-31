// ─── Built-in policy / escalation articles ────────────────────────────────
//
// The How-the-Tool-Works guides live as markdown in the repo. Policy,
// pricing-promise, and escalation topics are a different category: they are
// admin-editable (the `ops_assistant_articles` table) because they change
// without a code change. These seeds load when the table is empty so the
// assistant still has the escalation list on day one.

import type { PolicyArticle, PolicyArticleChunk } from "./types";
import { headingId } from "./guide-chunks";

export const BUILTIN_ARTICLES: PolicyArticle[] = [
  {
    id: "seed-escalation-legal",
    slug: "escalation-legal",
    title: "Escalation — legal threats and formal complaints",
    category: "Escalation",
    body:
      "Anything involving a lawyer, a lawsuit, a BBB complaint, or a threat to go public is confirm-with-management. Do not offer a refund, a comp, or a statement of fault. Take the details, say someone from management will follow up, and stop.",
    escalation: true,
    adminOnly: false,
    updatedAt: null,
  },
  {
    id: "seed-escalation-termination",
    slug: "escalation-termination",
    title: "Escalation — ending a contractor relationship",
    category: "Escalation",
    body:
      "Firing, terminating, or 'not sending this cleaner back ever' is confirm-with-management. You can document what happened on the Quality Control screen. You cannot end the relationship from the assistant, and you should not tell a contractor they are done.",
    escalation: true,
    adminOnly: false,
    updatedAt: null,
  },
  {
    id: "seed-escalation-comp",
    slug: "escalation-comp-and-exceptions",
    title: "Escalation — comps, waived balances, special rates",
    category: "Escalation",
    body:
      "Comping a clean, waiving a balance, or quoting a special rate that is not what the pricing engine produced is confirm-with-management. Walk the person through the live quote on the booking screen. Do not invent a discount.",
    escalation: true,
    adminOnly: false,
    updatedAt: null,
  },
  {
    id: "seed-escalation-data",
    slug: "escalation-customer-deletion",
    title: "Escalation — deleting a customer or their data",
    category: "Escalation",
    body:
      "Deleting a customer record, erasing data, or a 'right to be forgotten' request is confirm-with-management and admin-only. Do not walk a VA through the delete control.",
    escalation: true,
    adminOnly: true,
    updatedAt: null,
  },
];

export function articlesToChunks(articles: PolicyArticle[]): PolicyArticleChunk[] {
  return articles.map((a) => ({
    id: `policy:${a.slug}`,
    category: a.category,
    docSlug: a.slug,
    docTitle: a.title,
    area: a.category,
    section: "Policy",
    headingId: headingId(a.title),
    whoCanSee: a.adminOnly ? "Full admins only" : "Admins and VAs",
    where: "",
    lastVerified: a.updatedAt ? a.updatedAt.slice(0, 10) : "",
    containsGate: a.escalation,
    containsDiscrepancy: false,
    docsPath: "",
    screenshotCaptions: [],
    text: `${a.title}\n\n${a.body}`,
    escalation: a.escalation,
    source: "policy" as const,
  }));
}
