"use client";

import { ReactNode, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface DomainRouterProps {
  children: ReactNode;
}

/**
 * Routes users based on the subdomain they're accessing:
 * - app.novaracleaning.com -> Customer portal (redirects to /auth if on home)
 * - admin.novaracleaning.com -> Admin portal (redirects to /admin/auth if on home)
 * - contractor.novaracleaning.com -> Cleaner portal
 * - try.novaracleaning.com -> Booking flow (no redirect)
 */
export function DomainRouter({ children }: DomainRouterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';

  useEffect(() => {
    // Only redirect on the root path
    if (pathname !== '/') return;

    // Check subdomain
    const isAppDomain = hostname === 'app.novaracleaning.com';
    const isAdminDomain = hostname === 'admin.novaracleaning.com';
    const isContractorDomain = hostname === 'contractor.novaracleaning.com';

    if (isAppDomain) {
      // Customer portal - redirect to auth/account
      router.replace('/auth');
    } else if (isAdminDomain) {
      // Admin portal - redirect to admin auth
      router.replace('/admin/auth');
    } else if (isContractorDomain) {
      // Contractor/cleaner portal - redirect to cleaner auth
      router.replace('/cleaner/auth');
    }
    // For other domains (try.novaracleaning.com, localhost), show normal home page
  }, [hostname, pathname, router]);

  return <>{children}</>;
}

/**
 * Hook to get current domain context
 */
export function useDomainContext() {
  const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
  
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
