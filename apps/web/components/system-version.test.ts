import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { compareBuildInfo, type ServiceBuildInfo } from "../lib/build-info";
import { getApiBuildInfoOnce } from "../lib/system-version-client";
import { SystemVersionView } from "./system-version";

const web: ServiceBuildInfo = {
  service: "web",
  version: "0.3.0",
  commit: "dc37ffc",
  builtAt: "2026-07-28T13:30:00.000Z",
};

const api: ServiceBuildInfo = {
  service: "api",
  version: "0.3.0",
  commit: "dc37ffc",
  builtAt: "2026-07-28T13:30:00.000Z",
};

describe("SystemVersion", () => {
  it("shows Web and API version, commit, build time, and connected state", () => {
    const html = renderVersion(api, "connected");

    expect(html).toContain("Web v0.3.0");
    expect(html).toContain("API v0.3.0");
    expect(html).toContain("dc37ffc");
    expect(html).toContain("接続済み");
    expect(html).toContain("Web builtAt: 2026-07-28T13:30:00.000Z");
    expect(html).toContain("API builtAt: 2026-07-28T13:30:00.000Z");
  });

  it("requires both version and commit to match", () => {
    expect(compareBuildInfo(web, api)).toBe("connected");
    expect(compareBuildInfo(web, { ...api, version: "0.2.1" })).toBe("mismatch");
    expect(compareBuildInfo(web, { ...api, commit: "1234567" })).toBe("mismatch");
  });

  it.each([
    ["version", { ...api, version: "0.2.1" }],
    ["commit", { ...api, commit: "1234567" }],
  ])("shows the mismatch warning for a %s mismatch", (_field, mismatchedApi) => {
    const html = renderVersion(mismatchedApi, "mismatch");

    expect(html).toContain("Web/APIのビルドが一致していません");
  });

  it("keeps page content visible when the API version request fails", () => {
    const html = renderToStaticMarkup(
      createElement(
        "main",
        null,
        createElement("h1", null, "Observation deck"),
        createElement(SystemVersionView, {
          api: null,
          status: "unavailable",
          web,
        }),
      ),
    );

    expect(html).toContain("Observation deck");
    expect(html).toContain("Web v0.3.0");
    expect(html).toContain("APIバージョン取得失敗");
  });

  it("shares one no-store request across initial consumers", async () => {
    const fetchVersion = vi.fn(async () => jsonResponse(api));

    const [first, second, third] = await Promise.all([
      getApiBuildInfoOnce(fetchVersion),
      getApiBuildInfoOnce(fetchVersion),
      getApiBuildInfoOnce(fetchVersion),
    ]);

    expect(fetchVersion).toHaveBeenCalledTimes(1);
    expect(fetchVersion).toHaveBeenCalledWith("/api/system/version", {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    expect(first).toEqual(api);
    expect(second).toBe(first);
    expect(third).toBe(first);
  });
});

function renderVersion(apiBuildInfo: ServiceBuildInfo, status: "connected" | "mismatch"): string {
  return renderToStaticMarkup(
    createElement(SystemVersionView, {
      api: apiBuildInfo,
      status,
      web,
    }),
  );
}

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json" },
  });
}
