"use client";

import {
  RiLoader4Line
} from "@remixicon/react";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";

import { toast } from "sonner";

interface ProtectedRouteProps {
  children: React.ReactNode;
  requiredRole?: string;
}

export const ProtectedRoute = ({ children, requiredRole = "admin" }: ProtectedRouteProps) => {
  const router = useRouter();
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const checkAuthorization = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError || !session) {
          setIsAuthorized(false);
          setIsLoading(false);
          return;
        }

        // Admin-portal pages accept both `admin` and `va` (virtual
        // assistant) roles. VAs operate the same console; the matching RLS
        // policies were added in the va_admin_portal_access migration.
        // Any other requiredRole falls back to a strict has_role check.
        const { data, error } =
          requiredRole === "admin"
            ? await (supabase.rpc as any)("is_admin_or_va", {
                _uid: session.user.id,
              })
            : await (supabase.rpc as any)("has_role", {
                _user_id: session.user.id,
                _role: requiredRole,
              });

        if (error) {
          console.error('Error checking role:', error);
          setIsAuthorized(false);
        } else {
          setIsAuthorized(data === true);
          if (data !== true) {
            toast.error("Access Denied", {
              description: "You don't have permission to access this page."
            });
          }
        }
      } catch (error) {
        console.error('Authorization check failed:', error);
        setIsAuthorized(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuthorization();
  }, [requiredRole]);

  useEffect(() => {
    if (!isLoading && !isAuthorized) {
      router.replace('/admin/auth');
    }
  }, [isLoading, isAuthorized, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
        <div className="text-center space-y-4">
          <RiLoader4Line className="w-12 h-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Verifying permissions...</p>
        </div>
      </div>
    );
  }

  if (!isAuthorized) {
    return null;
  }

  return <>{children}</>;
};
