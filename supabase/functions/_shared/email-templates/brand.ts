// Brand configuration for email templates.
//
// Colors follow the site's current palette (Novara purple on white, near-black
// text) so emails match novaracleaning.com and the booking pages. Body text is
// kept dark on a white card so it stays readable in every mail app. URLs use the *real*
// subdomains the marketing + portal sites run on:
//   • try.novaracleaning.com   → booking funnel
//   • app.novaracleaning.com   → customer portal (account / billing)
//   • novaracleaning.com       → marketing + policy pages
//
// Logo is served from the customer portal so it stays available even if
// the marketing site changes; /novara-logo.png is committed to /public/.

export const BRAND = {
  name: 'NovaraCleaning',
  colors: {
    primary: '#6810FE',
    primaryDark: '#5A1FD6',
    secondary: '#5A1FD6',
    success: '#16A34A',
    warning: '#F59E0B',
    danger: '#EF4444',
    gray: {
      50: '#F9FAFB',
      100: '#F3F4F6',
      200: '#E5E7EB',
      300: '#D1D5DB',
      600: '#52525B',
      700: '#27272A',
      900: '#0B0A11',
    },
  },
  gradient: {
    primary: '#6810FE',
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
    phone: '+1 (844) 735-2070',
  },
  urls: {
    website: 'https://novaracleaning.com',
    // Customer portal lives on app.* — never the try.* (booking-only)
    // subdomain. Use this for "View Booking", "Manage Card", "Reschedule"
    // and any other links that drop the customer into authenticated UI.
    account: 'https://app.novaracleaning.com/account',
    portal: 'https://app.novaracleaning.com/account',
    // Booking funnel lives on try.* — public, no auth required.
    booking: 'https://try.novaracleaning.com/',
    membership: 'https://try.novaracleaning.com/membership',
    terms: 'https://novaracleaning.com/terms',
    privacy: 'https://novaracleaning.com/privacy',
    cancellation: 'https://novaracleaning.com/cancellation-policy',
    membershipPolicy: 'https://novaracleaning.com/membership-policy',
  },
  // Square mark at public/novara-logo.png, served from the customer portal.
  logo: {
    url: 'https://app.novaracleaning.com/novara-logo.png',
    width: '56',
    height: '56',
  },
};
