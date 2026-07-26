import { defineConfig } from "tsup";

export default defineConfig({
  bundle: true,
  clean: true,
  entry: ["src/index.ts"],
  format: ["esm"],
  noExternal: ["decimal.js"],
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node24",
});
