// Brand configuration for email templates

export const BRAND = {
  name: 'Novara Cleaning',
  colors: {
    primary: '#5500FF',
    primaryDark: '#4400DD',
    secondary: '#8F7BFD',
    success: '#10B981',
    warning: '#F59E0B',
    danger: '#EF4444',
    gray: {
      50: '#F9FAFB',
      100: '#F3F4F6',
      200: '#E5E7EB',
      300: '#D1D5DB',
      600: '#6B7280',
      700: '#374151',
      900: '#111827',
    },
  },
  gradient: {
    primary: 'linear-gradient(135deg, #5500FF 0%, #8F7BFD 100%)',
  },
  spacing: {
    xs: '8px',
    sm: '12px',
    md: '16px',
    lg: '20px',
    xl: '30px',
  },
  borderRadius: {
    sm: '4px',
    md: '6px',
    lg: '8px',
  },
  contact: {
    email: 'support@novaracleaning.com',
    phone: '(555) 123-4567',
  },
  urls: {
    // Main domains
    website: 'https://novaracleaning.com',
    booking: 'https://book.novaracleaning.com',
    landing: 'https://try.novaracleaning.com',
    
    // Customer URLs
    account: 'https://book.novaracleaning.com/account',
    bookHome: 'https://book.novaracleaning.com/book/home',
    membership: 'https://book.novaracleaning.com/membership',
    
    // Landing page URLs
    pricing: 'https://try.novaracleaning.com/price',
    
    // Legal pages
    terms: 'https://novaracleaning.com/terms',
    privacy: 'https://novaracleaning.com/privacy',
    cancellation: 'https://novaracleaning.com/cancellation-policy',
    membershipPolicy: 'https://novaracleaning.com/membership-policy',
    
    // Contractor/Cleaner Portal URLs (contractor.novaracleaning.com)
    contractor: 'https://contractor.novaracleaning.com',
    contractorDashboard: 'https://contractor.novaracleaning.com/cleaner/dashboard',
    contractorOnboarding: 'https://contractor.novaracleaning.com/cleaner/onboarding-landing',
    contractorAuth: 'https://contractor.novaracleaning.com/cleaner/auth',
    
    // Admin Backend URLs (admin.novaracleaning.com)
    admin: 'https://admin.novaracleaning.com',
    adminCleaners: 'https://admin.novaracleaning.com/admin/cleaners',
    adminDispatch: 'https://admin.novaracleaning.com/admin/dispatch',
    adminIntake: 'https://admin.novaracleaning.com/admin/intake',
  },
  // Logo as base64 or URL - Update this with actual logo
  logo: {
    url: 'https://sxdraeptzuamsgjcvfeg.supabase.co/storage/v1/object/public/assets/novara-logo.png',
    width: '120',
    height: '40',
  },
};
