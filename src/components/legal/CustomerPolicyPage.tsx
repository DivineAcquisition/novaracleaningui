// A customer policy page (/terms, /privacy, …) with the main site's header
// and footer, plus cards for the other customer policies.

import type { Metadata } from "next";
import { SiteHeader } from "@/components/landing/Chrome";
import { SiteFooter } from "@/components/landing/Footer";
import { POLICIES, POLICY_UPDATED, getPolicy, type PolicySlug } from "@/content/legal";
import { TRY_URL } from "@/lib/landing/links";
import { LegalPage } from "./LegalPage";

export function customerPolicyMetadata(slug: PolicySlug): Metadata {
  const p = getPolicy(slug);
  return {
    title: { absolute: `${p.title} | Novara Cleaning` },
    description: p.summary,
    alternates: { canonical: `https://novaracleaning.com${p.path}` },
  };
}

export function CustomerPolicyPage({ slug }: { slug: PolicySlug }) {
  const p = getPolicy(slug);
  return (
    <LegalPage
      eyebrow="Novara Cleaning LLC · Policies"
      title={p.title}
      summary={p.summary}
      updated={POLICY_UPDATED}
      text={p.text}
      related={POLICIES.filter((o) => o.slug !== slug).map((o) => ({ title: o.title, href: o.path, summary: o.summary }))}
      header={<SiteHeader withMenus bookHref={TRY_URL} />}
      footer={<SiteFooter />}
    />
  );
}
