// ─── Guardrails that never wait on the model ──────────────────────────────
//
// These run before any model call and after any model reply. The model is
// not trusted to remember them. Pricing figures are handled separately: a
// money-adjacent question is flagged here so the answer path computes from
// live configuration rather than recalling a number from a guide.

import type { GuardrailResult } from "./types";

const WRITE_RE =
  /\b(create|make|place|submit|send|book|assign|unassign|cancel|refund|charge|delete|remove|update|change|edit|apply|approve|reject|pause|resume|terminate|fire|dispatch|offer|text|sms|email|invoice|override)\b/i;

const WRITE_COMMIT_RE =
  /\b(go ahead|do it|just (do|send|create|book|cancel|refund)|take the action|on my behalf|for me now)\b/i;

const ESCALATION_RES: Array<{ re: RegExp; reason: string }> = [
  {
    re: /\b(lawsuit|attorney|lawyer|legal threat|sue us|better business bureau|bbb complaint)\b/i,
    reason: "Legal threats and formal complaints go to management, not the floor.",
  },
  {
    re: /\b(fire|terminat\w*|let (them|him|her) go)\b.*\b(cleaner|contractor|employee)\b|\b(cleaner|contractor|employee)\b.*\b(fire|terminat\w*)\b/i,
    reason: "Ending a contractor's relationship is a management decision.",
  },
  {
    re: /\b(comp(ed|limentary)|free clean|waive (the )?(charge|balance|invoice)|make it free)\b/i,
    reason: "Comping work or waiving a balance is a management exception, not a VA action.",
  },
  {
    re: /\b(outside (of )?policy|exception to (the )?policy|override (the )?price|special (rate|price|deal))\b/i,
    reason: "Pricing and policy exceptions are confirmed with management.",
  },
  {
    re: /\b(delete (this |the |their )?customer|erase (their )?data|right to be forgotten|gdpr)\b/i,
    reason: "Deleting a customer record is admin-only and usually a management call.",
  },
  {
    re: /\b(confirm with management|ask (malik|management)|speak to (a )?manager|escalate this)\b/i,
    reason: "The person is already asking to escalate.",
  },
];

const MONEY_RE =
  /\b(pric(e|ing)|quote|how much|charge|pay(out|roll)?|refund|invoice|billing|discount|credit|rate|dollar|\$)\b/i;

export function detectWriteIntent(message: string): GuardrailResult {
  const text = message || "";
  if (WRITE_COMMIT_RE.test(text) && WRITE_RE.test(text)) {
    return {
      kind: "write_refused",
      reason:
        "I can walk you through where to click and I can draft the message, but I cannot take the action myself — no creates, sends, or record changes.",
    };
  }
  // Imperative "send this" / "cancel this booking" without "how do I".
  if (
    WRITE_RE.test(text) &&
    !/\b(how (do|does|to)|walk me|where (do|can)|what (do|happens)|can i|should i)\b/i.test(text)
  ) {
    return {
      kind: "write_refused",
      reason:
        "I can walk you through where to click and I can draft the message, but I cannot take the action myself — no creates, sends, or record changes.",
    };
  }
  return { kind: "none", reason: null };
}

export function detectEscalation(
  message: string,
  extraReasons: string[] = [],
): GuardrailResult {
  const text = message || "";
  for (const { re, reason } of ESCALATION_RES) {
    if (re.test(text)) return { kind: "escalation", reason };
  }
  for (const extra of extraReasons) {
    if (extra && extra.length > 3 && text.toLowerCase().includes(extra.toLowerCase())) {
      return {
        kind: "escalation",
        reason: "This is on the escalation list — confirm with management before acting.",
      };
    }
  }
  return { kind: "none", reason: null };
}

export function isMoneyAdjacent(message: string, extraTerms: string[] = []): boolean {
  if (MONEY_RE.test(message || "")) return true;
  const lower = (message || "").toLowerCase();
  return extraTerms.some((t) => t && lower.includes(t.toLowerCase()));
}

export function isWalkthroughIntent(message: string): boolean {
  return /\b(walk me through|step by step|step-by-step|how do i (onboard|set up|add|create|book)|what's the (process|sequence)|what are the steps)\b/i.test(
    message || "",
  );
}

export function combineGuardrails(message: string, extraEscalation: string[] = []): GuardrailResult {
  const escalation = detectEscalation(message, extraEscalation);
  if (escalation.kind === "escalation") return escalation;
  return detectWriteIntent(message);
}

/** Strip recalled dollar figures from a knowledge chunk used for a money question. */
export function stripRecalledMoney(text: string): string {
  return text
    .replace(/\$\s?\d[\d,]*(?:\.\d+)?/g, "[live figure — do not quote from this guide]")
    .replace(/\b\d+\s?cents\b/gi, "[live figure — do not quote from this guide]");
}
