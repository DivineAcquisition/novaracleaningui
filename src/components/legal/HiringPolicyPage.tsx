// A hiring policy page (hiring.novaracleaning.com/policies/...) with the
// careers site header and footer, plus cards for the other hiring policies.

import type { Metadata } from "next";
import { HiringFooter, HiringNav, HiringShell } from "@/components/hiring/HiringChrome";
import { HIRING_POLICIES, HIRING_POLICY_UPDATED, type HiringPolicy } from "@/content/hiring-policies";
import { LegalPage } from "./LegalPage";

export const HIRING_POLICY_BASE = "/hiring/policies";

export function hiringPolicyHref(slug: string): string {
  return `${HIRING_POLICY_BASE}/${slug}`;
}

export function hiringPolicyMetadata(p: HiringPolicy): Metadata {
  return {
    title: { absolute: `${p.title} | Novara Cleaning Careers` },
    description: p.summary,
    alternates: { canonical: `https://hiring.novaracleaning.com/policies/${p.slug}` },
  };
}

export function HiringPolicyPage({ policy }: { policy: HiringPolicy }) {
  return (
    <HiringShell>
      <LegalPage
        eyebrow="Novara Cleaning careers · Policies"
        title={policy.title}
        summary={policy.summary}
        updated={HIRING_POLICY_UPDATED}
        text={policy.text}
        related={HIRING_POLICIES.filter((o) => o.slug !== policy.slug).map((o) => ({
          title: o.title,
          href: hiringPolicyHref(o.slug),
          summary: o.summary,
        }))}
        header={<HiringNav ctaHref="/hiring#positions" ctaLabel="Open roles" />}
        footer={<HiringFooter />}
      />
    </HiringShell>
  );
}
