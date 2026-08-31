import { Suspense } from "react";

import { AcqLandingPixel } from "@/components/AcqLandingPixel";
import IndexPage from "@/views/Index";

export default function Page() {
  return (
    <>
      <AcqLandingPixel />
      <Suspense>
        <IndexPage />
      </Suspense>
    </>
  );
}

export const dynamic = "force-dynamic";
