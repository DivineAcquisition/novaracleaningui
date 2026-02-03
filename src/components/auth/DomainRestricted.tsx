import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, ExternalLink, Home, ArrowRight } from 'lucide-react';
import { useDomainContext } from './DomainRouter';

interface DomainRestrictedProps {
  children: ReactNode;
  allowedDomains: string[];
  redirectTo?: string;
  fallbackMessage?: string;
  portalType?: 'booking' | 'customer' | 'admin' | 'contractor';
}

/**
 * Restricts access to children components based on the current domain.
 * Used to ensure routes are only accessible from their designated domains.
 */
export function DomainRestricted({ 
  children, 
  allowedDomains, 
  redirectTo,
  fallbackMessage,
  portalType
}: DomainRestrictedProps) {
  const { isDev, hostname, getPortalUrl } = useDomainContext();
  
  // Allow localhost for development
  const isAllowed = isDev || 
                    allowedDomains.some(domain => 
                      hostname === domain || 
                      hostname.endsWith(`.${domain}`)
                    );
  
  if (isAllowed) {
    return <>{children}</>;
  }

  // If redirectTo is specified, redirect
  if (redirectTo) {
    // For external redirects to different domains
    if (redirectTo.startsWith('http')) {
      window.location.href = redirectTo;
      return null;
    }
    return <Navigate to={redirectTo} replace />;
  }

  // Determine correct portal link based on portal type
  const getCorrectPortalLink = () => {
    switch (portalType) {
      case 'booking':
        return { url: 'https://try.novaracleaning.com/book/zip', label: 'Go to Booking Site' };
      case 'customer':
        return { url: 'https://app.novaracleaning.com/auth', label: 'Go to Customer Portal' };
      case 'admin':
        return { url: 'https://admin.novaracleaning.com/admin/auth', label: 'Go to Admin Portal' };
      case 'contractor':
        return { url: 'https://contractor.novaracleaning.com/cleaner', label: 'Go to Contractor Portal' };
      default:
        return { url: 'https://try.novaracleaning.com', label: 'Go to Main Site' };
    }
  };

  const portalLink = getCorrectPortalLink();

  // Default message based on domain
  const getMessage = () => {
    if (fallbackMessage) return fallbackMessage;
    
    const domainMessages: Record<string, string> = {
      'try.novaracleaning.com': 'This page is only available on our booking site.',
      'app.novaracleaning.com': 'This page is only available on the customer portal.',
      'admin.novaracleaning.com': 'This page is only available on the admin portal.',
      'contractor.novaracleaning.com': 'This page is only available on the contractor portal.',
    };
    
    return allowedDomains.length > 0 
      ? domainMessages[allowedDomains[0]] || 'This page is not available on this domain.'
      : 'This page is not available on this domain.';
  };

  // Show access denied UI
  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <Card className="max-w-sm w-full border border-destructive/20 shadow-lg">
        <CardHeader className="text-center pb-4">
          <div className="mx-auto w-14 h-14 bg-destructive/10 rounded-xl flex items-center justify-center mb-3 border border-destructive/20">
            <AlertCircle className="w-7 h-7 text-destructive" />
          </div>
          <CardTitle className="text-xl">Access Restricted</CardTitle>
          <CardDescription className="text-sm">
            {getMessage()}
          </CardDescription>
        </CardHeader>
        <CardContent className="text-center space-y-3 pb-5">
          <Button 
            onClick={() => window.location.href = portalLink.url}
            className="w-full h-10 text-sm border border-primary/20"
          >
            <ExternalLink className="w-4 h-4 mr-2" />
            {portalLink.label}
          </Button>
          
          <Button
            variant="ghost"
            onClick={() => window.history.back()}
            className="w-full h-9 text-xs border border-border"
          >
            <ArrowRight className="w-3 h-3 mr-1.5 rotate-180" />
            Go Back
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
  options?: { 
    redirectTo?: string; 
    fallbackMessage?: string;
    portalType?: 'booking' | 'customer' | 'admin' | 'contractor';
  }
) {
  return function DomainRestrictedComponent() {
    return (
      <DomainRestricted 
        allowedDomains={allowedDomains}
        redirectTo={options?.redirectTo}
        fallbackMessage={options?.fallbackMessage}
        portalType={options?.portalType}
      >
        <Component />
      </DomainRestricted>
    );
  };
}

/**
 * Utility to check if current domain matches any in the list
 */
export function isDomainAllowed(allowedDomains: string[]): boolean {
  const hostname = window.location.hostname;
  const isDev = hostname === 'localhost' || 
                hostname === '127.0.0.1' ||
                hostname.includes('localhost');
  
  if (isDev) return true;
  
  return allowedDomains.some(domain => 
    hostname === domain || 
    hostname.endsWith(`.${domain}`)
  );
}
