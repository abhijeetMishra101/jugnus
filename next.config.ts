import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  // Force the chromium binary (bin/*.br) into the browser-test function bundle.
  // Next.js file tracing only follows JS imports — it misses binary assets referenced by path.
  outputFileTracingIncludes: {
    '/api/internal/browser-test': ['./node_modules/@sparticuz/chromium/**/*'],
  },
};

export default nextConfig;
