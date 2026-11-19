import type { NextConfig } from "next";

// Image hosts: Supabase Storage by default, plus an optional custom CDN hostname.
const remotePatterns: NonNullable<NextConfig['images']>['remotePatterns'] = [
  {
    protocol: 'https',
    hostname: '*.supabase.co',
    port: '',
    pathname: '/**',
  },
  {
    protocol: 'https',
    hostname: 'share.zytronium.dev',
  },
];

if (process.env.STORAGE_CDN_HOSTNAME) {
  remotePatterns.push({
    protocol: 'https',
    hostname: process.env.STORAGE_CDN_HOSTNAME,
    pathname: '/**',
  });
}

const nextConfig: NextConfig = {
  images: { remotePatterns },
  reactCompiler: true,
};

export default nextConfig;
