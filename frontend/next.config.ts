import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async rewrites() {
    const api = (process.env.LUMA_API_PROXY_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
    return [{ source: "/ledger-api/v1/:path*", destination: api + "/v1/:path*" }];
  },
  cacheComponents: true,
  partialPrefetching: true,
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
