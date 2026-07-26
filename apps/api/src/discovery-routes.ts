import { hyperliquidAddressSchema } from "@chaincopy/blockchain-adapters";
import {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply,
  type RawReplyDefaultExpression,
  type RawRequestDefaultExpression,
  type RawServerDefault,
} from "fastify";
import { z } from "zod";

import {
  CandidateActionConflictError,
  CandidateNotFoundError,
  type DiscoveryService,
} from "./discovery-service.js";

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  enrichmentStatus: z
    .enum(["PENDING", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "RATE_LIMITED"])
    .optional(),
  filterStatus: z
    .enum(["PENDING", "LIGHT_ELIGIBLE", "INSUFFICIENT_HISTORY", "ELIGIBLE", "EXCLUDED", "PROMOTED"])
    .optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().max(80).optional(),
});

const addressParamsSchema = z.object({
  address: hyperliquidAddressSchema,
});

const settingsSchema = z
  .object({
    minimumObservedNotionalUsd: z
      .string()
      .trim()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
      .optional(),
    minimumObservedTradeCount: z.number().int().min(1).max(1_000_000).optional(),
    mode: z.enum(["MAJOR", "ALL"]).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting must be supplied.",
  });

type ApiInstance<LoggerType extends FastifyBaseLogger> = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  LoggerType
>;

export function registerDiscoveryRoutes<LoggerType extends FastifyBaseLogger>(
  app: ApiInstance<LoggerType>,
  service: DiscoveryService,
): void {
  app.get("/api/discovery/candidates", async (request, reply) => {
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send(validationResponse(query.error));
    }
    return service.listCandidates({
      limit: query.data.limit,
      ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      ...(query.data.enrichmentStatus ? { enrichmentStatus: query.data.enrichmentStatus } : {}),
      ...(query.data.filterStatus ? { filterStatus: query.data.filterStatus } : {}),
      ...(query.data.search ? { search: query.data.search } : {}),
    });
  });

  app.get("/api/discovery/candidates/:address", async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return await service.getCandidate(params.data.address);
    } catch (error) {
      return sendDiscoveryError(error, reply);
    }
  });

  app.get("/api/discovery/settings", async () => service.getSettings());
  app.patch("/api/discovery/settings", async (request, reply) => {
    const input = settingsSchema.safeParse(request.body);
    if (!input.success) {
      return reply.code(400).send(validationResponse(input.error));
    }
    return service.updateSettings({
      ...(input.data.minimumObservedNotionalUsd
        ? { minimumObservedNotionalUsd: input.data.minimumObservedNotionalUsd }
        : {}),
      ...(input.data.minimumObservedTradeCount !== undefined
        ? { minimumObservedTradeCount: input.data.minimumObservedTradeCount }
        : {}),
      ...(input.data.mode ? { mode: input.data.mode } : {}),
    });
  });
  app.post("/api/discovery/start", async () => service.setEnabled(true));
  app.post("/api/discovery/stop", async () => service.setEnabled(false));
  app.get("/api/discovery/stats", async () => service.getStats());

  registerCandidateAction(app, "/api/discovery/candidates/:address/enrich", (address) =>
    service.enqueueEnrichment(address),
  );
  registerCandidateAction(app, "/api/discovery/candidates/:address/exclude", (address) =>
    service.excludeCandidate(address),
  );
  registerCandidateAction(app, "/api/discovery/candidates/:address/promote", (address) =>
    service.enqueuePromotion(address),
  );
}

function registerCandidateAction<LoggerType extends FastifyBaseLogger>(
  app: ApiInstance<LoggerType>,
  url: string,
  action: (address: string) => Promise<Readonly<Record<string, unknown>>>,
): void {
  app.post(url, async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return reply.code(202).send(await action(params.data.address));
    } catch (error) {
      return sendDiscoveryError(error, reply);
    }
  });
}

function sendDiscoveryError(error: unknown, reply: FastifyReply) {
  if (error instanceof CandidateNotFoundError) {
    return reply.code(404).send({ error: "not_found", message: error.message });
  }
  if (error instanceof CandidateActionConflictError) {
    return reply.code(409).send({ error: "conflict", message: error.message });
  }
  throw error;
}

function validationResponse(error: z.ZodError) {
  return {
    error: "validation_error",
    issues: error.issues.map((issue) => ({
      message: issue.message,
      path: issue.path.join("."),
    })),
    message: "Request validation failed.",
  };
}
