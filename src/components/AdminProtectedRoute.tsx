import { ReactNode, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Shield, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface AdminProtectedRouteProps {
  children: ReactNode;
}

// Allowed admin email - strictly contact@novaracleaning.com
const ALLOWED_ADMIN_EMAILS = ["contact@novaracleaning.com"];
const ALLOWED_DOMAIN = "@novaracleaning.com";

export function AdminProtectedRoute({ children }: AdminProtectedRouteProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const location = useLocation();

  useEffect(() => {
    checkAdminAuth();
  }, []);

  const isAllowedAdmin = (email: string | undefined): boolean => {
    if (!email) return false;
    return ALLOWED_ADMIN_EMAILS.includes(email.toLowerCase());
  };

  const isValidDomain = (email: string | undefined): boolean => {
    if (!email) return false;
    return email.toLowerCase().endsWith(ALLOWED_DOMAIN);
  };

  const checkAdminAuth = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setError("not_authenticated");
        setIsLoading(false);
        return;
      }

      // Check email domain
      if (!isValidDomain(user.email)) {
        setError("invalid_domain");
        await supabase.auth.signOut();
        setIsLoading(false);
        return;
      }

      // Check if email is in allowed list
      if (!isAllowedAdmin(user.email)) {
        setError("not_authorized");
        await supabase.auth.signOut();
        setIsLoading(false);
        return;
      }

      // Check admin role in database
      const { data: roleCheck, error: roleError } = await supabase
        .from("user_roles")
        .select("*")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();

      if (roleError || !roleCheck) {
        setError("no_admin_role");
        await supabase.auth.signOut();
        setIsLoading(false);
        return;
      }

      // All checks passed
      setIsAuthorized(true);
      setIsLoading(false);
    } catch (err) {
      console.error("Admin auth check error:", err);
      setError("error");
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="text-center text-white">
          <Loader2 className="w-8 h-8 animate-spin mx-auto mb-4" />
          <p className="text-slate-400">Verifying admin access...</p>
        </div>
      </div>
    );
  }

  if (error === "not_authenticated") {
    return <Navigate to="/admin/auth" state={{ from: location }} replace />;
  }

  if (error === "invalid_domain") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
        <Card className="max-w-md w-full bg-slate-800 border-slate-700">
          <CardContent className="p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="w-8 h-8 text-red-500" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Access Denied</h2>
            <p className="text-slate-400 mb-4">
              Admin access requires a @novaracleaning.com email address.
            </p>
            <Button 
              onClick={() => window.location.href = "/admin/auth"}
              className="w-full"
            >
              Return to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error === "not_authorized") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
        <Card className="max-w-md w-full bg-slate-800 border-slate-700">
          <CardContent className="p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-yellow-500/20 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-yellow-500" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Unauthorized</h2>
            <p className="text-slate-400 mb-4">
              Your email is not authorized for admin access. Only contact@novaracleaning.com can access this portal.
            </p>
            <p className="text-sm text-slate-500 mb-4">
              If you need access, please contact IT support.
            </p>
            <Button 
              onClick={() => window.location.href = "/admin/auth"}
              className="w-full"
            >
              Return to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (error === "no_admin_role") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900 p-4">
        <Card className="max-w-md w-full bg-slate-800 border-slate-700">
          <CardContent className="p-6 text-center">
            <div className="w-16 h-16 rounded-full bg-orange-500/20 flex items-center justify-center mx-auto mb-4">
              <Shield className="w-8 h-8 text-orange-500" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Missing Permissions</h2>
            <p className="text-slate-400 mb-4">
              Your account does not have admin privileges assigned. Please contact IT to have your role updated.
            </p>
            <Button 
              onClick={() => window.location.href = "/admin/auth"}
              className="w-full"
            >
              Return to Login
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!isAuthorized) {
    return <Navigate to="/admin/auth" state={{ from: location }} replace />;
  }

  return <>{children}</>;
}
