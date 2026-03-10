/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'sxdraeptzuamsgjcvfeg.supabase.co',
        pathname: '/storage/**',
      },
    ],
  },
  async redirects() {
    return [
      { source: '/book/home', destination: '/book/sqft', permanent: true },
      { source: '/book/service', destination: '/book/offer', permanent: true },
      { source: '/book/schedule', destination: '/book/checkout', permanent: true },
      { source: '/book/summary', destination: '/book/checkout', permanent: true },
      { source: '/book/success', destination: '/book/confirmation', permanent: true },
      { source: '/book/additional-details', destination: '/book/details', permanent: true },
      { source: '/cleaner/profile', destination: '/cleaner/dashboard', permanent: true },
      { source: '/cleaner/onboarding-landing', destination: '/cleaner/onboarding', permanent: true },
      { source: '/cleaner/onboard', destination: '/cleaner/onboarding', permanent: true },
      { source: '/pricing', destination: '/pricing-sheet', permanent: true },
    ];
  },
};

export default nextConfig;
