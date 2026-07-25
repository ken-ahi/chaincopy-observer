import path from "node:path";
import { fileURLToPath } from "node:url";

const directoryName = path.dirname(fileURLToPath(import.meta.url));
const development = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${development ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://lh3.googleusercontent.com",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self' https://accounts.google.com",
  "object-src 'none'",
].join("; ");

/** @type {import("next").NextConfig} */
const nextConfig = {
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  output: "standalone",
  outputFileTracingRoot: path.join(directoryName, "../.."),
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: ["@chaincopy/config", "@chaincopy/database", "@chaincopy/ui"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
