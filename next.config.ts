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
};

export default nextConfig;
