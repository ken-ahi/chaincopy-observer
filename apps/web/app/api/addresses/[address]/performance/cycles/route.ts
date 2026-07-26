import { type NextRequest } from "next/server";

import { proxyInternalApi } from "@/lib/api-proxy";

interface RouteContext {
  readonly params: Promise<{ readonly address: string }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const { address } = await context.params;
  return proxyInternalApi(request, ["addresses", address, "performance", "cycles"], {
    allowedQueryKeys: ["runId", "cursor", "limit"],
    safeJsonResponse: true,
  });
}
