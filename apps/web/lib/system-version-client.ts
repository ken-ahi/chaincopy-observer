"use client";

import { parseServiceBuildInfo, type ServiceBuildInfo } from "./build-info";

type FetchVersion = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

let apiBuildInfoRequest: Promise<ServiceBuildInfo> | null = null;

export function getApiBuildInfoOnce(fetchVersion: FetchVersion = fetch): Promise<ServiceBuildInfo> {
  apiBuildInfoRequest ??= requestApiBuildInfo(fetchVersion);
  return apiBuildInfoRequest;
}

async function requestApiBuildInfo(fetchVersion: FetchVersion): Promise<ServiceBuildInfo> {
  const response = await fetchVersion("/api/system/version", {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error("API version request failed.");
  }

  const buildInfo = parseServiceBuildInfo(await response.json(), "api");
  if (!buildInfo) {
    throw new Error("API version response was invalid.");
  }
  return buildInfo;
}
