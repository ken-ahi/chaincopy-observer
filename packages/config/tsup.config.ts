import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts", "src/env.ts", "src/logger.ts"],
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  target: "node24",
});
