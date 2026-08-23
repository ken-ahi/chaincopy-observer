import { parse as parseLossless } from "lossless-json";
import { describe, expect, it } from "vitest";

import { hyperliquidAddressSchema, normalizeHyperliquidAddress } from "./address.js";
import { createEventFingerprint } from "./event-fingerprint.js";
import { mapFill, mapFundingPayment, mapLedgerUpdate, mapWebSocketFunding } from "./mapper.js";
import {
  exactDecimalSchema,
  fillSchema,
  fundingPaymentSchema,
  ledgerUpdateSchema,
  websocketFundingSchema,
} from "./schemas.js";

const address = "0x1111111111111111111111111111111111111111";

describe("Hyperliquid address handling", () => {
  it("normalizes valid EVM addresses without changing their bytes", () => {
    expect(normalizeHyperliquidAddress("  0xABCDEFabcdefABCDEFabcdefABCDEFabcdefABCD  ")).toBe(
      "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    );
  });

  it("rejects malformed addresses", () => {
    expect(hyperliquidAddressSchema.safeParse("0x1234").success).toBe(false);
    expect(
      hyperliquidAddressSchema.safeParse("0xgggggggggggggggggggggggggggggggggggggggg").success,
    ).toBe(false);
  });
});

describe("Hyperliquid exact values and fingerprints", () => {
  it("preserves a lossless decimal without converting through number", () => {
    const value = parseLossless("12345678901234567890.123456789012345678");
    expect(exactDecimalSchema.parse(value)).toBe("12345678901234567890.123456789012345678");
  });

  it("canonicalizes object keys and address casing in fingerprints", () => {
    expect(createEventFingerprint("fill", address.toUpperCase(), { a: 1, b: 2 })).toBe(
      createEventFingerprint("fill", address, { b: 2, a: 1 }),
    );
  });
});

describe("Hyperliquid response mapping", () => {
  it("maps a fill deterministically while retaining decimal strings", () => {
    const fill = fillSchema.parse({
      closedPnl: "0.000000000000000001",
      coin: "BTC",
      crossed: true,
      dir: "Open Long",
      fee: "0.123456789012345678",
      feeToken: "USDC",
      hash: "0xfill",
      oid: "9007199254740993",
      px: "123456.123456789012345678",
      side: "B",
      startPosition: "0",
      sz: "0.000000000000000001",
      tid: "9007199254740994",
      time: 1_721_862_400_000,
    });

    const first = mapFill(address, fill);
    const second = mapFill(address, fill);

    expect(first).toMatchObject({
      fee: "0.123456789012345678",
      price: "123456.123456789012345678",
      side: "BUY",
      size: "0.000000000000000001",
      sourceTradeId: "9007199254740994",
    });
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("extracts ledger decimals only from validated string values", () => {
    const update = ledgerUpdateSchema.parse({
      delta: {
        amount: "10.000000000000000001",
        destination: address,
        type: "withdraw",
      },
      hash: "0xledger",
      time: 1_721_862_400_000,
    });

    expect(mapLedgerUpdate(address, update)).toMatchObject({
      amount: "10.000000000000000001",
      counterparty: address,
      flowType: "withdraw",
    });
  });

  it("uses the same funding identity for HTTP and WebSocket payloads", () => {
    const http = fundingPaymentSchema.parse({
      delta: {
        coin: "BTC",
        fundingRate: "0.0001",
        szi: "2",
        type: "funding",
        usdc: "-0.25",
      },
      hash: "0xhttp-only-hash",
      time: 1_721_862_400_000,
    });
    const websocket = websocketFundingSchema.parse({
      coin: "BTC",
      fundingRate: "0.0001",
      szi: "2.0",
      time: 1_721_862_400_000,
      usdc: "-0.2500",
    });

    const httpMapped = mapFundingPayment(address, http);
    const websocketMapped = mapWebSocketFunding(address, websocket);
    expect(websocketMapped.externalPaymentId).toBe(httpMapped.externalPaymentId);
    expect(websocketMapped.fingerprint).toBe(httpMapped.fingerprint);
  });
});
