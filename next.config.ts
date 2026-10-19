import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // PGlite ships WebAssembly and reads files at runtime; load it from node_modules
  serverExternalPackages: ["@electric-sql/pglite"],
  // keep the dev-mode badge clear of the sidebar's account menu
  devIndicators: { position: "bottom-right" },
};

export default nextConfig;
