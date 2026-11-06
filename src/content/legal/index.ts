// Customer policies. Each one keeps the path it had on the Framer site, so
// every existing link (checkout agreements, emails, texts, footers) still works.

import cancellation from "./cancellation";
import disclaimer from "./disclaimer";
import membership from "./membership";
import privacy from "./privacy";
import refund from "./refund";
import terms from "./terms";

export const POLICY_UPDATED = "November 6, 2026";

export type PolicySlug = "terms" | "privacy" | "disclaimer" | "cancellation-policy" | "refund-policy" | "membership-policy";

export interface Policy {
  slug: PolicySlug;
  path: `/${PolicySlug}`;
  title: string;
  /** One plain sentence shown under the title and on the policy cards. */
  summary: string;
  text: string;
}

export const POLICIES: Policy[] = [
  {
    slug: "terms",
    path: "/terms",
    title: "Terms of Service",
    summary: "The agreement between you and Novara Cleaning LLC for booking and using our cleaning services.",
    text: terms,
  },
  {
    slug: "privacy",
    path: "/privacy",
    title: "Privacy Policy",
    summary: "What information we collect from customers and contractors, how we use it, and your choices.",
    text: privacy,
  },
  {
    slug: "cancellation-policy",
    path: "/cancellation-policy",
    title: "Cancellation Policy",
    summary: "Cancel with 24 hours’ notice, reschedule with 48 hours’ notice, and the fees that apply inside those windows.",
    text: cancellation,
  },
  {
    slug: "refund-policy",
    path: "/refund-policy",
    title: "Refund Policy",
    summary: "How quality concerns are handled: a re-clean first, then credit or a partial refund in limited cases.",
    text: refund,
  },
  {
    slug: "membership-policy",
    path: "/membership-policy",
    title: "Membership Policy",
    summary: "How Glow memberships bill, how credits work, and how to pause or cancel with 14 days’ notice.",
    text: membership,
  },
  {
    slug: "disclaimer",
    path: "/disclaimer",
    title: "Disclaimer",
    summary: "The limits of the information on our websites and of our liability.",
    text: disclaimer,
  },
];

export function getPolicy(slug: PolicySlug): Policy {
  const policy = POLICIES.find((p) => p.slug === slug);
  if (!policy) throw new Error(`Unknown policy: ${slug}`);
  return policy;
}
