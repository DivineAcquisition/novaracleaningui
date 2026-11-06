import { notFound } from "next/navigation";
import { HiringPolicyPage, hiringPolicyMetadata } from "@/components/legal/HiringPolicyPage";
import { HIRING_POLICIES, getHiringPolicy } from "@/content/hiring-policies";

export function generateStaticParams() {
  return HIRING_POLICIES.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  const policy = getHiringPolicy(params.slug);
  return policy ? hiringPolicyMetadata(policy) : {};
}

export default function Page({ params }: { params: { slug: string } }) {
  const policy = getHiringPolicy(params.slug);
  if (!policy) notFound();
  return <HiringPolicyPage policy={policy} />;
}
