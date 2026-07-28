import { loadRootEnvironment, readWebEnv } from "@chaincopy/config";
import { NextResponse } from "next/server";

import { parseServiceBuildInfo } from "./build-info";

type FetchVersion = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function fetchApiVersion(fetchVersion: FetchVersion = fetch): Promise<NextResponse> {
  loadRootEnvironment();

  try {
    const env = readWebEnv();
    const response = await fetchVersion(new URL("/version", env.API_BASE_URL), {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) {
      return unavailableResponse();
    }

    const buildInfo = parseServiceBuildInfo(await response.json(), "api");
    if (!buildInfo) {
      return unavailableResponse();
    }

    return NextResponse.json(buildInfo, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    console.error(JSON.stringify({ event: "api_version_fetch_failed" }));
    return unavailableResponse();
  }
}

function unavailableResponse(): NextResponse {
  return NextResponse.json(
    {
      error: "service_unavailable",
      message: "APIバージョン取得失敗",
    },
    {
      headers: { "Cache-Control": "no-store" },
      status: 503,
    },
  );
}
