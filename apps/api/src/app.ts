import { createHash, timingSafeEqual } from "node:crypto";

import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { errorDetails, type ApiEnv } from "@chaincopy/config";
import Fastify, { LogController } from "fastify";
import { type Logger } from "pino";

import { registerAddressRoutes } from "./address-routes.js";
import { type AddressService } from "./address-service.js";
import { registerDiscoveryRoutes } from "./discovery-routes.js";
import { type DiscoveryService } from "./discovery-service.js";
import { type HealthService } from "./health.js";

export interface CreateApiOptions {
  readonly addressService: AddressService;
  readonly discoveryService: DiscoveryService;
  readonly env: ApiEnv;
  readonly healthService: HealthService;
  readonly logger: Logger;
}

export async function createApi(options: CreateApiOptions) {
  const app = Fastify({
    logController: new LogController({
      disableRequestLogging: true,
    }),
    loggerInstance: options.logger,
  });

  await app.register(helmet, {
    contentSecurityPolicy: false,
  });
  await app.register(rateLimit, {
    global: true,
    max: 120,
    timeWindow: "1 minute",
  });

  app.addHook("onRequest", async (request, reply) => {
    if (!request.url.startsWith("/api/")) {
      return;
    }
    const providedSecret = request.headers["x-internal-api-secret"];
    if (!isSecretEqual(providedSecret, options.env.INTERNAL_API_SECRET)) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Internal API authentication is required.",
      });
    }
  });

  app.get("/health", async () => {
    return {
      checkedAt: new Date().toISOString(),
      service: "api",
      status: "up",
    };
  });

  app.get("/ready", async (_request, reply) => {
    const health = await options.healthService.check();
    if (health.status !== "healthy") {
      return reply.code(503).send(health);
    }

    return health;
  });

  app.get("/api/admin/health", async (_request, reply) => {
    const health = await options.healthService.check();
    return reply.code(health.status === "healthy" ? 200 : 503).send(health);
  });

  registerAddressRoutes(app, options.addressService);
  registerDiscoveryRoutes(app, options.discoveryService);

  app.setErrorHandler((error, request, reply) => {
    if (isClientError(error)) {
      return void reply.code(error.statusCode).send({
        error: "bad_request",
        message: error.message,
      });
    }
    request.log.error(
      {
        error: errorDetails(error),
      },
      "Unhandled API error",
    );

    void reply.code(500).send({
      error: "internal_server_error",
      message: "The API could not complete the request.",
    });
  });

  return app;
}

function isClientError(error: unknown): error is Error & { readonly statusCode: number } {
  return (
    error instanceof Error &&
    "statusCode" in error &&
    typeof error.statusCode === "number" &&
    error.statusCode >= 400 &&
    error.statusCode < 500
  );
}

function isSecretEqual(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== "string") {
    return false;
  }

  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
