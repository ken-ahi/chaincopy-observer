import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: ["src/index.ts"],
  external: ["@prisma/client"],
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  target: "node24",
});
