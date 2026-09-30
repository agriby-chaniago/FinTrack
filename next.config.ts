import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits over the mobile bottom navigation; build errors still show.
  devIndicators: false,
};

export default nextConfig;
