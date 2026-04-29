import path from "node:path";

/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: path.resolve(process.cwd(), "../.."),
  async rewrites() {
    const apiBaseUrl = process.env.INFOPUNKS_API_BASE || "http://127.0.0.1:4010";

    return [
      {
        source: "/v1/:path*",
        destination: `${apiBaseUrl}/v1/:path*`
      },
      {
        source: "/healthz",
        destination: `${apiBaseUrl}/healthz`
      }
    ];
  }
};

export default nextConfig;
