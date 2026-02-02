"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";
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

        const { data, error } = await supabase.rpc('has_role', {
          _user_id: session.user.id,
          _role: requiredRole as any
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
      router.push("/");
    }
  }, [isLoading, isAuthorized, router]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-hero flex items-center justify-center">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
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
