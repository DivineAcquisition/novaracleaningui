import { ReactNode, useEffect, useState } from "react";
import { useLocation, Navigate } from "react-router-dom";

interface DomainRouterProps {
  children: ReactNode;
}

// Routes allowed on contractor subdomain
const CONTRACTOR_ROUTES = [
  "/cleaner/auth",
  "/cleaner/reset-password",
  "/cleaner/dashboard",
  "/cleaner/mobile-dashboard",
  "/cleaner/job-offers",
  "/cleaner/availability",
  "/cleaner/profile",
  "/cleaner/onboarding-landing",
  "/cleaner/onboard",
  "/cleaner/onboarding",
  "/sms-consent",
  "/update-password",
  "/auth/callback",
];

export function isContractorDomain(): boolean {
  const hostname = window.location.hostname;
  return (
    hostname.startsWith("contractor.") ||
    hostname.includes("contractor-") ||
    hostname === "localhost" && window.location.port === "8081" // For local dev testing
  );
}

export function DomainRouter({ children }: DomainRouterProps) {
  const location = useLocation();
  const [isContractor, setIsContractor] = useState<boolean | null>(null);

  useEffect(() => {
    setIsContractor(isContractorDomain());
  }, []);

  // Still loading domain check
  if (isContractor === null) {
    return null;
  }

  // If on contractor domain, check if route is allowed
  if (isContractor) {
    const currentPath = location.pathname;
    
    // Check if current path starts with any allowed route
    const isAllowedRoute = CONTRACTOR_ROUTES.some(route => 
      currentPath === route || currentPath.startsWith(route + "/")
    );

    // If not allowed, redirect to contractor auth
    if (!isAllowedRoute) {
      // Root path on contractor domain goes to onboarding landing
      if (currentPath === "/") {
        return <Navigate to="/cleaner/onboarding-landing" replace />;
      }
      // Any other non-allowed path goes to auth
      return <Navigate to="/cleaner/auth" replace />;
    }
  }

  return <>{children}</>;
}
