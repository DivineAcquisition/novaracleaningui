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

  useEffect(() => {
    setHostname(window.location.hostname);
  }, []);

  useEffect(() => {
    if (!hostname || pathname !== '/') return;

    const isAppDomain = hostname === 'app.novaracleaning.com';
    const isAdminDomain = hostname === 'admin.novaracleaning.com';
    const isContractorDomain = hostname === 'contractor.novaracleaning.com';

    if (isAppDomain) {
      router.replace('/auth');
    } else if (isAdminDomain) {
      router.replace('/admin/auth');
    } else if (isContractorDomain) {
      router.replace('/cleaner/auth');
    }
  }, [hostname, pathname, router]);

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
