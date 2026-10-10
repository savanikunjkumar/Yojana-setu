/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // @sih/shared ships compiled CommonJS from the workspace; letting Next transpile
  // it keeps server components and the client bundle on one module graph.
  transpilePackages: ['@sih/shared'],
  eslint: {
    dirs: ['src'],
  },
};

export default nextConfig;
