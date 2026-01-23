import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";

/**
 * SubdomainRouter - Handles subdomain-based routing
 * 
 * Detects subdomains and redirects to appropriate pages:
 * - admin.* -> /admin/va-sales (VA Sales Form)
 * - cleaner.* -> /cleaner/auth (Cleaner Portal)
 */
export function SubdomainRouter({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const hostname = window.location.hostname;
    const pathname = location.pathname;

    // Extract subdomain
    // Handle cases like: admin.novaracleaning.com, admin.localhost, etc.
    const parts = hostname.split('.');
    const subdomain = parts.length > 2 ? parts[0] : 
                      (parts.length === 2 && parts[1] !== 'com' && parts[1] !== 'localhost') ? parts[0] : 
                      null;

    // Also check for localhost with port for development
    // e.g., admin.localhost:3000
    const isLocalDev = hostname.includes('localhost') || hostname.includes('127.0.0.1');
    
    // For production domains like admin.novaracleaning.com
    const isAdminSubdomain = subdomain === 'admin' || 
                             hostname.startsWith('admin.') ||
                             hostname === 'admin.novaracleaning.com';
    
    const isCleanerSubdomain = subdomain === 'cleaner' || 
                               hostname.startsWith('cleaner.') ||
                               hostname === 'cleaner.novaracleaning.com';

    // Only redirect if we're on the root path and haven't already redirected
    if (pathname === '/' || pathname === '') {
      if (isAdminSubdomain) {
        navigate('/admin/va-sales', { replace: true });
        return;
      }
      
      if (isCleanerSubdomain) {
        navigate('/cleaner/auth', { replace: true });
        return;
      }
    }

    // For admin subdomain, also handle paths that don't start with /admin
    if (isAdminSubdomain && !pathname.startsWith('/admin')) {
      // Allow auth-related paths
      if (pathname.startsWith('/auth') || pathname.startsWith('/reset-password') || pathname.startsWith('/update-password')) {
        return;
      }
      // Redirect other paths to admin
      navigate('/admin/va-sales', { replace: true });
      return;
    }

    // For cleaner subdomain, handle paths that don't start with /cleaner
    if (isCleanerSubdomain && !pathname.startsWith('/cleaner')) {
      // Allow auth-related paths
      if (pathname.startsWith('/auth') || pathname.startsWith('/reset-password') || pathname.startsWith('/update-password')) {
        return;
      }
      // Redirect other paths to cleaner portal
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
 * Hook to check if current subdomain is cleaner
 */
export function useIsCleanerSubdomain(): boolean {
  const hostname = window.location.hostname;
  return hostname.startsWith('cleaner.') || hostname === 'cleaner.novaracleaning.com';
}
