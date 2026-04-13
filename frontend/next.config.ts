import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  /* config options here */
  // Empty turbopack config to silence the webpack/turbopack conflict error
  turbopack: {},
  // Use webpack instead of Turbopack to configure module resolution
  // This prevents Next.js from resolving modules from the root directory
  webpack: (config, { isServer, dev }) => {
    // Explicitly set module resolution to use frontend/node_modules
    config.resolve.modules = [
      path.join(__dirname, 'node_modules'),
      'node_modules',
    ];
    
    // Prevent resolving from parent directories
    config.resolve.symlinks = false;
    
    // Optimize watch options to reduce unnecessary rebuilds (dev mode only)
    // Note: Simplified configuration to avoid webpack/watchpack issues
    if (dev && config.watchOptions) {
      // Only modify if watchOptions already exists
      config.watchOptions = {
        ...config.watchOptions,
        aggregateTimeout: 500, // Wait 500ms before rebuilding (debounce)
      };
    }
    
    return config;
  },
};

export default nextConfig;
