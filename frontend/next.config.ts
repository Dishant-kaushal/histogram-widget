import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Pin the workspace root — a stray lockfile in the home directory makes
  // Next infer the wrong root, which 404s every route.
  turbopack: {
    root: path.join(__dirname),
  },
  // The widget preview is served through an *.iocompute.ai sub-domain that
  // proxies to this dev server. Next 16 blocks cross-origin dev requests by
  // default ("Blocked cross-origin request" / invalid host), so the page shows
  // nothing on the sub-domain. Allow the preview origins explicitly.
  allowedDevOrigins: [
    '*.iocompute.ai',
    '*.iocompute.ai:*',
    'iocompute.ai',
  ],
  // Let the Lens host (which embeds this app cross-origin) call the dev server.
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Access-Control-Allow-Origin', value: '*' },
          { key: 'Access-Control-Allow-Methods', value: 'GET, POST, PUT, DELETE, OPTIONS' },
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type, Authorization' },
        ],
      },
    ];
  },
};

export default nextConfig;
