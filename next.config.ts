import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  serverExternalPackages: ["node:sqlite"],
  poweredByHeader: false,
};

export default nextConfig;
