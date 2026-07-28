import { type NextRequest } from "next/server";

import { proxyInternalApi } from "@/lib/api-proxy";

interface RouteContext {
  readonly params: Promise<{ readonly path?: ReadonlyArray<string> }>;
}

async function handle(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  return proxyInternalApi(request, ["discovery", ...(params.path ?? [])], {
    allowedQueryKeys: ["cursor", "enrichmentStatus", "filterStatus", "limit", "search"],
    conflictMessage: "The candidate cannot be changed in its current state.",
    safeJsonResponse: true,
  });
}

export const DELETE = handle;
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
