import { type NextRequest } from "next/server";

import { proxyInternalApi } from "@/lib/api-proxy";

interface RouteContext {
  readonly params: Promise<{ readonly path?: ReadonlyArray<string> }>;
}

async function handle(request: NextRequest, context: RouteContext) {
  const params = await context.params;
  return proxyInternalApi(request, ["discovery", ...(params.path ?? [])], {
    allowedQueryKeys: ["cursor", "enrichmentStatus", "filterStatus", "limit", "search"],
    conflictMessage: "候補の状態が変更されたため操作できません。再読み込みしてください。",
    safeJsonResponse: true,
  });
}

export const DELETE = handle;
export const GET = handle;
export const POST = handle;
export const PATCH = handle;
