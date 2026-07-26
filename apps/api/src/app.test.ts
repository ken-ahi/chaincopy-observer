import { createLogger, apiEnvSchema } from "@chaincopy/config";
import { type ServiceHealth } from "@chaincopy/domain";
import { afterEach, describe, expect, it } from "vitest";

import { createApi } from "./app.js";
import {
  AddressConflictError,
  type AddressService,
  type AddressSummary,
} from "./address-service.js";
import { type HealthService } from "./health.js";
import { type DiscoveryService } from "./discovery-service.js";

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

const addressService: AddressService = {
  listAddresses: async () => ({ items: [], nextCursor: null }),
  createAddress: async () => {
    throw new Error("Not used by this test.");
  },
  getAddress: async () => {
    throw new Error("Not used by this test.");
  },
  updateAddress: async () => {
    throw new Error("Not used by this test.");
  },
  setWatch: async () => {
    throw new Error("Not used by this test.");
  },
  enqueueSync: async () => {
    throw new Error("Not used by this test.");
  },
  listFills: async () => ({ items: [], nextCursor: null }),
  listFunding: async () => ({ items: [], nextCursor: null }),
  listLedger: async () => ({ items: [], nextCursor: null }),
  listPositions: async () => [],
  listOrders: async () => ({ items: [], nextCursor: null }),
  listDataQuality: async () => ({ items: [], nextCursor: null }),
  getSyncStatus: async () => {
    throw new Error("Not used by this test.");
  },
  getHyperliquidHealth: async () => ({}),
};

const discoveryService: DiscoveryService = {
  enqueueEnrichment: async () => ({}),
  enqueuePromotion: async () => ({}),
  excludeCandidate: async () => ({}),
  getCandidate: async () => ({}),
  getSettings: async () => ({}),
  getStats: async () => ({}),
  listCandidates: async () => ({ items: [], nextCursor: null }),
  setEnabled: async () => ({}),
  updateSettings: async () => ({}),
};

const addressSummary: AddressSummary = {
  address: "0x1111111111111111111111111111111111111111",
  currentPositionCount: 0,
  displayName: "test",
  fillCount: 0,
  fundingCount: 0,
  isWatched: true,
  lastError: null,
  lastSuccessfulAt: null,
  lastSyncAt: null,
  ledgerCount: 0,
  openDataQualityIssues: 0,
  syncStatus: null,
};

function withAddressService(overrides: Partial<AddressService>): AddressService {
  return { ...addressService, ...overrides };
}

async function createTestApi(service: AddressService = addressService) {
  const app = await createApi({
    addressService: service,
    discoveryService,
    env,
    healthService,
    logger: createLogger("api-test", "fatal"),
  });
  apps.push(app);
  return app;
}

const apps: Array<Awaited<ReturnType<typeof createApi>>> = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(async (app) => app.close()));
});

describe("API health routes", () => {
  it("returns liveness without querying dependencies", async () => {
    const app = await createTestApi();

    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ service: "api", status: "up" });
  });

  it("protects detailed health with the internal secret", async () => {
    const app = await createTestApi();

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

describe("address routes", () => {
  it("rejects unauthenticated requests", async () => {
    const app = await createTestApi();

    const response = await app.inject({ method: "GET", url: "/api/addresses" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthorized" });
  });

  it("parses address filters and returns cursor pagination", async () => {
    let receivedQuery: unknown;
    const app = await createTestApi(
      withAddressService({
        listAddresses: async (query) => {
          receivedQuery = query;
          return { items: [addressSummary], nextCursor: "next-id" };
        },
      }),
    );

    const response = await app.inject({
      method: "GET",
      url: "/api/addresses?limit=25&search=test&isWatched=false&syncStatus=FAILED",
      headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
    });

    expect(response.statusCode).toBe(200);
    expect(receivedQuery).toEqual({
      isWatched: false,
      limit: 25,
      search: "test",
      syncStatus: "FAILED",
    });
    expect(response.json()).toEqual({
      items: [addressSummary],
      nextCursor: "next-id",
    });
  });

  it("rejects malformed addresses before calling the service", async () => {
    const app = await createTestApi();

    const response = await app.inject({
      method: "POST",
      url: "/api/addresses",
      headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
      payload: { address: "not-an-address", isWatched: true },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: "validation_error" });
  });

  it("returns a structured duplicate error", async () => {
    const app = await createTestApi(
      withAddressService({
        createAddress: async () => {
          throw new AddressConflictError(addressSummary.address);
        },
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/addresses",
      headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
      payload: { address: addressSummary.address, isWatched: true },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: "duplicate_address" });
  });

  it("returns the queued job for an immediate manual sync", async () => {
    const app = await createTestApi(
      withAddressService({
        enqueueSync: async () => ({ jobId: "wallet-backfill-test", status: "QUEUED" }),
      }),
    );

    const response = await app.inject({
      method: "POST",
      url: `/api/addresses/${addressSummary.address}/sync`,
      headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      jobId: "wallet-backfill-test",
      status: "QUEUED",
    });
  });
});

describe("discovery routes", () => {
  it("rejects unauthenticated discovery API requests", async () => {
    const app = await createTestApi();

    const response = await app.inject({ method: "GET", url: "/api/discovery/stats" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthorized" });
  });
});
