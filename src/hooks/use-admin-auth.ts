"use client";

import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { useRouter } from "next/navigation";

type AdminRole = "admin" | "customer";

interface UseAdminAuthReturn {
  isAdmin: boolean;
  isLoading: boolean;
  userRole: AdminRole | null;
  checkAdminAccess: () => Promise<boolean>;
}

export function useAdminAuth(): UseAdminAuthReturn {
  const { user, session } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [userRole, setUserRole] = useState<AdminRole | null>(null);
  const router = useRouter();

  const checkAdminAccess = useCallback(async (): Promise<boolean> => {
    if (!user || !session) {
      setIsAdmin(false);
      setUserRole(null);
      setIsLoading(false);
      return false;
    }

    try {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .single();

      if (error) {
        console.error("Error checking admin role:", error);
        setIsAdmin(false);
        setUserRole(null);
        setIsLoading(false);
        return false;
      }

      const role = data?.role as AdminRole;
      const adminAccess = role === "admin";
      
      setUserRole(role);
      setIsAdmin(adminAccess);
      setIsLoading(false);
      
      return adminAccess;
    } catch (err) {
      console.error("Error checking admin access:", err);
      setIsAdmin(false);
      setUserRole(null);
      setIsLoading(false);
      return false;
    }
  }, [user, session]);

  useEffect(() => {
    checkAdminAccess();
  }, [checkAdminAccess]);

  return {
    isAdmin,
    isLoading,
    userRole,
    checkAdminAccess,
  };
}
