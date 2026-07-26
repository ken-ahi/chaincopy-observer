import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@chaincopy/analytics": fileURLToPath(
        new URL("./packages/analytics/src/index.ts", import.meta.url),
      ),
      "@chaincopy/blockchain-adapters": fileURLToPath(
        new URL("./packages/blockchain-adapters/src/index.ts", import.meta.url),
      ),
      "@chaincopy/config": fileURLToPath(
        new URL("./packages/config/src/index.ts", import.meta.url),
      ),
      "@chaincopy/database": fileURLToPath(
        new URL("./packages/database/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["apps/**/*.test.ts", "packages/**/*.test.ts", "tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
    passWithNoTests: false,
  },
});
