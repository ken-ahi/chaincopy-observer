import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000",
    cwd: "./apps/web",
    url: "http://127.0.0.1:3000/login",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy",
      REDIS_URL: "redis://127.0.0.1:6379",
      AUTH_SECRET: "e2e-only-secret-value-at-least-32-characters",
      GOOGLE_CLIENT_ID: "e2e-client-id.apps.googleusercontent.com",
      GOOGLE_CLIENT_SECRET: "e2e-client-secret",
      ALLOWED_ADMIN_EMAIL: "owner@example.com",
      APP_BASE_URL: "http://127.0.0.1:3000",
      NEXTAUTH_URL: "http://127.0.0.1:3000",
      INTERNAL_API_SECRET: "e2e-internal-secret-at-least-32-chars",
      TZ: "Asia/Tokyo",
    },
  },
});
