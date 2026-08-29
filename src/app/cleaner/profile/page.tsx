"use client";

import { ContractorLayout } from "@/components/contractor/ContractorLayout";
import Profile from "@/views/cleaner/Profile";

export default function Page() {
  return (
    <ContractorLayout>
      <Profile />
    </ContractorLayout>
  );
}

export const dynamic = "force-dynamic";
