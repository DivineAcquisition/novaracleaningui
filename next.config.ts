import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow images from external domains
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
    ],
  },

  // Legacy route redirects (previously handled by React Router)
  async redirects() {
    return [
      // Booking flow legacy redirects
      {
        source: "/book/home",
        destination: "/book/sqft",
        permanent: true,
      },
      {
        source: "/book/service",
        destination: "/book/offer",
        permanent: true,
      },
      {
        source: "/book/schedule",
        destination: "/book/checkout",
        permanent: true,
      },
      {
        source: "/book/summary",
        destination: "/book/checkout",
        permanent: true,
      },
      {
        source: "/book/success",
        destination: "/book/confirmation",
        permanent: true,
      },
      {
        source: "/book/additional-details",
        destination: "/book/details",
        permanent: true,
      },
      // Cleaner portal legacy redirects
      {
        source: "/cleaner/profile",
        destination: "/cleaner/dashboard",
        permanent: true,
      },
      {
        source: "/cleaner/onboarding-landing",
        destination: "/cleaner/onboarding",
        permanent: true,
      },
      {
        source: "/cleaner/onboard",
        destination: "/cleaner/onboarding",
        permanent: true,
      },
      // Pricing alias
      {
        source: "/pricing",
        destination: "/pricing-sheet",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
