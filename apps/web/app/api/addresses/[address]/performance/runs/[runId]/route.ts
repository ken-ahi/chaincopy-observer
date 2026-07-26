import { type NextRequest } from "next/server";

import { proxyInternalApi } from "@/lib/api-proxy";

interface RouteContext {
  readonly params: Promise<{
    readonly address: string;
    readonly runId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { address, runId } = await context.params;
  return proxyInternalApi(request, ["addresses", address, "performance", "runs", runId], {
    allowedQueryKeys: [],
    safeJsonResponse: true,
  });
}
