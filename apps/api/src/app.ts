import { createHash, timingSafeEqual } from "node:crypto";

import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { errorDetails, type ApiEnv } from "@chaincopy/config";
import Fastify, { LogController } from "fastify";
import { type Logger } from "pino";

import { type HealthService } from "./health.js";

export interface CreateApiOptions {
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

  app.get("/api/admin/health", async (request, reply) => {
    const providedSecret = request.headers["x-internal-api-secret"];
    if (!isSecretEqual(providedSecret, options.env.INTERNAL_API_SECRET)) {
      return reply.code(401).send({
        error: "unauthorized",
        message: "Internal API authentication is required.",
      });
    }

    const health = await options.healthService.check();
    return reply.code(health.status === "healthy" ? 200 : 503).send(health);
  });

  app.setErrorHandler((error, request, reply) => {
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

function isSecretEqual(provided: string | string[] | undefined, expected: string): boolean {
  if (typeof provided !== "string") {
    return false;
  }

  const providedDigest = createHash("sha256").update(provided).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}
