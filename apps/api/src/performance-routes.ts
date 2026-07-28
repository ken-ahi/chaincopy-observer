import type {
  FastifyBaseLogger,
  FastifyInstance,
  FastifyReply,
  RawReplyDefaultExpression,
  RawRequestDefaultExpression,
  RawServerDefault,
} from "fastify";
import type { z } from "zod";

import { AddressNotFoundError } from "./address-service.js";
import {
  PerformanceCursorError,
  PerformanceCalculationConflictError,
  PerformanceRunNotFoundError,
  type PerformanceService,
} from "./performance-service.js";
import {
  performanceAddressParamsSchema,
  performanceCyclesQuerySchema,
  performanceNavQuerySchema,
  performanceRunParamsSchema,
  performanceRunsQuerySchema,
} from "./performance-schemas.js";

type ApiInstance<LoggerType extends FastifyBaseLogger> = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  LoggerType
>;

export function registerPerformanceRoutes<LoggerType extends FastifyBaseLogger>(
  app: ApiInstance<LoggerType>,
  service: PerformanceService,
): void {
  app.post("/api/addresses/:address/performance/calculate", async (request, reply) => {
    const params = performanceAddressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return reply.code(202).send(await service.calculate(params.data.address));
    } catch (error) {
      return sendPerformanceError(error, reply);
    }
  });

  app.post("/api/addresses/:address/performance/recalculate", async (request, reply) => {
    const params = performanceAddressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return reply.code(202).send(await service.recalculate(params.data.address));
    } catch (error) {
      return sendPerformanceError(error, reply);
    }
  });

  app.get("/api/addresses/:address/performance", async (request, reply) => {
    const params = performanceAddressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return await service.getOverview(params.data.address);
    } catch (error) {
      return sendPerformanceError(error, reply);
    }
  });

  app.get("/api/addresses/:address/performance/runs", async (request, reply) => {
    const params = performanceAddressParamsSchema.safeParse(request.params);
    const query = performanceRunsQuerySchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    if (!query.success) {
      return reply.code(400).send(validationResponse(query.error));
    }
    try {
      return await service.listRuns(params.data.address, {
        limit: query.data.limit,
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      });
    } catch (error) {
      return sendPerformanceError(error, reply);
    }
  });

  app.get("/api/addresses/:address/performance/runs/:runId", async (request, reply) => {
    const params = performanceRunParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return await service.getRun(params.data.address, params.data.runId);
    } catch (error) {
      return sendPerformanceError(error, reply);
    }
  });

  app.get("/api/addresses/:address/performance/nav", async (request, reply) => {
    const params = performanceAddressParamsSchema.safeParse(request.params);
    const query = performanceNavQuerySchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    if (!query.success) {
      return reply.code(400).send(validationResponse(query.error));
    }
    try {
      return await service.listNav(params.data.address, {
        limit: query.data.limit,
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
        ...(query.data.runId ? { runId: query.data.runId } : {}),
      });
    } catch (error) {
      return sendPerformanceError(error, reply);
    }
  });

  app.get("/api/addresses/:address/performance/cycles", async (request, reply) => {
    const params = performanceAddressParamsSchema.safeParse(request.params);
    const query = performanceCyclesQuerySchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    if (!query.success) {
      return reply.code(400).send(validationResponse(query.error));
    }
    try {
      return await service.listCycles(params.data.address, {
        limit: query.data.limit,
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
        ...(query.data.runId ? { runId: query.data.runId } : {}),
      });
    } catch (error) {
      return sendPerformanceError(error, reply);
    }
  });
}

function sendPerformanceError(error: unknown, reply: FastifyReply) {
  if (error instanceof AddressNotFoundError || error instanceof PerformanceRunNotFoundError) {
    return reply.code(404).send({ error: "not_found", message: error.message });
  }
  if (error instanceof PerformanceCursorError) {
    return reply.code(400).send({ error: "invalid_cursor", message: error.message });
  }
  if (error instanceof PerformanceCalculationConflictError) {
    return reply.code(409).send({ error: "calculation_in_progress", message: error.message });
  }
  throw error;
}

function validationResponse(error: z.ZodError) {
  return {
    error: "validation_error",
    message: "Request validation failed.",
    issues: error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}
