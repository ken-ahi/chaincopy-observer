import { describe, expect, it } from "vitest";

import { mapMarketTrade } from "./market-trade.js";
import { websocketTradeSchema } from "./schemas.js";

describe("Hyperliquid market trade mapping", () => {
  it("extracts and normalizes buyer and seller without financial number conversion", () => {
    const trade = websocketTradeSchema.parse({
      coin: "BTC",
      hash: "0xabc",
      px: "123456.123456789012345678",
      side: "B",
      sz: "0.000000000000000001",
      tid: "9007199254740993",
      time: 1_721_862_400_000,
      users: [
        "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      ],
    });

    expect(mapMarketTrade(trade)).toMatchObject({
      buyerAddress: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      coin: "BTC",
      externalTradeId: "1721862400000:BTC:9007199254740993",
      notionalUsd: "0.000000000000123456123456789012345678",
      sellerAddress: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      side: "BUY",
    });
  });

  it("retains one normalized address when buyer and seller are identical", () => {
    const address = "0xcccccccccccccccccccccccccccccccccccccccc";
    const mapped = mapMarketTrade(
      websocketTradeSchema.parse({
        coin: "ETH",
        hash: "0xself",
        px: "100",
        side: "A",
        sz: "2",
        tid: "7",
        time: 1_721_862_400_000,
        users: [address, address],
      }),
    );

    expect(mapped.buyerAddress).toBe(mapped.sellerAddress);
    expect(mapped.side).toBe("SELL");
  });
});
