import type { NextConfig } from "next";

// The Content-Security-Policy (with a per-request script nonce) is set in src/middleware.ts.
// Files the middleware does not handle (static images, fonts) only need the headers below.
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
    : []),
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Lets a second server (e.g. a dev preview) build into its own folder without disturbing a running `next start`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["pdfkit", "exceljs", "web-push", "node-cron", "razorpay", "nodemailer"],
  // Files read from disk at runtime. Next's tracer cannot see these reads, so they must be listed
  // explicitly or they are missing from the serverless bundle (Netlify, standalone builds).
  outputFileTracingIncludes: {
    "/**/*": [
      // The JSON data engine reads its mock data at runtime.
      "./data/demo-data.json",
      // pdfkit is a serverExternalPackage and loads the standard-14 font metrics from its own
      // package directory. Without these every PDF route fails on the first doc.font() call.
      "./node_modules/pdfkit/js/data/**",
      // src/lib/pdf-tamil.ts resolves these through process.cwd() to shape Tamil text in PDFs.
      "./assets/fonts/*.ttf",
    ],
  },
  experimental: {
    // Fewer build workers (default: one per CPU core) so `next build` fits on a machine with little free memory.
    cpus: 2,
    serverActions: {
      bodySizeLimit: "10mb",
      // Allow form submissions when the site is opened through its public address (APP_URL) behind a proxy.
      allowedOrigins: process.env.APP_URL ? [new URL(process.env.APP_URL).host] : undefined,
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
