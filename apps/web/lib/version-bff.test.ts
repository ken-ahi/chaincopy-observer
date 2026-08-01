import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.mock("@chaincopy/config", () => ({
  loadRootEnvironment: vi.fn(),
  readWebEnv: () => ({
    API_BASE_URL: "http://api.internal:3001",
  }),
}));

import { fetchApiVersion } from "./version-bff";

const apiBuildInfo = {
  service: "api",
  version: "0.3.1",
  commit: "dc37ffc",
  builtAt: "2026-07-28T13:30:00.000Z",
};

beforeEach(() => {
  testState.fetch.mockReset();
  testState.fetch.mockResolvedValue(jsonResponse(apiBuildInfo));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/system/version BFF", () => {
  it("fetches the fixed API /version endpoint without caching", async () => {
    const response = await fetchApiVersion(testState.fetch);
    const [target, init] = testState.fetch.mock.calls[0] as [URL, RequestInit];

    expect(target.toString()).toBe("http://api.internal:3001/version");
    expect(init.cache).toBe("no-store");
    expect(await response.json()).toEqual(apiBuildInfo);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it.each([
    ["upstream rejection", () => Promise.reject(new Error("internal stack and URL"))],
    ["upstream error", () => Promise.resolve(jsonResponse({ secret: "value" }, 500))],
    ["invalid payload", () => Promise.resolve(jsonResponse({ service: "api" }))],
  ])("returns a safe 503 for %s", async (_case, result) => {
    testState.fetch.mockImplementationOnce(result);

    const response = await fetchApiVersion(testState.fetch);
    const body = JSON.stringify(await response.json());

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(JSON.parse(body)).toEqual({
      error: "service_unavailable",
      message: "APIバージョン取得失敗",
    });
    expect(body).not.toContain("api.internal");
    expect(body).not.toContain("stack");
    expect(body).not.toContain("secret");
  });
});

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
