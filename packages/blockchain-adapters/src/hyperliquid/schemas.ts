import { isLosslessNumber } from "lossless-json";
import { z } from "zod";

import { hyperliquidAddressSchema } from "./address.js";

const decimalPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const integerPattern = /^\d+$/;

export const exactDecimalSchema = z
  .union([
    z.string().trim().regex(decimalPattern),
    z.custom<{ toString(): string }>((value) => isLosslessNumber(value)),
  ])
  .transform((value) => value.toString().trim());

export const exactIntegerStringSchema = z
  .union([
    z.string().trim().regex(integerPattern),
    z.number().int().safe(),
    z.custom<{ toString(): string }>((value) => isLosslessNumber(value)),
  ])
  .transform((value) => value.toString());

export const timestampSchema = exactIntegerStringSchema.transform((value, context) => {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    context.addIssue({
      code: "custom",
      message: "Timestamp is outside the JavaScript safe integer range.",
    });
    return z.NEVER;
  }
  return timestamp;
});

const nullableDecimalSchema = exactDecimalSchema.nullable();

export const fillSchema = z
  .object({
    closedPnl: exactDecimalSchema,
    coin: z.string().min(1),
    crossed: z.boolean(),
    dir: z.string().min(1),
    fee: exactDecimalSchema,
    feeToken: z.string().min(1),
    hash: z.string().min(1),
    oid: exactIntegerStringSchema,
    px: exactDecimalSchema,
    side: z.enum(["A", "B"]),
    startPosition: exactDecimalSchema,
    sz: exactDecimalSchema,
    tid: exactIntegerStringSchema,
    time: timestampSchema,
    builderFee: exactDecimalSchema.optional(),
    liquidation: z
      .object({
        liquidatedUser: z.string().optional(),
        markPx: exactDecimalSchema,
        method: z.enum(["market", "backstop"]),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();

export const userFillsSchema = z.array(fillSchema);

export const marginSummarySchema = z
  .object({
    accountValue: exactDecimalSchema,
    totalMarginUsed: exactDecimalSchema,
    totalNtlPos: exactDecimalSchema,
    totalRawUsd: exactDecimalSchema,
  })
  .passthrough();

export const positionSchema = z
  .object({
    coin: z.string().min(1),
    entryPx: nullableDecimalSchema,
    leverage: z
      .object({
        type: z.string().min(1),
        value: exactDecimalSchema,
        rawUsd: exactDecimalSchema.optional(),
      })
      .passthrough(),
    liquidationPx: nullableDecimalSchema,
    marginUsed: exactDecimalSchema,
    maxLeverage: exactDecimalSchema,
    positionValue: exactDecimalSchema,
    returnOnEquity: exactDecimalSchema,
    szi: exactDecimalSchema,
    unrealizedPnl: exactDecimalSchema,
  })
  .passthrough();

export const clearinghouseStateSchema = z
  .object({
    assetPositions: z.array(
      z
        .object({
          position: positionSchema,
          type: z.string().min(1),
        })
        .passthrough(),
    ),
    crossMaintenanceMarginUsed: exactDecimalSchema,
    crossMarginSummary: marginSummarySchema,
    marginSummary: marginSummarySchema,
    time: timestampSchema.optional(),
    withdrawable: exactDecimalSchema,
  })
  .passthrough();

export const spotBalanceSchema = z
  .object({
    coin: z.string().min(1),
    entryNtl: exactDecimalSchema,
    hold: exactDecimalSchema,
    token: z.number().int().safe().or(exactIntegerStringSchema.transform(Number)),
    total: exactDecimalSchema,
  })
  .passthrough();

export const spotClearinghouseStateSchema = z
  .object({
    balances: z.array(spotBalanceSchema),
  })
  .passthrough();

const portfolioPointSchema = z.tuple([timestampSchema, exactDecimalSchema]);
export const portfolioSchema = z.array(
  z.tuple([
    z.string().min(1),
    z
      .object({
        accountValueHistory: z.array(portfolioPointSchema),
        pnlHistory: z.array(portfolioPointSchema),
        vlm: exactDecimalSchema,
      })
      .passthrough(),
  ]),
);

export const fundingPaymentSchema = z
  .object({
    delta: z
      .object({
        coin: z.string().min(1),
        fundingRate: exactDecimalSchema,
        szi: exactDecimalSchema,
        type: z.literal("funding"),
        usdc: exactDecimalSchema,
      })
      .passthrough(),
    hash: z.string().min(1),
    time: timestampSchema,
  })
  .passthrough();

export const userFundingSchema = z.array(fundingPaymentSchema);

export const websocketFundingSchema = z
  .object({
    coin: z.string().min(1),
    fundingRate: exactDecimalSchema,
    szi: exactDecimalSchema,
    time: timestampSchema,
    usdc: exactDecimalSchema,
  })
  .passthrough();

export const ledgerUpdateSchema = z
  .object({
    delta: z
      .object({
        type: z.string().min(1),
      })
      .passthrough(),
    hash: z.string().min(1),
    time: timestampSchema,
  })
  .passthrough();

export const userNonFundingLedgerUpdatesSchema = z.array(ledgerUpdateSchema);

export const basicOrderSchema = z
  .object({
    cloid: z.string().nullable().optional(),
    coin: z.string().min(1),
    limitPx: exactDecimalSchema,
    oid: exactIntegerStringSchema,
    orderType: z.string().default("Limit"),
    origSz: exactDecimalSchema.optional(),
    reduceOnly: z.boolean().default(false),
    side: z.enum(["A", "B"]),
    sz: exactDecimalSchema,
    timestamp: timestampSchema,
  })
  .passthrough();

export const openOrdersSchema = z.array(basicOrderSchema);
export const frontendOpenOrdersSchema = z.array(basicOrderSchema);

export const historicalOrderSchema = z
  .object({
    order: basicOrderSchema,
    status: z.string().min(1),
    statusTimestamp: timestampSchema,
  })
  .passthrough();

export const historicalOrdersSchema = z.array(historicalOrderSchema);

export const userRateLimitSchema = z
  .object({
    cumVlm: exactDecimalSchema,
    nRequestsCap: exactIntegerStringSchema,
    nRequestsSurplus: exactIntegerStringSchema,
    nRequestsUsed: exactIntegerStringSchema,
  })
  .passthrough();

export const perpetualMetaSchema = z
  .object({
    universe: z.array(
      z
        .object({
          isDelisted: z.boolean().optional(),
          maxLeverage: z.number().int().safe().or(exactIntegerStringSchema.transform(Number)),
          name: z.string().min(1),
          onlyIsolated: z.boolean().optional(),
          szDecimals: z.number().int().safe().or(exactIntegerStringSchema.transform(Number)),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export const websocketTradeSchema = z
  .object({
    coin: z.string().min(1),
    hash: z.string().min(1),
    px: exactDecimalSchema,
    side: z.enum(["A", "B"]),
    sz: exactDecimalSchema,
    tid: exactIntegerStringSchema,
    time: timestampSchema,
    users: z.tuple([hyperliquidAddressSchema, hyperliquidAddressSchema]),
  })
  .passthrough();

export const websocketTradesSchema = z.array(websocketTradeSchema);

const websocketControlEnvelopeSchema = z
  .object({
    channel: z.enum(["pong", "subscriptionResponse"]),
    data: z.unknown().optional(),
  })
  .passthrough();

const websocketDataEnvelopeSchema = z
  .object({
    channel: z
      .string()
      .min(1)
      .refine(
        (channel) => channel !== "pong" && channel !== "subscriptionResponse",
        "Control channels must use the control envelope.",
      ),
    data: z.unknown(),
  })
  .passthrough();

export const websocketEnvelopeSchema = z.union([
  websocketControlEnvelopeSchema,
  websocketDataEnvelopeSchema,
]);

export const websocketUserFillsSchema = z
  .object({
    fills: z.array(fillSchema),
    isSnapshot: z.boolean().optional(),
    user: z.string().min(1),
  })
  .passthrough();

export const websocketUserFundingsSchema = z
  .object({
    fundings: z.array(websocketFundingSchema),
    isSnapshot: z.boolean().optional(),
    user: z.string().min(1),
  })
  .passthrough();

export const websocketLedgerUpdatesSchema = z
  .object({
    isSnapshot: z.boolean().optional(),
    nonFundingLedgerUpdates: z.array(ledgerUpdateSchema),
    user: z.string().min(1),
  })
  .passthrough();

export const websocketOrderUpdatesSchema = z.array(
  z
    .object({
      order: basicOrderSchema,
      status: z.string().min(1),
      statusTimestamp: timestampSchema,
    })
    .passthrough(),
);

export const websocketUserEventSchema = z.union([
  z.object({ fills: z.array(fillSchema) }).passthrough(),
  z.object({ funding: websocketFundingSchema }).passthrough(),
  z.object({ liquidation: z.unknown() }).passthrough(),
  z.object({ nonUserCancel: z.array(z.unknown()) }).passthrough(),
]);

export const websocketClearinghouseStateSchema = z.union([
  clearinghouseStateSchema,
  z
    .object({
      clearinghouseState: clearinghouseStateSchema,
      user: z.string().optional(),
    })
    .passthrough()
    .transform((value) => value.clearinghouseState),
]);

export const websocketOpenOrdersSchema = z.union([
  openOrdersSchema,
  z
    .object({
      orders: z.array(basicOrderSchema),
      user: z.string().optional(),
    })
    .passthrough()
    .transform((value) => value.orders),
]);

export type HyperliquidFill = z.infer<typeof fillSchema>;
export type HyperliquidFundingPayment = z.infer<typeof fundingPaymentSchema>;
export type HyperliquidWebSocketFunding = z.infer<typeof websocketFundingSchema>;
export type HyperliquidLedgerUpdate = z.infer<typeof ledgerUpdateSchema>;
export type HyperliquidClearinghouseState = z.infer<typeof clearinghouseStateSchema>;
export type HyperliquidSpotState = z.infer<typeof spotClearinghouseStateSchema>;
export type HyperliquidOrder = z.infer<typeof basicOrderSchema>;
export type HyperliquidHistoricalOrder = z.infer<typeof historicalOrderSchema>;
export type HyperliquidPortfolio = z.infer<typeof portfolioSchema>;
export type HyperliquidUserRateLimit = z.infer<typeof userRateLimitSchema>;
export type HyperliquidPerpetualMeta = z.infer<typeof perpetualMetaSchema>;
export type HyperliquidWebSocketTrade = z.infer<typeof websocketTradeSchema>;
