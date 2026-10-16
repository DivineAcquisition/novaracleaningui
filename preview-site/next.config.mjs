import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  outputFileTracingRoot: root,
  eslint: { ignoreDuringBuilds: true },
  images: { unoptimized: true },
  async redirects() {
    return [
      { source: "/careers/welcome", destination: "/careers", permanent: false },
      { source: "/terms", destination: "/legal/terms", permanent: false },
      { source: "/privacy", destination: "/legal/privacy", permanent: false },
      { source: "/disclaimer", destination: "/legal/disclaimer", permanent: false },
      { source: "/cancellation-policy", destination: "/legal/cancellation-policy", permanent: false },
      { source: "/refund-policy", destination: "/legal/refund-policy", permanent: false },
      { source: "/membership-policy", destination: "/legal/membership-policy", permanent: false },
    ];
  },
};

export default nextConfig;
