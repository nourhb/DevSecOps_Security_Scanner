import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The dev server is opened at 127.0.0.1 while Next treats localhost as its
  // own origin. Without this, dev resources such as the HMR socket are blocked
  // and client pages stay on their server-rendered loading shell.
  allowedDevOrigins: ["127.0.0.1"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg", "pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
