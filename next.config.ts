import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "www.asiaworld-expo.com",
      },
      {
        protocol: "https",
        hostname: "assets.kktix.io",
      },
      {
        protocol: "https",
        hostname: "dynamicmedia.livenationinternational.com",
      },
    ],
  },
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
