import type { NextConfig } from "next";

const staticExport = process.env.OOPSIE_STATIC_EXPORT === "1";
if (staticExport) {
  const api = process.env.NEXT_PUBLIC_LUMA_API_URL;
  if (!api || URL.parse(api)?.protocol !== "https:") {
    throw new Error("Set NEXT_PUBLIC_LUMA_API_URL to the public HTTPS API URL before building the static site.");
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    throw new Error("Set the public Supabase URL and publishable key before building the static site.");
  }
}

const nextConfig: NextConfig = {
  ...(staticExport ? {
    output: "export",
    trailingSlash: true,
  } : {
    async rewrites() {
      const api = (process.env.LUMA_API_PROXY_URL ?? "http://127.0.0.1:8000").replace(/\/$/, "");
      return [{ source: "/ledger-api/v1/:path*", destination: api + "/v1/:path*" }];
    },
    cacheComponents: true,
    partialPrefetching: true,
  }),
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
