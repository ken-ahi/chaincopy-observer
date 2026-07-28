import { loadRootEnvironment, readWebEnv } from "@chaincopy/config";
import { getServerSession } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";

import { authOptions } from "./auth";
import { isAllowedAdminEmail } from "./authorization";

export interface InternalApiProxyOptions {
  readonly allowedQueryKeys?: ReadonlyArray<string>;
  readonly conflictMessage?: string;
  readonly safeJsonResponse?: boolean;
}

export async function proxyInternalApi(
  request: NextRequest,
  pathSegments: ReadonlyArray<string>,
  options: InternalApiProxyOptions = {},
): Promise<NextResponse> {
  loadRootEnvironment();
  const env = readWebEnv();
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return authenticationError(
      options.safeJsonResponse,
      401,
      "authentication_required",
      "Authentication is required.",
    );
  }
  if (!isAllowedAdminEmail(session.user.email, env.ALLOWED_ADMIN_EMAIL)) {
    return authenticationError(
      options.safeJsonResponse,
      options.safeJsonResponse ? 403 : 401,
      "forbidden",
      "Administrator access is required.",
    );
  }

  const target = new URL(
    `/api/${pathSegments.map(encodeURIComponent).join("/")}`,
    env.API_BASE_URL,
  );
  if (options.allowedQueryKeys) {
    for (const key of options.allowedQueryKeys) {
      for (const value of request.nextUrl.searchParams.getAll(key)) {
        target.searchParams.append(key, value);
      }
    }
  } else {
    target.search = request.nextUrl.search;
  }

  try {
    const requestBody =
      request.method === "GET" || request.method === "HEAD" ? null : await request.text();
    const response = await fetch(target, {
      ...(requestBody ? { body: requestBody } : {}),
      cache: "no-store",
      headers: {
        accept: "application/json",
        ...(requestBody
          ? {
              "content-type": request.headers.get("content-type") ?? "application/json",
            }
          : {}),
        "x-internal-api-secret": env.INTERNAL_API_SECRET,
      },
      method: request.method,
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(10_000)]),
    });
    if (options.safeJsonResponse) {
      return safeJsonResponse(response, options.conflictMessage);
    }
    return new NextResponse(await response.text(), {
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
      status: response.status,
    });
  } catch {
    console.error(
      JSON.stringify({
        event: "internal_api_proxy_failed",
        path: target.pathname,
      }),
    );
    return proxyError(
      options.safeJsonResponse,
      502,
      "upstream_unavailable",
      "The internal API is unavailable.",
    );
  }
}

function authenticationError(
  safeJsonResponse: boolean | undefined,
  status: number,
  code: string,
  message: string,
): NextResponse {
  if (safeJsonResponse) {
    return NextResponse.json({ error: { code, message } }, { status });
  }
  return NextResponse.json({ error: code, message }, { status });
}

async function safeJsonResponse(
  response: Response,
  conflictMessage?: string,
): Promise<NextResponse> {
  if (!response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return safeProxyError(
      502,
      "invalid_upstream_response",
      "The internal API response was invalid.",
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return safeProxyError(
      502,
      "invalid_upstream_response",
      "The internal API response was invalid.",
    );
  }

  if (response.ok) {
    return NextResponse.json(payload, { status: response.status });
  }

  switch (response.status) {
    case 400:
      return safeProxyError(400, "bad_request", "The request was rejected.");
    case 401:
      return safeProxyError(
        401,
        "upstream_unauthorized",
        "The internal API rejected authentication.",
      );
    case 403:
      return safeProxyError(403, "upstream_forbidden", "The internal API rejected access.");
    case 404:
      return safeProxyError(404, "not_found", "The requested resource was not found.");
    case 409:
      return safeProxyError(
        409,
        "conflict",
        conflictMessage ?? "A calculation is already in progress.",
      );
    case 429:
      return safeProxyError(429, "rate_limited", "Too many requests.");
    default:
      return safeProxyError(
        502,
        "upstream_failure",
        "The internal API could not complete the request.",
      );
  }
}

function proxyError(
  safeJsonResponse: boolean | undefined,
  status: number,
  code: string,
  message: string,
): NextResponse {
  if (safeJsonResponse) {
    return safeProxyError(status, code, message);
  }
  return NextResponse.json({ error: code, message }, { status });
}

function safeProxyError(status: number, code: string, message: string): NextResponse {
  return NextResponse.json({ error: { code, message } }, { status });
}
