import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The dev badge sits over the mobile bottom navigation; build errors still show.
  devIndicators: false,
  experimental: {
    // Fully prefetched navigation pages are reused for at most 60 seconds;
    // saving any change purges them sooner (src/app/revalidate.ts).
    staleTimes: { static: 60 },
  },
};

export default nextConfig;
