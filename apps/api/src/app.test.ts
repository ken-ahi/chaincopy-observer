import { createLogger, apiEnvSchema } from "@chaincopy/config";
import { type ServiceHealth } from "@chaincopy/domain";
import { afterEach, describe, expect, it } from "vitest";

import { createApi } from "./app.js";
import { type HealthService } from "./health.js";

const env = apiEnvSchema.parse({
  NODE_ENV: "test",
  LOG_LEVEL: "fatal",
  TZ: "Asia/Tokyo",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  API_HOST: "127.0.0.1",
  API_PORT: "3001",
  INTERNAL_API_SECRET: "test-internal-secret-that-is-at-least-32-characters",
});

const healthy: ServiceHealth = {
  checkedAt: "2026-07-25T00:00:00.000Z",
  components: {
    database: { latencyMs: 1, status: "up" },
    redis: { latencyMs: 1, status: "up" },
  },
  service: "api",
  status: "healthy",
};

const healthService: HealthService = {
  check: async () => healthy,
};

const apps: Array<Awaited<ReturnType<typeof createApi>>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("API health routes", () => {
  it("returns liveness without querying dependencies", async () => {
    const app = await createApi({
      env,
      healthService,
      logger: createLogger("api-test", "fatal"),
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: "api", status: "up" });
  });

  it("protects detailed health with the internal secret", async () => {
    const app = await createApi({
      env,
      healthService,
      logger: createLogger("api-test", "fatal"),
    });
    apps.push(app);

    const unauthorized = await app.inject({ method: "GET", url: "/api/admin/health" });
    const authorized = await app.inject({
      method: "GET",
      url: "/api/admin/health",
      headers: {
        "x-internal-api-secret": env.INTERNAL_API_SECRET,
      },
    });

    expect(unauthorized.statusCode).toBe(401);
    expect(authorized.statusCode).toBe(200);
    expect(authorized.json()).toEqual(healthy);
  });
});
