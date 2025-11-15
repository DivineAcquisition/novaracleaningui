// Brand configuration for email templates

export const BRAND = {
  name: 'Novara Cleaning',
  colors: {
    primary: '#8B5CF6',
    primaryDark: '#7C3AED',
    secondary: '#EC4899',
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
    primary: 'linear-gradient(135deg, #8B5CF6 0%, #EC4899 100%)',
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
    website: 'https://novaracleaning.com',
    account: 'https://book.novaracleaning.com/account',
    booking: 'https://book.novaracleaning.com/book/home',
    membership: 'https://book.novaracleaning.com/membership',
    terms: 'https://novaracleaning.com/terms',
    privacy: 'https://novaracleaning.com/privacy',
    cancellation: 'https://novaracleaning.com/cancellation-policy',
    membershipPolicy: 'https://novaracleaning.com/membership-policy',
  },
  // Logo as base64 or URL - Update this with actual logo
  logo: {
    url: 'https://sxdraeptzuamsgjcvfeg.supabase.co/storage/v1/object/public/assets/novara-logo.png',
    width: '120',
    height: '40',
  },
};
