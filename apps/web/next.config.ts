import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  transpilePackages: [
    "@flowprocure/db",
    "@flowprocure/policy-engine",
    "@flowprocure/erp-sync",
  ],
};

export default nextConfig;
