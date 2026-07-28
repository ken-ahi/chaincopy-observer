import { readFileSync } from "node:fs";

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

const address = "0x1111111111111111111111111111111111111111";

beforeEach(() => {
  testState.session = { user: { email: "owner@example.com" } };
  testState.fetch.mockReset();
  testState.fetch.mockResolvedValue(
    jsonResponse({ jobId: "filter-candidate-1", status: "QUEUED" }, 202),
  );
  vi.stubGlobal("fetch", testState.fetch);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Discovery exclusion BFF", () => {
  it("rejects unauthenticated requests without contacting the internal API", async () => {
    testState.session = null;

    const response = await unexcludeRequest();

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: {
        code: "authentication_required",
        message: "Authentication is required.",
      },
    });
    expect(testState.fetch).not.toHaveBeenCalled();
  });

  it("rejects authenticated non-administrators with 403", async () => {
    testState.session = { user: { email: "other@example.com" } };

    const response = await unexcludeRequest();

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: {
        code: "forbidden",
        message: "Administrator access is required.",
      },
    });
    expect(testState.fetch).not.toHaveBeenCalled();
  });

  it("forwards DELETE through the fixed internal path and keeps the secret server-side", async () => {
    const response = await unexcludeRequest("?secret=browser-value");
    const [target, init] = testState.fetch.mock.calls.at(-1) as [URL, RequestInit];

    expect(response.status).toBe(202);
    expect(target.toString()).toBe(
      `http://api.internal:3001/api/discovery/candidates/${address}/exclude`,
    );
    expect(init.method).toBe("DELETE");
    expect(new Headers(init.headers).get("x-internal-api-secret")).toBe("internal-secret-value");
    expect(JSON.stringify(await response.json())).not.toContain("internal-secret-value");
  });

  it("exports DELETE from the discovery route with safe proxy handling", () => {
    const source = readFileSync(
      new URL("../app/api/discovery/[[...path]]/route.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("export const DELETE = handle");
    expect(source).toContain("safeJsonResponse: true");
    expect(source).toContain("conflictMessage:");
  });

  it.each([400, 401, 403, 404, 409])(
    "safely preserves supported upstream status %s",
    async (status) => {
      testState.fetch.mockResolvedValue(
        jsonResponse(
          {
            error: "upstream",
            message: "redis://user:password@internal\nstack: private\ninternal-secret-value",
          },
          status,
        ),
      );

      const response = await unexcludeRequest();
      const body = JSON.stringify(await response.json());

      expect(response.status).toBe(status);
      expect(body).not.toContain("redis://");
      expect(body).not.toContain("stack:");
      expect(body).not.toContain("internal-secret-value");
      if (status === 409) {
        expect(JSON.parse(body)).toEqual({
          error: {
            code: "conflict",
            message: "候補の状態が変更されたため操作できません。再読み込みしてください。",
          },
        });
      }
    },
  );

  it("converts unexpected upstream failures to a safe 502", async () => {
    testState.fetch.mockResolvedValue(
      jsonResponse({ message: "postgresql://secret@internal/database\nstack: private" }, 500),
    );

    const response = await unexcludeRequest();
    const body = await response.json();

    expect(response.status).toBe(502);
    expect(body).toEqual({
      error: {
        code: "upstream_failure",
        message: "The internal API could not complete the request.",
      },
    });
  });
});

async function unexcludeRequest(search = "") {
  return proxyInternalApi(
    new NextRequest(`http://localhost/api/discovery/candidates/${address}/exclude${search}`, {
      method: "DELETE",
    }),
    ["discovery", "candidates", address, "exclude"],
    {
      allowedQueryKeys: ["cursor", "enrichmentStatus", "filterStatus", "limit", "search"],
      conflictMessage: "候補の状態が変更されたため操作できません。再読み込みしてください。",
      safeJsonResponse: true,
    },
  );
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
    status,
  });
}
