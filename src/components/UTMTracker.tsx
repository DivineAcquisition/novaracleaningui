"use client";

import { Suspense } from "react";
import { useUTMTracking } from "@/hooks/useUTMTracking";

function UTMTrackerInner() {
  // Capture UTM + landing + referrer on every navigation. The hook
  // pulls searchParams which makes the component a child of <Suspense/>
  // boundary — Next.js requires that for any client component that
  // reads search params.
  useUTMTracking();
  return null;
}

/**
 * Silent global UTM capture component. Mount it once in the root layout
 * inside a Suspense boundary so it captures attribution on the very
 * first paint and every subsequent client navigation. Renders nothing.
 */
export function UTMTracker() {
  return (
    <Suspense fallback={null}>
      <UTMTrackerInner />
    </Suspense>
  );
}

export default UTMTracker;
