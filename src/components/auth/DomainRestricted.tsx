"use client";

import { ReactNode, useEffect } from 'react';
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

/**
 * Restricts access to children components based on the current domain.
 * Used to ensure booking flow is only accessible from try.novaracleaning.com
 */
export function DomainRestricted({ 
  children, 
  allowedDomains, 
  redirectTo,
  fallbackMessage = "This page is not available on this domain."
}: DomainRestrictedProps) {
  const router = useRouter();
  const currentHostname = typeof window !== 'undefined' ? window.location.hostname : '';
  
  // Allow localhost for development
  const isDevelopment = currentHostname === 'localhost' || 
                        currentHostname === '127.0.0.1' ||
                        currentHostname.includes('localhost');
  
  // Check if current domain is allowed
  const isAllowed = isDevelopment || 
                    allowedDomains.some(domain => 
                      currentHostname === domain || 
                      currentHostname.endsWith(`.${domain}`)
                    );

  useEffect(() => {
    if (!isAllowed && redirectTo) {
      if (redirectTo.startsWith('http')) {
        window.location.href = redirectTo;
      } else {
        router.replace(redirectTo);
      }
    }
  }, [isAllowed, redirectTo, router]);
  
  if (isAllowed) {
    return <>{children}</>;
  }

  // If redirectTo is specified, show nothing while redirecting
  if (redirectTo) {
    return null;
  }

  // Show fallback message
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

/**
 * HOC version for wrapping route elements
 */
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
