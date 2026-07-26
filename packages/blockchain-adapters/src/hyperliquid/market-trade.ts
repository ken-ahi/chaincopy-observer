import { createHash } from "node:crypto";

import { Decimal } from "decimal.js";

import { normalizeHyperliquidAddress } from "./address.js";
import { stringifyHyperliquidPayload } from "./event-fingerprint.js";
import { type HyperliquidWebSocketTrade } from "./schemas.js";

const FinancialDecimal = Decimal.clone({ precision: 80 });

export interface HyperliquidMarketTrade {
  readonly buyerAddress: string;
  readonly coin: string;
  readonly externalTradeId: string;
  readonly fingerprint: string;
  readonly notionalUsd: string;
  readonly occurredAt: string;
  readonly price: string;
  readonly rawPayload: string;
  readonly sellerAddress: string;
  readonly side: "BUY" | "SELL";
  readonly size: string;
  readonly tradeId: string;
  readonly transactionHash: string;
}

export function mapMarketTrade(trade: HyperliquidWebSocketTrade): HyperliquidMarketTrade {
  const buyerAddress = normalizeHyperliquidAddress(trade.users[0]);
  const sellerAddress = normalizeHyperliquidAddress(trade.users[1]);
  const price = new FinancialDecimal(trade.px);
  const size = new FinancialDecimal(trade.sz);
  const externalTradeId = `${trade.time}:${trade.coin}:${trade.tid}`;
  const canonical = [
    externalTradeId,
    trade.hash.toLowerCase(),
    buyerAddress,
    sellerAddress,
    price.toFixed(),
    size.toFixed(),
    trade.side,
  ].join("|");

  return {
    buyerAddress,
    coin: trade.coin,
    externalTradeId,
    fingerprint: createHash("sha256").update(canonical).digest("hex"),
    notionalUsd: price.mul(size).abs().toFixed(),
    occurredAt: new Date(trade.time).toISOString(),
    price: price.toFixed(),
    rawPayload: stringifyHyperliquidPayload(trade),
    sellerAddress,
    side: trade.side === "B" ? "BUY" : "SELL",
    size: size.toFixed(),
    tradeId: trade.tid,
    transactionHash: trade.hash,
  };
}
