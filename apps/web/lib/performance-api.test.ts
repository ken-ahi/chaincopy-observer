import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  fetch: vi.fn(),
  session: { user: { email: "owner@example.com" } } as {
    readonly user?: { readonly email?: string | null };
  } | null,
}));

vi.mock("@chaincopy/config", () => ({
  loadRootEnvironment: vi.fn(),
  readWebEnv: () => ({
    ALLOWED_ADMIN_EMAIL: "owner@example.com",
    API_BASE_URL: "http://api.internal:3001",
    INTERNAL_API_SECRET: "internal-secret-value",
  }),
}));

vi.mock("next-auth", () => ({
  getServerSession: vi.fn(async () => testState.session),
}));

vi.mock("./auth", () => ({
  authOptions: {},
}));

import { proxyInternalApi } from "./api-proxy.js";
import {
  calculateAddressPerformance,
  getAddressPerformance,
  getAddressPerformanceCycles,
  getAddressPerformanceNav,
  getAddressPerformanceRun,
  getAddressPerformanceRuns,
  recalculateAddressPerformance,
  type AddressPerformanceDto,
} from "./performance-api.js";

const address = "0x1111111111111111111111111111111111111111";
const emptyOverview: AddressPerformanceDto = {
  walletAddress: address,
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

beforeEach(() => {
  testState.session = { user: { email: "owner@example.com" } };
  testState.fetch.mockReset();
  testState.fetch.mockResolvedValue(jsonResponse(emptyOverview));
  vi.stubGlobal("fetch", testState.fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Performance API BFF", () => {
  it("returns 401 when the request is unauthenticated", async () => {
    testState.session = null;

    const response = await performanceProxy("/performance", ["addresses", address, "performance"]);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "authentication_required",
        message: "Authentication is required.",
      },
    });
    expect(testState.fetch).not.toHaveBeenCalled();
  });

  it("returns 403 when the authenticated user is not the allowed administrator", async () => {
    testState.session = { user: { email: "other@example.com" } };

    const response = await performanceProxy("/performance", ["addresses", address, "performance"]);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        message: "Administrator access is required.",
      },
    });
    expect(testState.fetch).not.toHaveBeenCalled();
  });

  it("forwards the performance overview to the fixed internal API", async () => {
    const response = await performanceProxy("/performance", ["addresses", address, "performance"]);
    const [target, init] = lastFetch();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(emptyOverview);
    expect(target.toString()).toBe(`http://api.internal:3001/api/addresses/${address}/performance`);
    expect(new Headers(init.headers).get("x-internal-api-secret")).toBe("internal-secret-value");
  });

  it.each(["calculate", "recalculate"] as const)(
    "forwards POST /performance/%s without query parameters",
    async (action) => {
      testState.fetch.mockResolvedValue(
        jsonResponse(
          {
            calculationVersion: "performance-v1",
            force: action === "recalculate",
            jobId: `${action}-job`,
            status: "QUEUED",
            walletAddress: address,
          },
          202,
        ),
      );

      const response = await performanceProxy(
        `/${action}?debug=discard`,
        ["addresses", address, "performance", action],
        [],
        "POST",
      );

      expect(response.status).toBe(202);
      const [target, init] = lastFetch();
      expect(target.search).toBe("");
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).get("x-internal-api-secret")).toBe("internal-secret-value");
    },
  );

  it("forwards only allowed runs query parameters", async () => {
    await performanceProxy(
      "/runs?cursor=run-1&limit=20&unknown=discard",
      ["addresses", address, "performance", "runs"],
      ["cursor", "limit"],
    );

    expect(lastFetch()[0].search).toBe("?cursor=run-1&limit=20");
  });

  it("forwards the run detail path", async () => {
    await performanceProxy("/runs/run-1", ["addresses", address, "performance", "runs", "run-1"]);

    expect(lastFetch()[0].pathname).toBe(`/api/addresses/${address}/performance/runs/run-1`);
  });

  it("forwards only allowed NAV query parameters", async () => {
    await performanceProxy(
      "/nav?runId=run-1&cursor=nav-1&limit=100&unknown=discard",
      ["addresses", address, "performance", "nav"],
      ["runId", "cursor", "limit"],
    );

    expect(lastFetch()[0].search).toBe("?runId=run-1&cursor=nav-1&limit=100");
  });

  it("forwards only allowed cycle query parameters", async () => {
    await performanceProxy(
      "/cycles?runId=run-1&cursor=cycle-1&limit=50&unknown=discard",
      ["addresses", address, "performance", "cycles"],
      ["runId", "cursor", "limit"],
    );

    expect(lastFetch()[0].search).toBe("?runId=run-1&cursor=cycle-1&limit=50");
  });

  it("does not forward unknown overview query parameters", async () => {
    await performanceProxy("/performance?target=https://attacker.invalid&debug=true", [
      "addresses",
      address,
      "performance",
    ]);

    expect(lastFetch()[0].origin).toBe("http://api.internal:3001");
    expect(lastFetch()[0].search).toBe("");
  });

  it("URL-encodes the address path segment", async () => {
    await performanceProxy("/performance", ["addresses", "wallet/with ? reserved", "performance"]);

    expect(lastFetch()[0].pathname).toBe(
      "/api/addresses/wallet%2Fwith%20%3F%20reserved/performance",
    );
  });

  it("URL-encodes the runId path segment", async () => {
    await performanceProxy("/runs/detail", [
      "addresses",
      address,
      "performance",
      "runs",
      "run/with ? reserved",
    ]);

    expect(lastFetch()[0].pathname).toBe(
      `/api/addresses/${address}/performance/runs/run%2Fwith%20%3F%20reserved`,
    );
  });

  it("maps an upstream 404 to a safe 404", async () => {
    testState.fetch.mockResolvedValue(
      jsonResponse({ error: "not_found", message: "internal detail" }, 404),
    );

    const response = await performanceProxy("/performance", ["addresses", address, "performance"]);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: {
        code: "not_found",
        message: "The requested resource was not found.",
      },
    });
  });

  it.each([
    [400, "bad_request", "The request was rejected."],
    [401, "upstream_unauthorized", "The internal API rejected authentication."],
    [403, "upstream_forbidden", "The internal API rejected access."],
  ] as const)(
    "maps an upstream %i without exposing its response body",
    async (status, code, message) => {
      testState.fetch.mockResolvedValue(
        jsonResponse({ error: "internal detail", secret: "internal-secret-value" }, status),
      );

      const response = await performanceProxy("/performance", [
        "addresses",
        address,
        "performance",
      ]);

      expect(response.status).toBe(status);
      expect(await response.json()).toEqual({ error: { code, message } });
    },
  );

  it("maps an upstream 429 to a safe 429", async () => {
    testState.fetch.mockResolvedValue(jsonResponse({ error: "rate_limit" }, 429));

    const response = await performanceProxy("/performance", ["addresses", address, "performance"]);

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({
      error: { code: "rate_limited", message: "Too many requests." },
    });
  });

  it("maps an upstream 500 to a safe 502", async () => {
    testState.fetch.mockResolvedValue(
      jsonResponse({ error: "Prisma failed at C:\\private\\service.ts" }, 500),
    );

    const response = await performanceProxy("/performance", ["addresses", address, "performance"]);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "upstream_failure",
        message: "The internal API could not complete the request.",
      },
    });
  });

  it("maps an upstream 409 to a safe conflict", async () => {
    testState.fetch.mockResolvedValue(
      jsonResponse({ error: "calculation_in_progress", secret: "internal-secret-value" }, 409),
    );

    const response = await performanceProxy(
      "/calculate",
      ["addresses", address, "performance", "calculate"],
      [],
      "POST",
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: { code: "conflict", message: "A calculation is already in progress." },
    });
  });

  it("maps a non-JSON upstream response to a safe 502", async () => {
    testState.fetch.mockResolvedValue(
      new Response("postgresql://user:password@database.internal/chaincopy", {
        headers: { "content-type": "text/plain" },
        status: 500,
      }),
    );

    const response = await performanceProxy("/performance", ["addresses", address, "performance"]);

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "invalid_upstream_response",
        message: "The internal API response was invalid.",
      },
    });
  });

  it("does not expose the internal secret from an upstream failure", async () => {
    testState.fetch.mockResolvedValue(
      jsonResponse(
        {
          error: "internal-secret-value",
          message: "redis://redis.internal:6379\n at C:\\private\\service.ts",
        },
        500,
      ),
    );

    const response = await performanceProxy("/performance", ["addresses", address, "performance"]);
    const body = await response.text();

    expect(body).not.toContain("internal-secret-value");
    expect(body).not.toContain("redis.internal");
    expect(body).not.toContain("service.ts");
  });

  it("returns a safe 502 without logging a rejected fetch error message", async () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
    testState.fetch.mockRejectedValue(
      new Error("internal-secret-value at C:\\private\\service.ts"),
    );

    const response = await performanceProxy("/performance", ["addresses", address, "performance"]);

    expect(response.status).toBe(502);
    expect(errorLog).toHaveBeenCalledOnce();
    expect(errorLog.mock.calls.flat().join(" ")).not.toContain("internal-secret-value");
  });
});

describe("Performance API browser client", () => {
  it("preserves Decimal strings without adding missing metrics", async () => {
    const upstream: AddressPerformanceDto = {
      ...emptyOverview,
      metrics: {
        twr: {
          metricKey: "twr",
          metricValue: "0.123456789012345678",
          precision: "EXACT",
          status: "AVAILABLE",
          warningCodes: [],
          calculationFrom: "2026-07-01T00:00:00.000Z",
          calculationTo: "2026-07-25T00:00:00.000Z",
          metricVersion: "performance-v1",
        },
      },
      navSummary: {
        ...emptyOverview.navSummary,
        count: 1,
        firstNav: "1000.000000000000000001",
        lastNav: "1000.000000000000000001",
        minNav: "1000.000000000000000001",
        maxNav: "1000.000000000000000001",
      },
    };
    testState.fetch.mockResolvedValue(jsonResponse(upstream));

    const result = await getAddressPerformance(address);

    expect(result.metrics.twr?.metricValue).toBe("0.123456789012345678");
    expect(result.navSummary.firstNav).toBe("1000.000000000000000001");
    expect(result.metrics).not.toHaveProperty("winRate");
  });

  it("uses only BFF URLs and never sends the internal secret", async () => {
    await getAddressPerformance("wallet/with reserved");
    const [input, init] = testState.fetch.mock.calls.at(-1) as [string, RequestInit];

    expect(input).toBe("/api/addresses/wallet%2Fwith%20reserved/performance");
    expect(input).not.toContain("api.internal");
    expect(new Headers(init.headers).has("x-internal-api-secret")).toBe(false);
    expect(getAddressPerformance.toString()).not.toContain("internal-secret-value");
  });

  it("builds runs, run detail, NAV, and cycles BFF requests", async () => {
    testState.fetch.mockImplementation(async () => jsonResponse({ items: [], nextCursor: null }));

    await getAddressPerformanceRuns(address, { cursor: "run cursor", limit: 20 });
    await getAddressPerformanceRun(address, "run/1");
    await getAddressPerformanceNav(address, {
      runId: "run 1",
      cursor: "nav cursor",
      limit: 100,
    });
    await getAddressPerformanceCycles(address, {
      runId: "run 1",
      cursor: "cycle cursor",
      limit: 50,
    });

    expect(testState.fetch.mock.calls.map(([input]) => input)).toEqual([
      `/api/addresses/${address}/performance/runs?cursor=run+cursor&limit=20`,
      `/api/addresses/${address}/performance/runs/run%2F1`,
      `/api/addresses/${address}/performance/nav?runId=run+1&cursor=nav+cursor&limit=100`,
      `/api/addresses/${address}/performance/cycles?runId=run+1&cursor=cycle+cursor&limit=50`,
    ]);
  });

  it("builds calculate and recalculate requests without exposing the internal secret", async () => {
    testState.fetch.mockImplementation(async () =>
      jsonResponse(
        {
          calculationVersion: "performance-v1",
          force: false,
          jobId: "performance-job",
          status: "QUEUED",
          walletAddress: address,
        },
        202,
      ),
    );

    await calculateAddressPerformance(address);
    await recalculateAddressPerformance(address);

    expect(testState.fetch.mock.calls.map(([input]) => input)).toEqual([
      `/api/addresses/${address}/performance/calculate`,
      `/api/addresses/${address}/performance/recalculate`,
    ]);
    for (const [, init] of testState.fetch.mock.calls as Array<[string, RequestInit]>) {
      expect(init.method).toBe("POST");
      expect(new Headers(init.headers).has("x-internal-api-secret")).toBe(false);
    }
  });
});

async function performanceProxy(
  path: string,
  pathSegments: ReadonlyArray<string>,
  allowedQueryKeys: ReadonlyArray<string> = [],
  method = "GET",
) {
  return proxyInternalApi(
    new NextRequest(`http://localhost/api/addresses/${address}/performance${path}`, { method }),
    pathSegments,
    {
      allowedQueryKeys,
      safeJsonResponse: true,
    },
  );
}

function lastFetch(): [URL, RequestInit] {
  return testState.fetch.mock.calls.at(-1) as [URL, RequestInit];
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
