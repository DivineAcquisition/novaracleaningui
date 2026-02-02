import { ReactNode, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface DomainRouterProps {
  children: ReactNode;
}

/**
 * Routes users based on the subdomain they're accessing:
 * - app.novaracleaning.com → Customer portal (redirects to /auth if on home)
 * - admin.novaracleaning.com → Admin portal (redirects to /admin/auth if on home)
 * - contractor.novaracleaning.com → Cleaner portal
 * - try.novaracleaning.com → Booking flow (no redirect)
 */
export function DomainRouter({ children }: DomainRouterProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const hostname = window.location.hostname;

  useEffect(() => {
    // Only redirect on the root path
    if (location.pathname !== '/') return;

    // Check subdomain
    const isAppDomain = hostname === 'app.novaracleaning.com';
    const isAdminDomain = hostname === 'admin.novaracleaning.com';
    const isContractorDomain = hostname === 'contractor.novaracleaning.com';

    if (isAppDomain) {
      // Customer portal - redirect to auth/account
      navigate('/auth', { replace: true });
    } else if (isAdminDomain) {
      // Admin portal - redirect to admin auth
      navigate('/admin/auth', { replace: true });
    } else if (isContractorDomain) {
      // Contractor/cleaner portal - redirect to cleaner auth
      navigate('/cleaner/auth', { replace: true });
    }
    // For other domains (try.novaracleaning.com, localhost), show normal home page
  }, [hostname, location.pathname, navigate]);

  return <>{children}</>;
}

/**
 * Hook to get current domain context
 */
export function useDomainContext() {
  const hostname = window.location.hostname;
  
  const isLocalhost = hostname === 'localhost' || 
                      hostname === '127.0.0.1' ||
                      hostname.includes('localhost');
  
  const isAppDomain = hostname === 'app.novaracleaning.com';
  const isAdminDomain = hostname === 'admin.novaracleaning.com';
  const isContractorDomain = hostname === 'contractor.novaracleaning.com';
  const isTryDomain = hostname === 'try.novaracleaning.com';

  return {
    hostname,
    isLocalhost,
    isAppDomain,
    isAdminDomain,
    isContractorDomain,
    isTryDomain,
    // Determine portal type
    portalType: isAppDomain ? 'customer' : 
                isAdminDomain ? 'admin' : 
                isContractorDomain ? 'contractor' : 
                isTryDomain ? 'booking' : 'default'
  };
}
