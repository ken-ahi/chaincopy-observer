import { createHash } from "node:crypto";

import { XYZ_CL_QUOTE_CONTRACT } from "@chaincopy/blockchain-adapters";
import { describe, expect, it, vi } from "vitest";

import {
  HyperliquidBehaviorMarketResolver,
  OFFICIAL_HYPERLIQUID_INFO,
} from "./market-provenance.js";

// Minimal synthetic envelopes carrying the reviewed official fields captured 2026-09-27.
// Unrelated universe entries are placeholders; their array positions must be retained.
function fixture() {
  return {
    perpDexs: [null, { name: "xyz", deployer: String(XYZ_CL_QUOTE_CONTRACT.deployer) }],
    meta: {
      collateralToken: 0,
      universe: [
        ...Array.from({ length: 29 }, (_, index) => ({
          name: `fixture:${index}`,
          szDecimals: 3,
          maxLeverage: 20,
        })),
        { name: "xyz:CL", szDecimals: 3, maxLeverage: 20 },
      ],
    },
    spotMeta: {
      tokens: [
        {
          index: 0,
          name: "USDC",
          tokenId: XYZ_CL_QUOTE_CONTRACT.collateralTokenId as string,
          isCanonical: true,
        },
      ],
    },
    perpAnnotation: {
      ...XYZ_CL_QUOTE_CONTRACT.annotation,
      description: String(XYZ_CL_QUOTE_CONTRACT.annotation.description),
    },
  };
}

function setup(values = fixture(), endpoint = OFFICIAL_HYPERLIQUID_INFO) {
  const fetchImplementation = vi.fn<typeof fetch>().mockImplementation(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { type: keyof typeof values };
    return new Response(JSON.stringify(values[request.type]));
  });
  return {
    fetchImplementation,
    resolver: new HyperliquidBehaviorMarketResolver(endpoint, {
      fetchImplementation,
      maximumAttempts: 1,
    }),
  };
}

describe("official custom-market quote provenance", () => {
  it("joins exact DEX, perp, collateral token and USD/barrel annotation with raw response hashes", async () => {
    const { resolver, fetchImplementation } = setup();
    const result = await resolver.resolve("xyz:CL");
    expect(result).toMatchObject({
      quoteAsset: "USD",
      usdEquivalent: true,
      evidence: { contract: XYZ_CL_QUOTE_CONTRACT },
    });
    expect(
      fetchImplementation.mock.calls.map((call) => [call[0], JSON.parse(String(call[1]?.body))]),
    ).toEqual([
      [OFFICIAL_HYPERLIQUID_INFO, { type: "perpDexs" }],
      [OFFICIAL_HYPERLIQUID_INFO, { type: "meta", dex: "xyz" }],
      [OFFICIAL_HYPERLIQUID_INFO, { type: "spotMeta" }],
      [OFFICIAL_HYPERLIQUID_INFO, { type: "perpAnnotation", coin: "xyz:CL" }],
    ]);
    for (const response of result.evidence!.responses) {
      expect(response.sha256).toBe(createHash("sha256").update(response.rawText).digest("hex"));
      expect(Number.isFinite(Date.parse(response.observedAt))).toBe(true);
    }
    expect((await resolver.resolve("xyz:CL")).evidence!.fingerprint).toBe(
      result.evidence!.fingerprint,
    );
  });

  it.each<[string, (value: ReturnType<typeof fixture>) => void]>([
    [
      "missing market",
      (value) => {
        value.meta.universe.pop();
      },
    ],
    [
      "wrong index",
      (value) => {
        value.meta.universe.reverse();
      },
    ],
    [
      "duplicate market",
      (value) => {
        value.meta.universe.push(value.meta.universe[29]!);
      },
    ],
    [
      "wrong deployer",
      (value) => {
        value.perpDexs[1]!.deployer = "0xwrong";
      },
    ],
    [
      "duplicate DEX",
      (value) => {
        value.perpDexs.push(value.perpDexs[1]!);
      },
    ],
    [
      "unsupported collateral",
      (value) => {
        value.meta.collateralToken = 1;
      },
    ],
    [
      "missing token",
      (value) => {
        value.spotMeta.tokens = [];
      },
    ],
    [
      "fake USDC name",
      (value) => {
        value.spotMeta.tokens[0]!.tokenId = "0xfake";
      },
    ],
    [
      "noncanonical token",
      (value) => {
        value.spotMeta.tokens[0]!.isCanonical = false;
      },
    ],
    [
      "ambiguous token",
      (value) => {
        value.spotMeta.tokens.push({ ...value.spotMeta.tokens[0]! });
      },
    ],
    [
      "changed units",
      (value) => {
        value.perpAnnotation.description = "USD price of 1000 barrels";
      },
    ],
    [
      "missing annotation",
      (value) => {
        value.perpAnnotation.description = "";
      },
    ],
  ])("fails closed for %s", async (_label, mutate) => {
    const values = fixture();
    mutate(values);
    expect(await setup(values).resolver.resolve("xyz:CL")).toMatchObject({ usdEquivalent: false });
  });

  it.each(["other:CL", "xyz:USDC", "xyz:BTC", "xyz:CL-USD"])(
    "never guesses quote from %s",
    async (coin) => {
      const { resolver, fetchImplementation } = setup();
      expect(await resolver.resolve(coin)).toEqual({ quoteAsset: "UNKNOWN", usdEquivalent: false });
      expect(fetchImplementation).not.toHaveBeenCalled();
    },
  );

  it("does not trust a configured mirror/testnet source or substitute metadata on errors", async () => {
    const mirror = setup(fixture(), "https://example.test/info");
    expect((await mirror.resolver.resolve("xyz:CL")).usdEquivalent).toBe(false);
    expect(mirror.fetchImplementation).not.toHaveBeenCalled();
    const { resolver, fetchImplementation } = setup();
    fetchImplementation.mockRejectedValue(new Error("metadata unavailable"));
    expect(await resolver.resolve("xyz:CL")).toMatchObject({
      usdEquivalent: false,
      detail: expect.stringContaining("metadata unavailable"),
    });
    expect(await resolver.resolve("BTC")).toEqual({ quoteAsset: "USDC", usdEquivalent: true });
  });
});
