import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  entry: [
    "src/index.ts",
    "src/components/badge.tsx",
    "src/components/button.tsx",
    "src/components/card.tsx",
    "src/components/progress.tsx",
    "src/lib/utils.ts",
  ],
  external: ["react", "react/jsx-runtime"],
  format: ["esm"],
  platform: "neutral",
  sourcemap: true,
  target: "es2022",
});
