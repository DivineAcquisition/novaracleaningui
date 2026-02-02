/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    domains: [
      'localhost',
      'your-supabase-project.supabase.co',
      'lh3.googleusercontent.com', // Google profile pictures
    ],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  // Redirect legacy routes
  async redirects() {
    return [
      {
        source: '/book/home',
        destination: '/book/sqft',
        permanent: true,
      },
      {
        source: '/book/service',
        destination: '/book/offer',
        permanent: true,
      },
      {
        source: '/book/schedule',
        destination: '/book/checkout',
        permanent: true,
      },
      {
        source: '/book/summary',
        destination: '/book/checkout',
        permanent: true,
      },
      {
        source: '/book/success',
        destination: '/book/confirmation',
        permanent: true,
      },
      {
        source: '/book/additional-details',
        destination: '/book/details',
        permanent: true,
      },
      {
        source: '/cleaner/profile',
        destination: '/cleaner/dashboard',
        permanent: false,
      },
      {
        source: '/cleaner/onboarding-landing',
        destination: '/cleaner/onboarding',
        permanent: false,
      },
      {
        source: '/cleaner/onboard',
        destination: '/cleaner/onboarding',
        permanent: false,
      },
    ];
  },
};

module.exports = nextConfig;
