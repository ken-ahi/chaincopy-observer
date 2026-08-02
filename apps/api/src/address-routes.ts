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
  AddressConflictError,
  AddressNotFoundError,
  type AddressService,
} from "./address-service.js";

const addressParamsSchema = z.object({
  address: hyperliquidAddressSchema,
});

const createAddressSchema = z.object({
  address: hyperliquidAddressSchema,
  displayName: z.string().trim().max(80).nullable().optional(),
  isWatched: z.boolean().default(true),
});

const updateAddressSchema = z
  .object({
    displayName: z.string().trim().max(80).nullable().optional(),
    isWatched: z.boolean().optional(),
  })
  .refine((value) => value.displayName !== undefined || value.isWatched !== undefined, {
    message: "At least one field must be supplied.",
  });

const listQuerySchema = z.object({
  cursor: z.string().min(1).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const addressListQuerySchema = listQuerySchema.extend({
  isWatched: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  search: z.string().trim().max(80).optional(),
  syncStatus: z.enum(["IDLE", "RUNNING", "SUCCEEDED", "FAILED", "GAP_DETECTED"]).optional(),
});

const dataQualityListQuerySchema = listQuerySchema.extend({
  status: z.enum(["OPEN", "RESOLVED"]).optional(),
});

const orderListQuerySchema = listQuerySchema.extend({
  status: z.literal("open").optional(),
});

type ApiInstance<LoggerType extends FastifyBaseLogger> = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  LoggerType
>;

export function registerAddressRoutes<LoggerType extends FastifyBaseLogger>(
  app: ApiInstance<LoggerType>,
  addressService: AddressService,
): void {
  app.get("/api/addresses", async (request, reply) => {
    const query = addressListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.code(400).send(validationResponse(query.error));
    }
    return addressService.listAddresses({
      limit: query.data.limit,
      ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      ...(query.data.search ? { search: query.data.search } : {}),
      ...(query.data.syncStatus ? { syncStatus: query.data.syncStatus } : {}),
      ...(query.data.isWatched !== undefined ? { isWatched: query.data.isWatched } : {}),
    });
  });

  app.post("/api/addresses", async (request, reply) => {
    const input = createAddressSchema.safeParse(request.body);
    if (!input.success) {
      return reply.code(400).send(validationResponse(input.error));
    }
    try {
      const address = await addressService.createAddress({
        address: input.data.address,
        isWatched: input.data.isWatched,
        ...(input.data.displayName !== undefined ? { displayName: input.data.displayName } : {}),
      });
      return reply.code(201).send(address);
    } catch (error) {
      return sendAddressError(error, reply);
    }
  });

  app.get("/api/addresses/:address", async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return await addressService.getAddress(params.data.address);
    } catch (error) {
      return sendAddressError(error, reply);
    }
  });

  app.patch("/api/addresses/:address", async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    const input = updateAddressSchema.safeParse(request.body);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    if (!input.success) {
      return reply.code(400).send(validationResponse(input.error));
    }
    try {
      return await addressService.updateAddress(params.data.address, {
        ...(input.data.displayName !== undefined ? { displayName: input.data.displayName } : {}),
        ...(input.data.isWatched !== undefined ? { isWatched: input.data.isWatched } : {}),
      });
    } catch (error) {
      return sendAddressError(error, reply);
    }
  });

  app.post("/api/addresses/:address/sync", async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return reply.code(202).send(await addressService.enqueueSync(params.data.address));
    } catch (error) {
      return sendAddressError(error, reply);
    }
  });

  app.post("/api/addresses/:address/watch", async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return await addressService.setWatch(params.data.address, true);
    } catch (error) {
      return sendAddressError(error, reply);
    }
  });

  app.delete("/api/addresses/:address/watch", async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return await addressService.setWatch(params.data.address, false);
    } catch (error) {
      return sendAddressError(error, reply);
    }
  });

  registerListRoute(app, "/api/addresses/:address/fills", (address, query) =>
    addressService.listFills(address, query),
  );
  registerListRoute(app, "/api/addresses/:address/funding", (address, query) =>
    addressService.listFunding(address, query),
  );
  registerListRoute(app, "/api/addresses/:address/ledger", (address, query) =>
    addressService.listLedger(address, query),
  );
  app.get("/api/addresses/:address/orders", async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    const query = orderListQuerySchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    if (!query.success) {
      return reply.code(400).send(validationResponse(query.error));
    }
    try {
      return await addressService.listOrders(params.data.address, {
        limit: query.data.limit,
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
        ...(query.data.status ? { status: query.data.status } : {}),
      });
    } catch (error) {
      return sendAddressError(error, reply);
    }
  });

  app.get("/api/addresses/:address/positions", async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return await addressService.listPositions(params.data.address);
    } catch (error) {
      return sendAddressError(error, reply);
    }
  });

  app.get("/api/addresses/:address/sync-status", async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    try {
      return await addressService.getSyncStatus(params.data.address);
    } catch (error) {
      return sendAddressError(error, reply);
    }
  });

  app.get("/api/addresses/:address/data-quality", async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    const query = dataQualityListQuerySchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    if (!query.success) {
      return reply.code(400).send(validationResponse(query.error));
    }
    try {
      return await addressService.listDataQuality(params.data.address, {
        limit: query.data.limit,
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
        ...(query.data.status ? { status: query.data.status } : {}),
      });
    } catch (error) {
      return sendAddressError(error, reply);
    }
  });

  app.get("/api/admin/hyperliquid/health", async () => addressService.getHyperliquidHealth());
}

function registerListRoute<LoggerType extends FastifyBaseLogger>(
  app: ApiInstance<LoggerType>,
  url: string,
  handler: (
    address: string,
    query: { readonly cursor?: string; readonly limit: number },
  ) => Promise<{ readonly items: ReadonlyArray<unknown>; readonly nextCursor: string | null }>,
): void {
  app.get(url, async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    const query = listQuerySchema.safeParse(request.query);
    if (!params.success) {
      return reply.code(400).send(validationResponse(params.error));
    }
    if (!query.success) {
      return reply.code(400).send(validationResponse(query.error));
    }
    try {
      return await handler(params.data.address, {
        limit: query.data.limit,
        ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
      });
    } catch (error) {
      return sendAddressError(error, reply);
    }
  });
}

function sendAddressError(error: unknown, reply: FastifyReply) {
  if (error instanceof AddressNotFoundError) {
    return reply.code(404).send({ error: "not_found", message: error.message });
  }
  if (error instanceof AddressConflictError) {
    return reply.code(409).send({ error: "duplicate_address", message: error.message });
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
