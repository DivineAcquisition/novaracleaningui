import { Suspense } from "react";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import ChecklistView from "@/views/Checklist";
import {
  CHECKLISTS,
  CHECKLIST_SLUGS,
  getChecklist,
  type ChecklistSlug,
} from "@/lib/checklists";

// Pre-render known checklist routes at build time (homes + commercial).
export function generateStaticParams() {
  return CHECKLIST_SLUGS.map((slug) => ({ slug }));
}

export function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Metadata {
  const c = getChecklist(params.slug);
  if (!c) return { title: "Checklist not found" };
  return {
    title: `${c.name} Checklist | Novara Cleaning`,
    description: c.tagline,
    alternates: {
      canonical: `https://novaracleaning.com/checklist/${c.slug}`,
    },
  };
}

export default function Page({ params }: { params: { slug: string } }) {
  const checklist = CHECKLISTS[params.slug as ChecklistSlug];
  if (!checklist) notFound();
  return (
    <Suspense>
      <ChecklistView checklist={checklist} />
    </Suspense>
  );
}
