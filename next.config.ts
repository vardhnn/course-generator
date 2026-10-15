import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The project lives under a directory whose parent is the user home folder.
  // Without an explicit root, Turbopack walks up there and refuses to use this
  // project's package-lock.json.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;