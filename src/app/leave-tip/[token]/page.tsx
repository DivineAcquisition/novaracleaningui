import { Suspense } from "react";
import TipInvite from "@/views/TipInvite";

export default function Page({ params }: { params: { token: string } }) {
  return (
    <Suspense>
      <TipInvite token={params.token} />
    </Suspense>
  );
}

export const dynamic = "force-dynamic";
