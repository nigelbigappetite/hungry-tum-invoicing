import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /** Do not bundle pdf-parse (and pdfjs-dist); use Node runtime require so PDF parsing works in API routes. */
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
