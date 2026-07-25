import { describe, expect, it } from "vitest";

import { apiEnvSchema, webEnvSchema } from "./env.js";

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
});
