import type { NextConfig } from "next";

const nextConfig: NextConfig =
  process.env.SATORI_STATIC_EXPORT === "true"
    ? { output: "export", images: { unoptimized: true } }
    : {};

export default nextConfig;
