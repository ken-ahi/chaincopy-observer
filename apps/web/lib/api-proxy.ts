import { loadRootEnvironment, readWebEnv } from "@chaincopy/config";
import { getServerSession } from "next-auth";
import { NextResponse, type NextRequest } from "next/server";

import { authOptions } from "./auth";
import { isAllowedAdminEmail } from "./authorization";

export async function proxyInternalApi(
  request: NextRequest,
  pathSegments: ReadonlyArray<string>,
): Promise<NextResponse> {
  loadRootEnvironment();
  const env = readWebEnv();
  const session = await getServerSession(authOptions);
  if (!session?.user?.email || !isAllowedAdminEmail(session.user.email, env.ALLOWED_ADMIN_EMAIL)) {
    return NextResponse.json(
      { error: "unauthorized", message: "Authentication is required." },
      { status: 401 },
    );
  }

  const target = new URL(
    `/api/${pathSegments.map(encodeURIComponent).join("/")}`,
    env.API_BASE_URL,
  );
  target.search = request.nextUrl.search;

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
    });
    return new NextResponse(await response.text(), {
      headers: {
        "content-type": response.headers.get("content-type") ?? "application/json",
      },
      status: response.status,
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "internal_api_proxy_failed",
        message: error instanceof Error ? error.message : String(error),
        path: target.pathname,
      }),
    );
    return NextResponse.json(
      {
        error: "upstream_unavailable",
        message: "The internal API is unavailable.",
      },
      { status: 502 },
    );
  }
}
