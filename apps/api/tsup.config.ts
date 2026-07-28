import { defineConfig } from "tsup";

import { resolveBuildMetadata } from "../../scripts/build-metadata.mjs";

const buildMetadata = resolveBuildMetadata();

export default defineConfig({
  bundle: true,
  clean: true,
  define: {
    __APP_VERSION__: JSON.stringify(buildMetadata.version),
    __BUILD_COMMIT__: JSON.stringify(buildMetadata.commit),
    __BUILD_TIME__: JSON.stringify(buildMetadata.builtAt),
  },
  entry: ["src/server.ts"],
  format: ["esm"],
  platform: "node",
  sourcemap: true,
  splitting: false,
  target: "node24",
  esbuildOptions(options) {
    options.packages = "external";
  },
});
