"use client";

import { ReactNode, useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';

interface DomainRouterProps {
  children: ReactNode;
}

export function DomainRouter({ children }: DomainRouterProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [hostname, setHostname] = useState('');
  const [hasRouted, setHasRouted] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setHostname(window.location.hostname);
    }
  }, []);

  useEffect(() => {
    if (!hostname || hasRouted) return;

    const isAppDomain = hostname === 'app.novaracleaning.com' || hostname.startsWith('app.');
    const isAdminDomain = hostname === 'admin.novaracleaning.com' || hostname.startsWith('admin.');
    const isContractorDomain = hostname === 'contractor.novaracleaning.com' || hostname.startsWith('contractor.');
    const isCleanerDomain = hostname === 'cleaner.novaracleaning.com' || hostname.startsWith('cleaner.');

    // Route based on subdomain when on root path
    if (pathname === '/') {
      if (isAppDomain) {
        setHasRouted(true);
        router.replace('/auth');
        return;
      } else if (isAdminDomain) {
        setHasRouted(true);
        router.replace('/admin/auth');
        return;
      } else if (isContractorDomain || isCleanerDomain) {
        setHasRouted(true);
        router.replace('/cleaner/auth');
        return;
      }
    }

    // Restrict customer portal routes on admin/cleaner domains
    if (isAdminDomain && !pathname.startsWith('/admin')) {
      setHasRouted(true);
      router.replace('/admin/auth');
      return;
    }

    if ((isContractorDomain || isCleanerDomain) && !pathname.startsWith('/cleaner')) {
      setHasRouted(true);
      router.replace('/cleaner/auth');
      return;
    }

    // Restrict admin/cleaner routes on app domain
    if (isAppDomain) {
      if (pathname.startsWith('/admin')) {
        setHasRouted(true);
        router.replace('/auth');
        return;
      }
      if (pathname.startsWith('/cleaner')) {
        setHasRouted(true);
        router.replace('/auth');
        return;
      }
    }
  }, [hostname, pathname, router, hasRouted]);

  return <>{children}</>;
}

export function useDomainContext() {
  const [hostname, setHostname] = useState('');

  useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

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
    portalType: isAppDomain ? 'customer' : 
                isAdminDomain ? 'admin' : 
                isContractorDomain ? 'contractor' : 
                isTryDomain ? 'booking' : 'default'
  };
}
