import type { NextConfig } from "next";

const isLocalDemo = process.env.DEMO_MODE === "true";

const nextConfig: NextConfig = {
  transpilePackages: ["@koeki/ui", "@koeki/domain", "@koeki/auth", "@koeki/database"],
  serverExternalPackages: ["@prisma/client", "@prisma/adapter-pg"],
  poweredByHeader: false,
  experimental: { optimizePackageImports: ["lucide-react"] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          ...(!isLocalDemo ? [{ key: "X-Frame-Options", value: "DENY" }] : []),
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }
        ]
      }
    ];
  }
};

export default nextConfig;
