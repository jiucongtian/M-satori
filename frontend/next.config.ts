import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: process.env.SATORI_STATIC_EXPORT === "true" ? "export" : undefined,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
