import { hyperliquidAddressSchema } from "@chaincopy/blockchain-adapters";
import { z } from "zod";

export const performanceAddressParamsSchema = z.object({
  address: hyperliquidAddressSchema,
});

export const performanceRunParamsSchema = performanceAddressParamsSchema.extend({
  runId: z.string().min(1).max(128),
});

const cursorSchema = z.string().min(1).max(128);

export const performanceRunsQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const performanceNavQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
  runId: z.string().min(1).max(128).optional(),
});

export const performanceCyclesQuerySchema = z.object({
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  runId: z.string().min(1).max(128).optional(),
});
