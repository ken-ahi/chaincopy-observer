import { createLogger, apiEnvSchema } from "@chaincopy/config";
import { type ServiceHealth } from "@chaincopy/domain";
import { afterEach, describe, expect, it } from "vitest";

import { createApi } from "./app.js";
import {
  AddressConflictError,
  AddressNotFoundError,
  type AddressService,
  type AddressSummary,
} from "./address-service.js";
import { type HealthService } from "./health.js";
import {
  CandidateActionConflictError,
  CandidateNotFoundError,
  type DiscoveryService,
} from "./discovery-service.js";
import {
  type CalculationRunDto,
  type DailyNavDto,
  type MetricDto,
  type PerformanceOverviewDto,
  PerformanceCalculationConflictError,
  PerformanceRunNotFoundError,
  type PerformanceService,
  type PositionCycleDto,
} from "./performance-service.js";

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
  unexcludeCandidate: async () => ({}),
  getCandidate: async () => ({}),
  getSettings: async () => ({}),
  getStats: async () => ({}),
  listCandidates: async () => ({ items: [], nextCursor: null }),
  setEnabled: async () => ({}),
  updateSettings: async () => ({}),
};

const emptyPerformanceOverview: PerformanceOverviewDto = {
  walletAddress: "0x1111111111111111111111111111111111111111",
  latestRun: null,
  latestSuccessfulRun: null,
  latestFailedRun: null,
  metrics: {},
  navSummary: {
    count: 0,
    firstDate: null,
    lastDate: null,
    firstNav: null,
    lastNav: null,
    minNav: null,
    maxNav: null,
  },
  cycleSummary: {
    total: 0,
    open: 0,
    closed: 0,
    profitable: 0,
    losing: 0,
  },
};

const performanceService: PerformanceService = {
  calculate: async () => ({
    calculationVersion: "performance-v1",
    force: false,
    jobId: "calculate-address-performance-test",
    status: "QUEUED",
    walletAddress: emptyPerformanceOverview.walletAddress,
  }),
  recalculate: async () => ({
    calculationVersion: "performance-v1",
    force: true,
    jobId: "recalculate-address-performance-test",
    status: "QUEUED",
    walletAddress: emptyPerformanceOverview.walletAddress,
  }),
  getOverview: async () => emptyPerformanceOverview,
  listRuns: async () => ({ items: [], nextCursor: null }),
  getRun: async (_address, runId) => {
    throw new PerformanceRunNotFoundError(runId);
  },
  listNav: async () => ({ items: [], nextCursor: null }),
  listCycles: async () => ({ items: [], nextCursor: null }),
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

function withPerformanceService(overrides: Partial<PerformanceService>): PerformanceService {
  return { ...performanceService, ...overrides };
}

function withDiscoveryService(overrides: Partial<DiscoveryService>): DiscoveryService {
  return { ...discoveryService, ...overrides };
}

async function createTestApi(
  service: AddressService = addressService,
  performance: PerformanceService = performanceService,
  discovery: DiscoveryService = discoveryService,
) {
  const app = await createApi({
    addressService: service,
    discoveryService: discovery,
    env,
    healthService,
    logger: createLogger("api-test", "fatal"),
    performanceService: performance,
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
  const address = "0x1111111111111111111111111111111111111111";

  it("rejects unauthenticated discovery API requests", async () => {
    const app = await createTestApi();

    const response = await app.inject({ method: "GET", url: "/api/discovery/stats" });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthorized" });
  });

  it("excludes a candidate through the existing POST action", async () => {
    let receivedAddress: string | null = null;
    const app = await createTestApi(
      addressService,
      performanceService,
      withDiscoveryService({
        excludeCandidate: async (candidateAddress) => {
          receivedAddress = candidateAddress;
          return {
            candidate: { filterStatus: "EXCLUDED" },
            status: "EXCLUDED",
          };
        },
      }),
    );

    const response = await app.inject({
      headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
      method: "POST",
      url: `/api/discovery/candidates/${address}/exclude`,
    });

    expect(response.statusCode).toBe(202);
    expect(receivedAddress).toBe(address);
    expect(response.json()).toEqual({
      candidate: { filterStatus: "EXCLUDED" },
      status: "EXCLUDED",
    });
  });

  it("removes a manual exclusion through DELETE and queues re-evaluation", async () => {
    let receivedAddress: string | null = null;
    const app = await createTestApi(
      addressService,
      performanceService,
      withDiscoveryService({
        unexcludeCandidate: async (candidateAddress) => {
          receivedAddress = candidateAddress;
          return {
            candidate: {
              exclusionReasons: ["INSUFFICIENT_HISTORY"],
              filterStatus: "PENDING",
            },
            jobId: "filter-candidate-1-manual-unexclude",
            status: "QUEUED",
          };
        },
      }),
    );

    const response = await app.inject({
      headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
      method: "DELETE",
      url: `/api/discovery/candidates/${address}/exclude`,
    });

    expect(response.statusCode).toBe(202);
    expect(receivedAddress).toBe(address);
    expect(response.json()).toEqual({
      candidate: {
        exclusionReasons: ["INSUFFICIENT_HISTORY"],
        filterStatus: "PENDING",
      },
      jobId: "filter-candidate-1-manual-unexclude",
      status: "QUEUED",
    });
  });

  it("returns 404 when the candidate does not exist", async () => {
    const app = await createTestApi(
      addressService,
      performanceService,
      withDiscoveryService({
        unexcludeCandidate: async () => {
          throw new CandidateNotFoundError(address);
        },
      }),
    );

    const response = await app.inject({
      headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
      method: "DELETE",
      url: `/api/discovery/candidates/${address}/exclude`,
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
  });

  it("returns 409 when the candidate cannot be safely changed", async () => {
    const app = await createTestApi(
      addressService,
      performanceService,
      withDiscoveryService({
        unexcludeCandidate: async () => {
          throw new CandidateActionConflictError("Candidate state changed.");
        },
      }),
    );

    const response = await app.inject({
      headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
      method: "DELETE",
      url: `/api/discovery/candidates/${address}/exclude`,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: "CANDIDATE_STATE_CHANGED",
      error: "conflict",
      message: "Candidate state changed.",
    });
  });

  it("does not expose secrets or stack traces from unexclude failures", async () => {
    const app = await createTestApi(
      addressService,
      performanceService,
      withDiscoveryService({
        unexcludeCandidate: async () => {
          throw new Error(
            `redis://secret@internal:6379\n${env.INTERNAL_API_SECRET}\nstack: private`,
          );
        },
      }),
    );

    const response = await app.inject({
      headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
      method: "DELETE",
      url: `/api/discovery/candidates/${address}/exclude`,
    });
    const body = response.body;

    expect(response.statusCode).toBe(500);
    expect(body).not.toContain("redis://");
    expect(body).not.toContain(env.INTERNAL_API_SECRET);
    expect(body).not.toContain("stack:");
    expect(response.json()).toEqual({
      error: "internal_server_error",
      message: "The API could not complete the request.",
    });
  });
});

describe("performance routes", () => {
  const address = emptyPerformanceOverview.walletAddress;
  const otherAddress = "0x2222222222222222222222222222222222222222";
  const successfulRun = calculationRun({
    runId: "run-success",
    status: "SUCCEEDED",
    requestedAt: "2026-07-25T00:00:00.000Z",
  });
  const failedRun = calculationRun({
    runId: "run-failed",
    status: "FAILED",
    requestedAt: "2026-07-26T00:00:00.000Z",
    errorCode: "UPSTREAM_DATA_INVALID",
    errorMessage: "Stored input could not be processed.",
  });
  const insufficientRun = calculationRun({
    runId: "run-insufficient",
    status: "INSUFFICIENT_DATA",
    precision: "UNAVAILABLE",
  });
  const twrMetric: MetricDto = {
    metricKey: "twr",
    metricValue: "0.123456789012345678",
    precision: "EXACT",
    status: "AVAILABLE",
    warningCodes: [],
    calculationFrom: "2026-07-01T00:00:00.000Z",
    calculationTo: "2026-07-25T00:00:00.000Z",
    metricVersion: "performance-v1",
  };
  const overview: PerformanceOverviewDto = {
    ...emptyPerformanceOverview,
    latestRun: failedRun,
    latestSuccessfulRun: successfulRun,
    latestFailedRun: failedRun,
    metrics: { twr: twrMetric },
    navSummary: {
      count: 2,
      firstDate: "2026-07-24T00:00:00.000Z",
      lastDate: "2026-07-25T00:00:00.000Z",
      firstNav: "1000.000000000000000000",
      lastNav: "1100.000000000000000000",
      minNav: "1000.000000000000000000",
      maxNav: "1100.000000000000000000",
    },
    cycleSummary: {
      total: 3,
      open: 1,
      closed: 2,
      profitable: 1,
      losing: 1,
    },
  };
  const nav: DailyNavDto = {
    id: "nav-1",
    runId: successfulRun.runId,
    date: "2026-07-25T00:00:00.000Z",
    nav: "1100.000000000000000000",
    cashBalance: "900.000000000000000000",
    unrealizedPnl: "200.000000000000000000",
    realizedPnl: "50.000000000000000000",
    funding: "-1.000000000000000000",
    fees: "2.000000000000000000",
    externalCashFlow: null,
    precision: "EXACT",
    historyCompleteness: "COMPLETE",
  };
  const cycle: PositionCycleDto = {
    id: "cycle-1",
    runId: successfulRun.runId,
    coin: "BTC",
    side: "LONG",
    openedAt: "2026-07-25T00:00:00.000Z",
    closedAt: "2026-07-25T01:00:00.000Z",
    averageEntryPrice: "100000.000000000000000000",
    averageExitPrice: "101000.000000000000000000",
    entryQuantity: "0.100000000000000000",
    exitQuantity: "0.100000000000000000",
    grossRealizedPnl: "100.000000000000000000",
    fees: "1.000000000000000000",
    funding: "-0.500000000000000000",
    netRealizedPnl: "98.500000000000000000",
    fillCount: 2,
    status: "CLOSED",
    inputFingerprint: "cycle-fingerprint",
  };

  it("rejects unauthenticated performance requests", async () => {
    const app = await createTestApi();

    const response = await app.inject({
      method: "GET",
      url: `/api/addresses/${address}/performance`,
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ error: "unauthorized" });
  });

  it.each(["calculate", "recalculate"] as const)(
    "rejects unauthenticated performance %s requests",
    async (action) => {
      const app = await createTestApi();

      const response = await app.inject({
        method: "POST",
        url: `/api/addresses/${address}/performance/${action}`,
      });

      expect(response.statusCode).toBe(401);
      expect(response.json()).toMatchObject({ error: "unauthorized" });
    },
  );

  it("queues an initial calculation with HTTP 202", async () => {
    const app = await createTestApi();

    const response = await authorizedPost(app, `/api/addresses/${address}/performance/calculate`);

    expect(response.statusCode).toBe(202);
    expect(response.json()).toEqual({
      calculationVersion: "performance-v1",
      force: false,
      jobId: "calculate-address-performance-test",
      status: "QUEUED",
      walletAddress: address,
    });
  });

  it("queues a forced recalculation with HTTP 202", async () => {
    const app = await createTestApi();

    const response = await authorizedPost(app, `/api/addresses/${address}/performance/recalculate`);

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      force: true,
      status: "QUEUED",
    });
  });

  it("returns not found when calculating an unregistered or unwatched address", async () => {
    const app = await createTestApi(
      addressService,
      withPerformanceService({
        calculate: async (requestedAddress) => {
          throw new AddressNotFoundError(requestedAddress);
        },
      }),
    );

    const response = await authorizedPost(app, `/api/addresses/${address}/performance/calculate`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
  });

  it("rejects a duplicate pending or running calculation", async () => {
    const app = await createTestApi(
      addressService,
      withPerformanceService({
        calculate: async () => {
          throw new PerformanceCalculationConflictError();
        },
      }),
    );

    const response = await authorizedPost(app, `/api/addresses/${address}/performance/calculate`);

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      error: "calculation_in_progress",
      message:
        "A performance calculation is already pending or running for this address and period.",
    });
  });

  it("returns not found for an unregistered address", async () => {
    const app = await createTestApi(
      addressService,
      withPerformanceService({
        getOverview: async (requestedAddress) => {
          throw new AddressNotFoundError(requestedAddress);
        },
      }),
    );

    const response = await authorizedGet(app, `/api/addresses/${address}/performance`);

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
  });

  it("returns nullable runs and empty summaries before the first calculation", async () => {
    const app = await createTestApi();

    const [overviewResponse, navResponse, cyclesResponse] = await Promise.all([
      authorizedGet(app, `/api/addresses/${address}/performance`),
      authorizedGet(app, `/api/addresses/${address}/performance/nav`),
      authorizedGet(app, `/api/addresses/${address}/performance/cycles`),
    ]);

    expect(overviewResponse.json()).toEqual(emptyPerformanceOverview);
    expect(navResponse.json()).toEqual({ items: [], nextCursor: null });
    expect(cyclesResponse.json()).toEqual({ items: [], nextCursor: null });
  });

  it("distinguishes the latest run from the latest successful run", async () => {
    const app = await createTestApi(
      addressService,
      withPerformanceService({ getOverview: async () => overview }),
    );

    const response = await authorizedGet(app, `/api/addresses/${address}/performance`);

    expect(response.json()).toMatchObject({
      latestRun: { runId: "run-failed", status: "FAILED" },
      latestSuccessfulRun: { runId: "run-success", status: "SUCCEEDED" },
    });
  });

  it("returns the latest failed run independently", async () => {
    const app = await createTestApi(
      addressService,
      withPerformanceService({ getOverview: async () => overview }),
    );

    const response = await authorizedGet(app, `/api/addresses/${address}/performance`);

    expect(response.json()).toMatchObject({
      latestFailedRun: {
        runId: "run-failed",
        errorCode: "UPSTREAM_DATA_INVALID",
        errorMessage: "Stored input could not be processed.",
      },
    });
  });

  it("returns INSUFFICIENT_DATA without treating it as a success", async () => {
    const app = await createTestApi(
      addressService,
      withPerformanceService({
        getRun: async () => insufficientRun,
      }),
    );

    const response = await authorizedGet(
      app,
      `/api/addresses/${address}/performance/runs/${insufficientRun.runId}`,
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      runId: "run-insufficient",
      status: "INSUFFICIENT_DATA",
      precision: "UNAVAILABLE",
    });
  });

  it("serializes every financial Decimal as a JSON string", async () => {
    const app = await createTestApi(
      addressService,
      withPerformanceService({
        getOverview: async () => overview,
        listNav: async () => ({ items: [nav], nextCursor: null }),
        listCycles: async () => ({ items: [cycle], nextCursor: null }),
      }),
    );

    const [overviewResponse, navResponse, cycleResponse] = await Promise.all([
      authorizedGet(app, `/api/addresses/${address}/performance`),
      authorizedGet(app, `/api/addresses/${address}/performance/nav`),
      authorizedGet(app, `/api/addresses/${address}/performance/cycles`),
    ]);

    expect(typeof overviewResponse.json().metrics.twr.metricValue).toBe("string");
    expect(typeof navResponse.json().items[0].nav).toBe("string");
    expect(typeof cycleResponse.json().items[0].netRealizedPnl).toBe("string");
  });

  it("does not zero-fill missing metrics", async () => {
    const app = await createTestApi(
      addressService,
      withPerformanceService({ getOverview: async () => overview }),
    );

    const response = await authorizedGet(app, `/api/addresses/${address}/performance`);

    expect(response.json().metrics).toEqual({ twr: twrMetric });
    expect(response.json().metrics).not.toHaveProperty("winRate");
  });

  it("passes the run cursor and limit and returns nextCursor", async () => {
    let received: unknown;
    const app = await createTestApi(
      addressService,
      withPerformanceService({
        listRuns: async (_address, query) => {
          received = query;
          return { items: [successfulRun], nextCursor: "run-success" };
        },
      }),
    );

    const response = await authorizedGet(
      app,
      `/api/addresses/${address}/performance/runs?limit=10&cursor=run-newer`,
    );

    expect(received).toEqual({ cursor: "run-newer", limit: 10 });
    expect(response.json()).toEqual({
      items: [successfulRun],
      nextCursor: "run-success",
    });
  });

  it("uses NAV run and cursor pagination parameters", async () => {
    let received: unknown;
    const app = await createTestApi(
      addressService,
      withPerformanceService({
        listNav: async (_address, query) => {
          received = query;
          return { items: [nav], nextCursor: "nav-1" };
        },
      }),
    );

    const response = await authorizedGet(
      app,
      `/api/addresses/${address}/performance/nav?runId=run-success&limit=25&cursor=nav-0`,
    );

    expect(received).toEqual({
      cursor: "nav-0",
      limit: 25,
      runId: "run-success",
    });
    expect(response.json().nextCursor).toBe("nav-1");
  });

  it("uses cycle run and cursor pagination parameters", async () => {
    let received: unknown;
    const app = await createTestApi(
      addressService,
      withPerformanceService({
        listCycles: async (_address, query) => {
          received = query;
          return { items: [cycle], nextCursor: "cycle-1" };
        },
      }),
    );

    const response = await authorizedGet(
      app,
      `/api/addresses/${address}/performance/cycles?runId=run-success&limit=25&cursor=cycle-0`,
    );

    expect(received).toEqual({
      cursor: "cycle-0",
      limit: 25,
      runId: "run-success",
    });
    expect(response.json().nextCursor).toBe("cycle-1");
  });

  it("does not expose a run owned by another address", async () => {
    const app = await createTestApi(
      addressService,
      withPerformanceService({
        getRun: async (_requestedAddress, runId) => {
          throw new PerformanceRunNotFoundError(runId);
        },
      }),
    );

    const response = await authorizedGet(
      app,
      `/api/addresses/${address}/performance/runs/other-wallet-run`,
    );

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
  });

  it("keeps performance responses scoped to the requested address", async () => {
    const app = await createTestApi(
      addressService,
      withPerformanceService({
        getOverview: async (requestedAddress) => ({
          ...emptyPerformanceOverview,
          walletAddress: requestedAddress,
          metrics: requestedAddress === address ? { twr: twrMetric } : {},
        }),
      }),
    );

    const [first, second] = await Promise.all([
      authorizedGet(app, `/api/addresses/${address}/performance`),
      authorizedGet(app, `/api/addresses/${otherAddress}/performance`),
    ]);

    expect(first.json()).toMatchObject({
      walletAddress: address,
      metrics: { twr: twrMetric },
    });
    expect(second.json()).toMatchObject({
      walletAddress: otherAddress,
      metrics: {},
    });
  });

  it("rejects limits above each endpoint maximum", async () => {
    const app = await createTestApi();

    const responses = await Promise.all([
      authorizedGet(app, `/api/addresses/${address}/performance/runs?limit=101`),
      authorizedGet(app, `/api/addresses/${address}/performance/nav?limit=501`),
      authorizedGet(app, `/api/addresses/${address}/performance/cycles?limit=201`),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400]);
    for (const response of responses) {
      expect(response.json()).toMatchObject({ error: "validation_error" });
    }
  });

  it("does not expose secrets or stack traces from unhandled errors", async () => {
    const app = await createTestApi(
      addressService,
      withPerformanceService({
        getOverview: async () => {
          throw new Error(`Database failed with ${env.INTERNAL_API_SECRET}\n    at secret.ts:10:2`);
        },
      }),
    );

    const response = await authorizedGet(app, `/api/addresses/${address}/performance`);
    const body = response.body;

    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: "internal_server_error",
      message: "The API could not complete the request.",
    });
    expect(body).not.toContain(env.INTERNAL_API_SECRET);
    expect(body).not.toContain("secret.ts");
    expect(body).not.toContain("at ");
  });
});

function calculationRun(overrides: Partial<CalculationRunDto> = {}): CalculationRunDto {
  return {
    runId: "run-1",
    status: "SUCCEEDED",
    calculationVersion: "performance-v1",
    calculationFrom: "2026-07-01T00:00:00.000Z",
    calculationTo: "2026-07-25T00:00:00.000Z",
    requestedAt: "2026-07-25T00:00:00.000Z",
    startedAt: "2026-07-25T00:00:01.000Z",
    completedAt: "2026-07-25T00:00:02.000Z",
    historyCompleteness: "COMPLETE",
    precision: "EXACT",
    warningCount: 0,
    warningCodes: [],
    errorCode: null,
    errorMessage: null,
    inputFingerprint: "1234567890abcdef",
    inputFingerprintShort: "1234567890ab",
    ...overrides,
  };
}

async function authorizedGet(app: Awaited<ReturnType<typeof createApi>>, url: string) {
  return app.inject({
    method: "GET",
    url,
    headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
  });
}

async function authorizedPost(app: Awaited<ReturnType<typeof createApi>>, url: string) {
  return app.inject({
    method: "POST",
    url,
    headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
  });
}
