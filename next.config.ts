import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its .afm font files from disk at runtime; bundling it with
  // webpack breaks that resolution, so it must run as a plain Node require.
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
