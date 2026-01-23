import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

/**
 * SubdomainRouter - Handles subdomain-based routing
 * 
 * Detects subdomains and redirects to appropriate pages:
 * - admin.* -> /admin/va-sales (VA Sales Form)
 * - contractor.* -> /cleaner/auth (Contractor Portal)
 */
export function SubdomainRouter({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const hostname = window.location.hostname;
    const pathname = location.pathname;

    // For production domains
    const isAdminSubdomain = hostname.startsWith('admin.') ||
                             hostname === 'admin.novaracleaning.com';
    
    const isContractorSubdomain = hostname.startsWith('contractor.') ||
                                   hostname === 'contractor.novaracleaning.com';

    // Only redirect if we're on the root path
    if (pathname === '/' || pathname === '') {
      if (isAdminSubdomain) {
        navigate('/admin/va-sales', { replace: true });
        return;
      }
      
      if (isContractorSubdomain) {
        navigate('/cleaner/auth', { replace: true });
        return;
      }
    }

    // For admin subdomain, redirect non-admin paths to admin
    if (isAdminSubdomain && !pathname.startsWith('/admin')) {
      // Allow auth-related paths
      if (pathname.startsWith('/auth') || pathname.startsWith('/reset-password') || pathname.startsWith('/update-password')) {
        return;
      }
      navigate('/admin/va-sales', { replace: true });
      return;
    }

    // For contractor subdomain, redirect non-cleaner paths to cleaner portal
    if (isContractorSubdomain && !pathname.startsWith('/cleaner')) {
      // Allow auth-related paths
      if (pathname.startsWith('/auth') || pathname.startsWith('/reset-password') || pathname.startsWith('/update-password')) {
        return;
      }
      navigate('/cleaner/auth', { replace: true });
      return;
    }
  }, [location.pathname, navigate]);

  return <>{children}</>;
}

/**
 * Hook to check if current subdomain is admin
 */
export function useIsAdminSubdomain(): boolean {
  const hostname = window.location.hostname;
  return hostname.startsWith('admin.') || hostname === 'admin.novaracleaning.com';
}

/**
 * Hook to check if current subdomain is contractor
 */
export function useIsContractorSubdomain(): boolean {
  const hostname = window.location.hostname;
  return hostname.startsWith('contractor.') || hostname === 'contractor.novaracleaning.com';
}
