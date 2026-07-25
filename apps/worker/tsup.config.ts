import { defineConfig } from "tsup";

export default defineConfig({
  bundle: true,
  clean: true,
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node24",
  esbuildOptions(options) {
    options.packages = "external";
  },
});
