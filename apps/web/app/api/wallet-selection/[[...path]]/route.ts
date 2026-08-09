import { type NextRequest } from "next/server";

import { proxyInternalApi } from "@/lib/api-proxy";

interface RouteContext {
  readonly params: Promise<{ readonly path?: ReadonlyArray<string> }>;
}

async function handle(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  return proxyInternalApi(request, ["wallet-selection", ...(params.path ?? [])], {
    safeJsonResponse: true,
  });
}

export const GET = handle;
export const PATCH = handle;
export const POST = handle;
