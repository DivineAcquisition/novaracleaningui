import { ReactNode, useEffect, useMemo } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';

interface DomainRouterProps {
  children: ReactNode;
}

// Define allowed routes per domain
const DOMAIN_ROUTES: Record<string, { allowed: RegExp[]; redirect: string; name: string }> = {
  'try.novaracleaning.com': {
    name: 'Booking',
    allowed: [
      /^\/$/,           // Home page (landing)
      /^\/book(\/.*)?$/, // All booking routes
      /^\/demo$/,        // Demo page
    ],
    redirect: '/book/zip',
  },
  'app.novaracleaning.com': {
    name: 'Customer Portal',
    allowed: [
      /^\/$/,              // Home (redirects to auth)
      /^\/auth(\/.*)?$/,   // Customer auth
      /^\/account$/,       // Customer account
      /^\/membership$/,    // Membership management
      /^\/reset-password$/, // Password reset
      /^\/update-password$/, // Password update
      /^\/portal(\/.*)?$/,  // Customer portal routes (member booking)
      /^\/sms-consent$/,    // SMS consent
    ],
    redirect: '/auth',
  },
  'admin.novaracleaning.com': {
    name: 'Admin Portal',
    allowed: [
      /^\/$/,              // Home (redirects to admin auth)
      /^\/admin(\/.*)?$/,  // All admin routes
    ],
    redirect: '/admin/auth',
  },
  'contractor.novaracleaning.com': {
    name: 'Contractor Portal',
    allowed: [
      /^\/$/,              // Home (redirects to cleaner onboarding)
      /^\/cleaner(\/.*)?$/, // All cleaner routes
    ],
    redirect: '/cleaner',
  },
};

// Development/localhost allows all routes
const DEV_HOSTNAMES = ['localhost', '127.0.0.1'];

/**
 * Strict Domain Router - enforces domain-specific route access
 * 
 * Domain architecture:
 * - try.novaracleaning.com → Public booking flow ONLY
 * - app.novaracleaning.com → Customer portal ONLY (auth, account, membership)
 * - admin.novaracleaning.com → Admin portal ONLY
 * - contractor.novaracleaning.com → Cleaner/contractor portal ONLY
 * 
 * Each domain is isolated and cannot access routes from other domains.
 */
export function DomainRouter({ children }: DomainRouterProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const hostname = window.location.hostname;

  const domainConfig = useMemo(() => {
    // Check if development environment
    const isDev = DEV_HOSTNAMES.some(h => hostname.includes(h));
    if (isDev) return null; // No restrictions in development
    
    // Find matching domain config
    return DOMAIN_ROUTES[hostname] || null;
  }, [hostname]);

  useEffect(() => {
    // Skip if development or unknown domain
    if (!domainConfig) return;

    const currentPath = location.pathname;
    
    // Check if current path is allowed for this domain
    const isAllowed = domainConfig.allowed.some(pattern => pattern.test(currentPath));
    
    if (!isAllowed) {
      console.warn(
        `[DomainRouter] Access denied: ${currentPath} is not allowed on ${hostname}`
      );
      // Redirect to the domain's default route
      navigate(domainConfig.redirect, { replace: true });
      return;
    }

    // Handle root path redirects
    if (currentPath === '/') {
      // Don't redirect on try domain - show landing page
      if (hostname === 'try.novaracleaning.com') return;
      
      // Other domains redirect to their default
      navigate(domainConfig.redirect, { replace: true });
    }
  }, [hostname, location.pathname, navigate, domainConfig]);

  return <>{children}</>;
}

/**
 * Hook to get current domain context and utilities
 */
export function useDomainContext() {
  const hostname = window.location.hostname;
  
  const isDev = DEV_HOSTNAMES.some(h => hostname.includes(h));
  const isAppDomain = hostname === 'app.novaracleaning.com';
  const isAdminDomain = hostname === 'admin.novaracleaning.com';
  const isContractorDomain = hostname === 'contractor.novaracleaning.com';
  const isTryDomain = hostname === 'try.novaracleaning.com';

  // Determine portal type
  const portalType = isAppDomain ? 'customer' : 
                     isAdminDomain ? 'admin' : 
                     isContractorDomain ? 'contractor' : 
                     isTryDomain ? 'booking' : 'default';

  // Get the correct domain for a given portal type
  const getDomainForPortal = (portal: 'booking' | 'customer' | 'admin' | 'contractor'): string => {
    switch (portal) {
      case 'booking': return 'https://try.novaracleaning.com';
      case 'customer': return 'https://app.novaracleaning.com';
      case 'admin': return 'https://admin.novaracleaning.com';
      case 'contractor': return 'https://contractor.novaracleaning.com';
      default: return window.location.origin;
    }
  };

  // Check if a route is allowed on the current domain
  const isRouteAllowed = (path: string): boolean => {
    if (isDev) return true;
    const config = DOMAIN_ROUTES[hostname];
    if (!config) return true;
    return config.allowed.some(pattern => pattern.test(path));
  };

  // Get external link to another portal
  const getPortalUrl = (portal: 'booking' | 'customer' | 'admin' | 'contractor', path: string = ''): string => {
    if (isDev) return path;
    return `${getDomainForPortal(portal)}${path}`;
  };

  return {
    hostname,
    isDev,
    isAppDomain,
    isAdminDomain,
    isContractorDomain,
    isTryDomain,
    portalType,
    isRouteAllowed,
    getPortalUrl,
    getDomainForPortal,
  };
}

/**
 * Component to render content only on specific domains
 */
interface DomainOnlyProps {
  children: ReactNode;
  domains: ('try' | 'app' | 'admin' | 'contractor')[];
  fallback?: ReactNode;
}

export function DomainOnly({ children, domains, fallback = null }: DomainOnlyProps) {
  const { isDev, isTryDomain, isAppDomain, isAdminDomain, isContractorDomain } = useDomainContext();
  
  // Always show in development
  if (isDev) return <>{children}</>;
  
  const domainMap: Record<string, boolean> = {
    try: isTryDomain,
    app: isAppDomain,
    admin: isAdminDomain,
    contractor: isContractorDomain,
  };
  
  const isAllowed = domains.some(d => domainMap[d]);
  
  return isAllowed ? <>{children}</> : <>{fallback}</>;
}
