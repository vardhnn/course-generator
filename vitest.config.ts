import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Boots a disposable embedded PostgreSQL once per run and exports
    // DATABASE_URL/DIRECT_URL to every worker before any module reads env.
    globalSetup: ["src/test-global-setup.ts"],
    // MUST run before any module reads process.env: without it the tests
    // would inherit DATABASE_URL from .env and write to the development database.
    setupFiles: ["src/test-setup.ts"],
    // Tests share one database; keep them sequential.
    fileParallelism: false,
  },
});