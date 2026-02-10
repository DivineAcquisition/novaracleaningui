"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

export function ClientRedirect({ to }: { to: string }) {
  const router = useRouter();
  useEffect(() => {
    if (to.startsWith("http")) {
      window.location.href = to;
    } else {
      router.replace(to);
    }
  }, [to, router]);
  return null;
}
