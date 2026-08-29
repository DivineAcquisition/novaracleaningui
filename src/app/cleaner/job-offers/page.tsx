"use client";

import { ContractorLayout } from "@/components/contractor/ContractorLayout";
import JobOffersList from "@/views/cleaner/JobOffersList";

export default function Page() {
  return (
    <ContractorLayout>
      <JobOffersList />
    </ContractorLayout>
  );
}

export const dynamic = "force-dynamic";
