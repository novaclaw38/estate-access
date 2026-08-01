import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its .afm font files from disk at runtime; bundling it with
  // webpack breaks that resolution, so it must run as a plain Node require.
  serverExternalPackages: ["pdfkit"],
  // A stray pnpm-lock.yaml at /home/byron makes Next.js misdetect the
  // workspace root; pin it to this project explicitly.
  outputFileTracingRoot: path.join(__dirname),
};

export default nextConfig;
