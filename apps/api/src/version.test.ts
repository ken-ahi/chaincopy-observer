import { apiEnvSchema, createLogger } from "@chaincopy/config";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type AddressService } from "./address-service.js";
import { createApi } from "./app.js";
import { type DiscoveryService } from "./discovery-service.js";
import { type HealthService } from "./health.js";
import { type PerformanceService } from "./performance-service.js";

const env = apiEnvSchema.parse({
  NODE_ENV: "test",
  LOG_LEVEL: "fatal",
  TZ: "Asia/Tokyo",
  DATABASE_URL: "postgresql://database-user:database-secret@localhost:5432/test",
  REDIS_URL: "redis://redis-secret@localhost:6379",
  API_HOST: "127.0.0.1",
  API_PORT: "3001",
  INTERNAL_API_SECRET: "test-internal-secret-that-is-at-least-32-characters",
});

const dependencyProbe = vi.fn(async () => {
  throw new Error("The version route must not query dependencies.");
});

const apps: Array<Awaited<ReturnType<typeof createApi>>> = [];

afterEach(async () => {
  dependencyProbe.mockClear();
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("GET /version", () => {
  it("returns public build information without querying dependencies", async () => {
    const app = await createTestApi();

    const response = await app.inject({ method: "GET", url: "/version" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      service: "api",
      version: "0.3.0",
      commit: "unknown",
      builtAt: "unknown",
    });
    expect(dependencyProbe).not.toHaveBeenCalled();
  });

  it("uses valid Semantic Version, commit, and build-time formats", async () => {
    const app = await createTestApi();

    const payload = (await app.inject({ method: "GET", url: "/version" })).json<{
      readonly version: string;
      readonly commit: string;
      readonly builtAt: string;
    }>();

    expect(payload.version).toMatch(
      /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
    );
    expect(payload.commit).toMatch(/^(?:[0-9a-f]{7}|unknown)$/);
    expect(
      payload.builtAt === "unknown" || new Date(payload.builtAt).toISOString() === payload.builtAt,
    ).toBe(true);
  });

  it("contains only the four non-secret fields", async () => {
    const app = await createTestApi();

    const response = await app.inject({ method: "GET", url: "/version" });
    const payload = response.json<Record<string, unknown>>();
    const body = response.body;

    expect(Object.keys(payload).sort()).toEqual(["builtAt", "commit", "service", "version"]);
    expect(body).not.toContain(env.INTERNAL_API_SECRET);
    expect(body).not.toContain(env.DATABASE_URL);
    expect(body).not.toContain(env.REDIS_URL);
    expect(body).not.toContain("stack");
  });
});

async function createTestApi() {
  const healthService: HealthService = {
    check: dependencyProbe,
  };
  const app = await createApi({
    addressService: {} as AddressService,
    discoveryService: {} as DiscoveryService,
    env,
    healthService,
    logger: createLogger("api-version-test", "fatal"),
    performanceService: {} as PerformanceService,
  });
  apps.push(app);
  return app;
}
