/** @type {import('next').NextConfig} */
const nextConfig = {
  // Enable React Strict Mode for better development experience
  reactStrictMode: true,
  
  // Output mode - standalone for deployment
  output: 'standalone',
  
  // Configure redirects for backward compatibility
  async redirects() {
    return [
      // Legacy booking redirects
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
      // Legacy cleaner onboard route
      {
        source: '/cleaner/onboard',
        destination: '/cleaner/onboarding-landing',
        permanent: true,
      },
    ];
  },
  
  // Images configuration for external domains
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'storage.googleapis.com',
      },
      {
        protocol: 'https',
        hostname: '*.supabase.co',
      },
    ],
  },
  
  // Transpile packages that need it
  transpilePackages: ['lucide-react'],
  
  // Experimental features
  experimental: {
    // Enable server actions for better form handling
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
};

module.exports = nextConfig;
