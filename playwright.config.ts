import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.E2E_MANAGED_SERVERS
    ? undefined
    : [
        {
          command: "node --import tsx apps/api/src/server.ts",
          cwd: ".",
          gracefulShutdown: { signal: "SIGINT", timeout: 10_000 },
          url: "http://127.0.0.1:3101/health",
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            API_HOST: "127.0.0.1",
            API_PORT: "3101",
            DATABASE_URL:
              "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=chaincopy_e2e",
            INTERNAL_API_SECRET: "e2e-internal-secret-at-least-32-chars",
            LOG_LEVEL: "warn",
            NODE_ENV: "test",
            REDIS_URL: "redis://127.0.0.1:6379/15",
            TZ: "Asia/Tokyo",
          },
        },
        {
          command: "node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3100",
          cwd: "./apps/web",
          gracefulShutdown: { signal: "SIGINT", timeout: 10_000 },
          url: "http://127.0.0.1:3100/login",
          reuseExistingServer: false,
          timeout: 120_000,
          env: {
            DATABASE_URL:
              "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=chaincopy_e2e",
            REDIS_URL: "redis://127.0.0.1:6379/15",
            AUTH_SECRET: "e2e-only-secret-value-at-least-32-characters",
            GOOGLE_CLIENT_ID: "e2e-client-id.apps.googleusercontent.com",
            GOOGLE_CLIENT_SECRET: "e2e-client-secret",
            HOSTNAME: "127.0.0.1",
            ALLOWED_ADMIN_EMAIL: "owner@example.com",
            API_BASE_URL: "http://127.0.0.1:3101",
            APP_BASE_URL: "http://127.0.0.1:3100",
            NEXTAUTH_URL: "http://127.0.0.1:3100",
            INTERNAL_API_SECRET: "e2e-internal-secret-at-least-32-chars",
            PORT: "3100",
            TZ: "Asia/Tokyo",
          },
        },
      ],
});
