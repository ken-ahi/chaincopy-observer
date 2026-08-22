import { Decimal } from "decimal.js";
import { stringify as stringifyLossless } from "lossless-json";

import { createEventFingerprint } from "./event-fingerprint.js";
import {
  exactDecimalSchema,
  type HyperliquidClearinghouseState,
  type HyperliquidFill,
  type HyperliquidFundingPayment,
  type HyperliquidHistoricalOrder,
  type HyperliquidLedgerUpdate,
  type HyperliquidOrder,
  type HyperliquidSpotState,
  type HyperliquidWebSocketFunding,
} from "./schemas.js";

export interface NormalizedFill {
  readonly externalTradeId: string;
  readonly sourceTradeId: string;
  readonly fingerprint: string;
  readonly coin: string;
  readonly side: "BUY" | "SELL";
  readonly direction: string;
  readonly price: string;
  readonly size: string;
  readonly fee: string;
  readonly feeToken: string;
  readonly closedPnl: string;
  readonly startPosition: string;
  readonly crossed: boolean;
  readonly orderId: string;
  readonly transactionHash: string;
  readonly occurredAt: Date;
}

export interface NormalizedFundingPayment {
  readonly externalPaymentId: string;
  readonly fingerprint: string;
  readonly coin: string;
  readonly amount: string;
  readonly positionSize: string;
  readonly fundingRate: string;
  readonly occurredAt: Date;
}

export interface NormalizedCashFlow {
  readonly externalFlowId: string;
  readonly fingerprint: string;
  readonly flowType: string;
  readonly asset: string | null;
  readonly amount: string | null;
  readonly usdValue: string | null;
  readonly fee: string | null;
  readonly counterparty: string | null;
  readonly occurredAt: Date;
  readonly rawPayload: string;
}

export interface NormalizedPosition {
  readonly fingerprint: string;
  readonly coin: string;
  readonly side: "LONG" | "SHORT";
  readonly size: string;
  readonly entryPrice: string | null;
  readonly positionValue: string;
  readonly unrealizedPnl: string;
  readonly returnOnEquity: string;
  readonly marginUsed: string;
  readonly liquidationPrice: string | null;
  readonly leverageType: string;
  readonly leverageValue: string;
  readonly maxLeverage: string;
  readonly occurredAt: Date;
}

export interface NormalizedSpotBalance {
  readonly fingerprint: string;
  readonly coin: string;
  readonly tokenIndex: number;
  readonly total: string;
  readonly hold: string;
  readonly entryNotional: string;
  readonly capturedAt: Date;
}

export interface NormalizedOrder {
  readonly fingerprint: string;
  readonly orderId: string;
  readonly clientOrderId: string | null;
  readonly coin: string;
  readonly side: "BUY" | "SELL";
  readonly status: string;
  readonly orderType: string;
  readonly limitPrice: string;
  readonly size: string;
  readonly originalSize: string;
  readonly reduceOnly: boolean;
  readonly statusTimestamp: Date;
}

export function mapFill(walletAddress: string, fill: HyperliquidFill): NormalizedFill {
  const externalTradeId = `${fill.time}:${fill.coin}:${fill.tid}`;
  return {
    externalTradeId,
    sourceTradeId: fill.tid,
    fingerprint: createEventFingerprint("fill", walletAddress, {
      externalTradeId,
      hash: fill.hash,
      oid: fill.oid,
    }),
    coin: fill.coin,
    side: fill.side === "B" ? "BUY" : "SELL",
    direction: fill.dir,
    price: fill.px,
    size: fill.sz,
    fee: fill.fee,
    feeToken: fill.feeToken,
    closedPnl: fill.closedPnl,
    startPosition: fill.startPosition,
    crossed: fill.crossed,
    orderId: fill.oid,
    transactionHash: fill.hash,
    occurredAt: new Date(fill.time),
  };
}

export function mapFundingPayment(
  walletAddress: string,
  funding: HyperliquidFundingPayment,
): NormalizedFundingPayment {
  const externalPaymentId = fundingExternalId(
    walletAddress,
    funding.time,
    funding.delta.coin,
    funding.delta.usdc,
    funding.delta.szi,
    funding.delta.fundingRate,
  );
  return {
    externalPaymentId,
    fingerprint: createEventFingerprint("funding", walletAddress, {
      externalPaymentId,
    }),
    coin: funding.delta.coin,
    amount: funding.delta.usdc,
    positionSize: funding.delta.szi,
    fundingRate: funding.delta.fundingRate,
    occurredAt: new Date(funding.time),
  };
}

export function mapWebSocketFunding(
  walletAddress: string,
  funding: HyperliquidWebSocketFunding,
): NormalizedFundingPayment {
  const externalPaymentId = fundingExternalId(
    walletAddress,
    funding.time,
    funding.coin,
    funding.usdc,
    funding.szi,
    funding.fundingRate,
  );
  return {
    externalPaymentId,
    fingerprint: createEventFingerprint("funding", walletAddress, {
      externalPaymentId,
    }),
    coin: funding.coin,
    amount: funding.usdc,
    positionSize: funding.szi,
    fundingRate: funding.fundingRate,
    occurredAt: new Date(funding.time),
  };
}

function fundingExternalId(
  walletAddress: string,
  time: number,
  coin: string,
  amount: string,
  positionSize: string,
  fundingRate: string,
): string {
  return [
    "funding",
    walletAddress.toLowerCase(),
    String(time),
    coin,
    canonicalDecimal(amount),
    canonicalDecimal(positionSize),
    canonicalDecimal(fundingRate),
  ].join(":");
}

function canonicalDecimal(value: string): string {
  const decimal = new Decimal(value);
  return decimal.isZero() ? "0" : decimal.toFixed();
}

export function mapLedgerUpdate(
  walletAddress: string,
  update: HyperliquidLedgerUpdate,
): NormalizedCashFlow {
  const externalFlowId = `${update.hash}:${update.time}:${update.delta.type}`;
  const delta = update.delta as Readonly<Record<string, unknown>>;

  return {
    externalFlowId,
    fingerprint: createEventFingerprint("ledger", walletAddress, {
      delta,
      externalFlowId,
    }),
    flowType: update.delta.type,
    asset: readString(delta, ["token", "coin"]),
    amount: readDecimal(delta, ["amount", "usdc"]),
    usdValue: readDecimal(delta, ["usdcValue", "netWithdrawnUsd", "accountValue"]),
    fee: readDecimal(delta, ["fee", "commission"]),
    counterparty: readString(delta, ["destination", "user", "vault"]),
    occurredAt: new Date(update.time),
    rawPayload: stringifyLossless(update) ?? "{}",
  };
}

export function mapPositions(
  walletAddress: string,
  state: HyperliquidClearinghouseState,
  capturedAt = new Date(),
): ReadonlyArray<NormalizedPosition> {
  return state.assetPositions
    .filter(({ position }) => position.szi !== "0" && position.szi !== "0.0")
    .map(({ position }) => ({
      fingerprint: createEventFingerprint("position", walletAddress, {
        position,
      }),
      coin: position.coin,
      side: position.szi.startsWith("-") ? "SHORT" : "LONG",
      size: position.szi,
      entryPrice: position.entryPx,
      positionValue: position.positionValue,
      unrealizedPnl: position.unrealizedPnl,
      returnOnEquity: position.returnOnEquity,
      marginUsed: position.marginUsed,
      liquidationPrice: position.liquidationPx,
      leverageType: position.leverage.type,
      leverageValue: position.leverage.value,
      maxLeverage: position.maxLeverage,
      occurredAt: capturedAt,
    }));
}

export function mapSpotBalances(
  walletAddress: string,
  state: HyperliquidSpotState,
  capturedAt = new Date(),
): ReadonlyArray<NormalizedSpotBalance> {
  return state.balances.map((balance) => ({
    fingerprint: createEventFingerprint("spot-balance", walletAddress, {
      balance,
      capturedAt: capturedAt.toISOString(),
    }),
    coin: balance.coin,
    tokenIndex: balance.token,
    total: balance.total,
    hold: balance.hold,
    entryNotional: balance.entryNtl,
    capturedAt,
  }));
}

export function mapHistoricalOrder(
  walletAddress: string,
  historical: HyperliquidHistoricalOrder,
): NormalizedOrder {
  return mapOrder(walletAddress, historical.order, historical.status, historical.statusTimestamp);
}

export function mapOpenOrder(walletAddress: string, order: HyperliquidOrder): NormalizedOrder {
  return mapOrder(walletAddress, order, "open", order.timestamp);
}

function mapOrder(
  walletAddress: string,
  order: HyperliquidOrder,
  status: string,
  statusTimestamp: number,
): NormalizedOrder {
  const originalSize = order.origSz ?? order.sz;
  return {
    fingerprint: createEventFingerprint("order", walletAddress, {
      oid: order.oid,
      status,
      statusTimestamp,
    }),
    orderId: order.oid,
    clientOrderId: order.cloid ?? null,
    coin: order.coin,
    side: order.side === "B" ? "BUY" : "SELL",
    status,
    orderType: order.orderType,
    limitPrice: order.limitPx,
    size: order.sz,
    originalSize,
    reduceOnly: order.reduceOnly,
    statusTimestamp: new Date(statusTimestamp),
  };
}

function readDecimal(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    const parsed = exactDecimalSchema.safeParse(value);
    if (parsed.success) {
      return parsed.data;
    }
  }
  return null;
}

function readString(
  record: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return null;
}
