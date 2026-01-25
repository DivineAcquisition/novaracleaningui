// Subdomain detection and configuration

export type SubdomainType = 'admin' | 'contractor' | 'try' | 'app' | 'hiring' | 'main';

export const getSubdomain = (): SubdomainType => {
  const hostname = window.location.hostname;
  
  // Local development - check for query param or default to main
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    const params = new URLSearchParams(window.location.search);
    const subdomain = params.get('subdomain');
    if (subdomain === 'admin') return 'admin';
    if (subdomain === 'contractor') return 'contractor';
    if (subdomain === 'try') return 'try';
    if (subdomain === 'app') return 'app';
    if (subdomain === 'hiring') return 'hiring';
    return 'main';
  }
  
  // Production subdomain detection
  if (hostname.startsWith('admin.')) return 'admin';
  if (hostname.startsWith('contractor.') || hostname.startsWith('cleaner.')) return 'contractor';
  if (hostname.startsWith('try.') || hostname.startsWith('book.')) return 'try';
  if (hostname.startsWith('app.')) return 'app';
  if (hostname.startsWith('hiring.') || hostname.startsWith('careers.') || hostname.startsWith('jobs.')) return 'hiring';
  
  return 'main';
};

// Get the subdomain once at app initialization
export const CURRENT_SUBDOMAIN = getSubdomain();

// Helper to check current subdomain
export const isSubdomain = (subdomain: SubdomainType): boolean => {
  return CURRENT_SUBDOMAIN === subdomain;
};

// Subdomain configuration
export const SUBDOMAIN_CONFIG = {
  admin: {
    title: 'Novara Admin',
    description: 'Admin & VA Portal',
    defaultRoute: '/admin/cleaners',
    authRoute: '/auth',
  },
  contractor: {
    title: 'Novara Contractor Portal',
    description: 'Cleaner & Contractor Portal',
    defaultRoute: '/cleaner/auth',
    authRoute: '/cleaner/auth',
  },
  try: {
    title: 'Book Novara Cleaning',
    description: 'Premium Cleaning Services',
    defaultRoute: '/book/zip',
    authRoute: '/auth',
  },
  app: {
    title: 'Novara Customer Portal',
    description: 'Manage Your Cleanings',
    defaultRoute: '/account',
    authRoute: '/auth',
  },
  hiring: {
    title: 'Careers at Novara',
    description: 'Join Our Team',
    defaultRoute: '/',
    authRoute: '/apply',
  },
  main: {
    title: 'Novara Cleaning',
    description: 'Premium Cleaning Services',
    defaultRoute: '/',
    authRoute: '/auth',
  },
} as const;
