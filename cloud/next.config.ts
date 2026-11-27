import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['@mastra/core', '@mastra/libsql', '@libsql/client', 'ws'],
};

export default nextConfig;
