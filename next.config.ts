import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This machine's CPU lacks AVX2, so Next's native SWC/Turbopack cannot run
  // here — dev and build are pinned to webpack in package.json. Pin the
  // workspace root too, so a stray lockfile elsewhere doesn't get picked up.
  outputFileTracingRoot: process.cwd(),

  experimental: {
    // Next 15 changed the client Router Cache default for dynamic pages from
    // 30s to 0s, so every section switch refetched from the server (the pages
    // here are all `force-dynamic`). Re-enable client caching so navigating
    // back to a recently-visited section is instant; Server Actions +
    // revalidatePath/router.refresh still invalidate it after edits.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },

  // Security headers on every response. (No strict CSP yet — Next's inline
  // runtime scripts make a locked-down policy easy to break; these headers
  // cover clickjacking, MIME sniffing, referrer leakage and force HTTPS.)
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'on' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), geolocation=(), interest-cohort=()',
          },
        ],
      },
    ]
  },
};

export default nextConfig;
