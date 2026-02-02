"use client";

import { ReactNode, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, ExternalLink } from 'lucide-react';

interface DomainRestrictedProps {
  children: ReactNode;
  allowedDomains: string[];
  redirectTo?: string;
  fallbackMessage?: string;
}

export function DomainRestricted({ 
  children, 
  allowedDomains, 
  redirectTo,
  fallbackMessage = "This page is not available on this domain."
}: DomainRestrictedProps) {
  const router = useRouter();
  const [isAllowed, setIsAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const currentHostname = window.location.hostname;
    
    const isDevelopment = currentHostname === 'localhost' || 
                          currentHostname === '127.0.0.1' ||
                          currentHostname.includes('localhost');
    
    const allowed = isDevelopment || 
                    allowedDomains.some(domain => 
                      currentHostname === domain || 
                      currentHostname.endsWith(`.${domain}`)
                    );
    
    setIsAllowed(allowed);

    if (!allowed && redirectTo) {
      if (redirectTo.startsWith('http')) {
        window.location.href = redirectTo;
      } else {
        router.replace(redirectTo);
      }
    }
  }, [allowedDomains, redirectTo, router]);

  if (isAllowed === null) {
    return null; // Loading
  }

  if (isAllowed) {
    return <>{children}</>;
  }

  if (redirectTo) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-hero flex items-center justify-center px-4">
      <Card className="max-w-md w-full shadow-xl border-destructive/20">
        <CardHeader className="text-center">
          <div className="mx-auto w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
            <AlertCircle className="w-8 h-8 text-destructive" />
          </div>
          <CardTitle className="text-2xl">Access Restricted</CardTitle>
          <CardDescription className="text-base">
            {fallbackMessage}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-4">
          <p className="text-sm text-muted-foreground">
            To book a cleaning, please visit our booking site:
          </p>
          <Button 
            onClick={() => window.location.href = 'https://try.novaracleaning.com/book/zip'}
            className="w-full"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            Go to Booking Site
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export function withDomainRestriction(
  Component: React.ComponentType,
  allowedDomains: string[],
  options?: { redirectTo?: string; fallbackMessage?: string }
) {
  return function DomainRestrictedComponent() {
    return (
      <DomainRestricted 
        allowedDomains={allowedDomains}
        redirectTo={options?.redirectTo}
        fallbackMessage={options?.fallbackMessage}
      >
        <Component />
      </DomainRestricted>
    );
  };
}
