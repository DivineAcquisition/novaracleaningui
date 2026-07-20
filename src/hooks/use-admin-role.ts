"use client";

// ─── useAdminRole ───────────────────────────────────────────────────────
//
// Resolves the CURRENT signed-in user's admin-console role on the client so
// the UI can hide surfaces a VA should not see. This is a UX/least-surprise
// layer only — the source of truth is still server-side (requireAdmin, edge
// function role checks, and RLS). Never rely on this alone to protect data.
//
// The admin console is reachable by both `admin` and `va` roles. We only need
// to know whether the user is a FULL admin; anyone who reached the console but
// isn't a full admin is treated as a VA.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AdminRole = "admin" | "va" | null;

export interface AdminRoleState {
  role: AdminRole;
  isAdmin: boolean;
  isVa: boolean;
  loading: boolean;
}

export function useAdminRole(): AdminRoleState {
  const [role, setRole] = useState<AdminRole>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          if (active) setRole(null);
          return;
        }
        // has_role is SECURITY DEFINER and safe to call for the caller's own
        // id. A full admin → "admin"; otherwise (already gated to admin-or-va
        // by ProtectedRoute) they are a VA.
        const { data: isAdmin } = await (supabase.rpc as any)("has_role", {
          _user_id: session.user.id,
          _role: "admin",
        });
        if (active) setRole(isAdmin === true ? "admin" : "va");
      } catch {
        if (active) setRole(null);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return { role, isAdmin: role === "admin", isVa: role === "va", loading };
}
