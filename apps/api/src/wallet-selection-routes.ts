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
  type WalletSelectionService,
  WalletSelectionWalletNotFoundError,
} from "./wallet-selection-service.js";

const plainDecimal = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const nonNegativeDecimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

const settingsSchema = z
  .object({
    maxAutoSelected: z.number().int().min(0).max(10_000).optional(),
    maximumDataAgeHours: z.number().int().min(1).max(8_760).optional(),
    maximumDrawdown: z.string().trim().regex(nonNegativeDecimal).optional(),
    maximumTopTradeContribution: z.string().trim().regex(nonNegativeDecimal).optional(),
    minimumAnnualizedReturn: z.string().trim().regex(plainDecimal).optional(),
    minimumEvaluationDays: z.number().int().min(0).max(36_500).optional(),
    minimumTrustedClosedCycles: z.number().int().min(0).max(1_000_000).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one setting must be supplied.",
  });

const addressParamsSchema = z.object({ address: hyperliquidAddressSchema });

const overrideSchema = z.object({
  decision: z.enum(["AUTO", "INCLUDE", "EXCLUDE"]),
  note: z.string().trim().max(500).nullable().optional(),
});

type ApiInstance<LoggerType extends FastifyBaseLogger> = FastifyInstance<
  RawServerDefault,
  RawRequestDefaultExpression,
  RawReplyDefaultExpression,
  LoggerType
>;

export function registerWalletSelectionRoutes<LoggerType extends FastifyBaseLogger>(
  app: ApiInstance<LoggerType>,
  service: WalletSelectionService,
): void {
  app.get("/api/wallet-selection", async () => service.getCurrentSelection());
  app.get("/api/wallet-selection/settings", async () => service.getSettings());
  app.get("/api/wallet-selection/effective-selected", async () => ({
    items: await service.listEffectiveSelectedWallets(),
  }));

  app.patch("/api/wallet-selection/settings", async (request, reply) => {
    const input = settingsSchema.safeParse(request.body);
    if (!input.success) return reply.code(400).send(validationResponse(input.error));
    return service.updateSettings({
      ...(input.data.maxAutoSelected !== undefined
        ? { maxAutoSelected: input.data.maxAutoSelected }
        : {}),
      ...(input.data.maximumDataAgeHours !== undefined
        ? { maximumDataAgeHours: input.data.maximumDataAgeHours }
        : {}),
      ...(input.data.maximumDrawdown !== undefined
        ? { maximumDrawdown: input.data.maximumDrawdown }
        : {}),
      ...(input.data.maximumTopTradeContribution !== undefined
        ? { maximumTopTradeContribution: input.data.maximumTopTradeContribution }
        : {}),
      ...(input.data.minimumAnnualizedReturn !== undefined
        ? { minimumAnnualizedReturn: input.data.minimumAnnualizedReturn }
        : {}),
      ...(input.data.minimumEvaluationDays !== undefined
        ? { minimumEvaluationDays: input.data.minimumEvaluationDays }
        : {}),
      ...(input.data.minimumTrustedClosedCycles !== undefined
        ? { minimumTrustedClosedCycles: input.data.minimumTrustedClosedCycles }
        : {}),
    });
  });

  app.post("/api/wallet-selection/evaluate", async () => service.evaluate());

  app.patch("/api/wallet-selection/:address/override", async (request, reply) => {
    const params = addressParamsSchema.safeParse(request.params);
    const input = overrideSchema.safeParse(request.body);
    if (!params.success) return reply.code(400).send(validationResponse(params.error));
    if (!input.success) return reply.code(400).send(validationResponse(input.error));
    try {
      return await service.setOverride(params.data.address, input.data.decision, input.data.note);
    } catch (error) {
      return sendSelectionError(error, reply);
    }
  });
}

function sendSelectionError(error: unknown, reply: FastifyReply) {
  if (error instanceof WalletSelectionWalletNotFoundError) {
    return reply.code(404).send({
      error: "not_found",
      message: "The monitored wallet was not found.",
    });
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
