// Brand configuration for email templates.
//
// Colors mirror the in-app Tailwind theme (green primary) so emails feel
// like a natural extension of the customer portal at app.novaracleaning.com
// instead of a third-party transactional template. URLs use the *real*
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
    // Primary green — matches Tailwind `hsl(142 76% 36%)` from
    // src/config/brand-config.ts so in-app + email look identical.
    primary: '#16A34A',
    primaryDark: '#15803D',
    secondary: '#0EA371',
    success: '#16A34A',
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
    primary: 'linear-gradient(135deg, #16A34A 0%, #0E7C3A 100%)',
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
    booking: 'https://try.novaracleaning.com/book/zip',
    membership: 'https://try.novaracleaning.com/membership',
    terms: 'https://novaracleaning.com/terms',
    privacy: 'https://novaracleaning.com/privacy',
    cancellation: 'https://novaracleaning.com/cancellation-policy',
    membershipPolicy: 'https://novaracleaning.com/membership-policy',
  },
  // Public logo URL. Served from the customer portal subdomain so it's
  // guaranteed to exist (file lives at /public/novara-logo.png in the
  // Next.js bundle that powers app.novaracleaning.com).
  // Horizontal wordmark lockup (sparkle + "NOVARACLEANING"). Aspect
  // ratio ≈ 7.4:1, so width/height are sized to keep it crisp and
  // undistorted in the email header.
  logo: {
    url: 'https://app.novaracleaning.com/novara-email-logo.png',
    width: '200',
    height: '27',
  },
};
