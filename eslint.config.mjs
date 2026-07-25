import { defineConfig, globalIgnores } from "eslint/config";
import nextPlugin from "@next/eslint-plugin-next";
import typescriptEslint from "typescript-eslint";

export default defineConfig([
  ...typescriptEslint.configs.recommended,
  {
    files: ["apps/web/**/*.{ts,tsx}"],
    plugins: {
      "@next/next": nextPlugin,
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs["core-web-vitals"].rules,
      "@next/next/no-html-link-for-pages": "off",
    },
    settings: {
      next: {
        rootDir: "apps/web/",
      },
    },
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    settings: {
      react: {
        version: "19.2.8",
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },
  globalIgnores([
    "**/.next/**",
    "**/dist/**",
    "**/coverage/**",
    "**/.turbo/**",
    "**/node_modules/**",
    "**/playwright-report/**",
    "**/test-results/**",
    "packages/database/src/generated/**",
  ]),
]);
