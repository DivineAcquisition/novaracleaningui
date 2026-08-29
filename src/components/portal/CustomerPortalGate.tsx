"use client";

import { PortalLayout } from "@/components/portal/PortalLayout";
import { useAuth } from "@/contexts/AuthContext";

/** Signed-in customers get the account shell; logged-out visitors see the public page. */
export function CustomerPortalGate({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!user) return <>{children}</>;
  return <PortalLayout>{children}</PortalLayout>;
}
