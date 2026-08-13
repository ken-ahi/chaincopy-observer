import { describe, expect, it } from "vitest";

import { apiEnvSchema, webEnvSchema, workerEnvSchema } from "./env.js";

const shared = {
  NODE_ENV: "test",
  LOG_LEVEL: "info",
  TZ: "Asia/Tokyo",
  DATABASE_URL: "postgresql://chaincopy:chaincopy@localhost:5432/chaincopy",
  REDIS_URL: "redis://localhost:6379",
};

describe("environment schemas", () => {
  it("normalizes and validates the single allowed email", () => {
    const result = webEnvSchema.parse({
      ...shared,
      APP_BASE_URL: "http://localhost:3000",
      AUTH_SECRET: "a-secret-value-that-is-at-least-32-characters",
      GOOGLE_CLIENT_ID: "google-client",
      GOOGLE_CLIENT_SECRET: "google-secret",
      ALLOWED_ADMIN_EMAIL: " Owner@Example.COM ",
      INTERNAL_API_SECRET: "an-internal-secret-that-is-at-least-32-characters",
    });

    expect(result.ALLOWED_ADMIN_EMAIL).toBe("owner@example.com");
  });

  it("rejects an undersized internal secret", () => {
    const result = apiEnvSchema.safeParse({
      ...shared,
      API_HOST: "127.0.0.1",
      API_PORT: "3001",
      INTERNAL_API_SECRET: "too-short",
    });

    expect(result.success).toBe(false);
  });

  it("uses conservative worker concurrency and split sync defaults", () => {
    const result = workerEnvSchema.parse(shared);
    expect(result.HYPERLIQUID_WORKER_CONCURRENCY).toBe(2);
    expect(result.HYPERLIQUID_DISCOVERY_WORKER_CONCURRENCY).toBe(4);
    expect(result.HYPERLIQUID_ACCOUNT_SYNC_INTERVAL_MS).toBe(600_000);
    expect(result.HYPERLIQUID_ORDER_HISTORY_SYNC_INTERVAL_MS).toBe(3_600_000);
  });

  it("rejects unsafe worker concurrency", () => {
    expect(
      workerEnvSchema.safeParse({ ...shared, HYPERLIQUID_WORKER_CONCURRENCY: "0" }).success,
    ).toBe(false);
  });
});
