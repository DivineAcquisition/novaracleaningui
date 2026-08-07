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
  // Where to send an unauthorized user. VAs who hit an admin-only page are
  // bounced back into the console (they DO have portal access) rather than to
  // the sign-in screen.
  const [redirectTo, setRedirectTo] = useState<string>("/admin/auth");

  useEffect(() => {
    const checkAuthorization = async () => {
      try {
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        
        if (sessionError || !session) {
          setRedirectTo("/admin/auth");
          setIsAuthorized(false);
          setIsLoading(false);
          return;
        }

        // Admin console is Novara-domain only. Personal emails (gmail, etc.)
        // never get portal access even if a stale role row exists.
        const email = String(session.user.email || "").trim().toLowerCase();
        if (!email.endsWith("@novaracleaning.com")) {
          setRedirectTo("/admin/auth");
          setIsAuthorized(false);
          toast.error("Access Denied", {
            description: "Use your @novaracleaning.com email to access the admin workspace.",
          });
          return;
        }

        // Admin-portal pages accept both `admin` and `va` (virtual
        // assistant) roles. VAs operate the same console; the matching RLS
        // policies were added in the va_admin_portal_access migration.
        //
        //   • "admin"        → admin OR va (default admin-console access)
        //   • "admin_strict" → FULL admin only; VAs are blocked and bounced
        //                      back to the dashboard (finance, roles, and
        //                      commercial surfaces use this)
        //   • anything else  → strict has_role check for that role
        if (requiredRole === "admin_strict") {
          const { data: isAdmin, error } = await (supabase.rpc as any)("has_role", {
            _user_id: session.user.id,
            _role: "admin",
          });
          if (error) {
            console.error('Error checking role:', error);
            setRedirectTo("/admin/auth");
            setIsAuthorized(false);
          } else if (isAdmin === true) {
            setIsAuthorized(true);
          } else {
            // Distinguish a VA (has console access, wrong page) from someone
            // with no access at all so the redirect target is sensible.
            const { data: hasPortal } = await (supabase.rpc as any)("is_admin_or_va", {
              _uid: session.user.id,
            });
            setRedirectTo(hasPortal === true ? "/admin/dashboard" : "/admin/auth");
            setIsAuthorized(false);
            toast.error("Admins only", {
              description: "This section is restricted to admins.",
            });
          }
          return;
        }

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
          setRedirectTo("/admin/auth");
          setIsAuthorized(false);
        } else {
          setIsAuthorized(data === true);
          if (data !== true) {
            setRedirectTo("/admin/auth");
            toast.error("Access Denied", {
              description: "You don't have permission to access this page."
            });
          }
        }
      } catch (error) {
        console.error('Authorization check failed:', error);
        setRedirectTo("/admin/auth");
        setIsAuthorized(false);
      } finally {
        setIsLoading(false);
      }
    };

    checkAuthorization();
  }, [requiredRole]);

  useEffect(() => {
    if (!isLoading && !isAuthorized) {
      router.replace(redirectTo);
    }
  }, [isLoading, isAuthorized, redirectTo, router]);

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
