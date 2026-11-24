import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const config: NextConfig = {
  poweredByHeader: false,
  transpilePackages: ["@baytline/core", "@baytline/db", "@baytline/identity", "@baytline/platform", "@baytline/developer", "@baytline/management", "@baytline/marketplace", "@baytline/ai", "@baytline/leads"],
  serverExternalPackages: ["pg"],
  // Inventory imports accept files up to 2 MB (IMPORT_MAX_BYTES); leave room for the form's other fields.
  experimental: { serverActions: { bodySizeLimit: "3mb" } },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default config;
