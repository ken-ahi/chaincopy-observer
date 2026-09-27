import { createHash } from "node:crypto";

import {
  HyperliquidHttpClient,
  XYZ_CL_QUOTE_CONTRACT,
  verifyXyzClQuoteMetadata,
  type HyperliquidHttpClientOptions,
  type HyperliquidHttpResponse,
} from "@chaincopy/blockchain-adapters";

export const BEHAVIOR_QUOTE_EVIDENCE_TYPE = "behavior-market-provenance-v1";
export const OFFICIAL_HYPERLIQUID_INFO = "https://api.hyperliquid.xyz/info";

export interface BehaviorQuoteEvidence {
  readonly contract: typeof XYZ_CL_QUOTE_CONTRACT;
  readonly fingerprint: string;
  readonly responses: readonly {
    endpoint: string;
    request: Readonly<Record<string, string>>;
    observedAt: string;
    rawText: string;
    sha256: string;
  }[];
}

export interface BehaviorMarketResolution {
  readonly quoteAsset: string;
  readonly usdEquivalent: boolean;
  readonly evidence?: BehaviorQuoteEvidence;
  readonly detail?: string;
}

export interface BehaviorMarketResolver {
  resolve(coin: string): Promise<BehaviorMarketResolution>;
}

export function unresolvedBehaviorMarket(coin: string): BehaviorMarketResolution {
  return coin.includes(":")
    ? { quoteAsset: "UNKNOWN", usdEquivalent: false }
    : { quoteAsset: "USDC", usdEquivalent: true };
}

export class HyperliquidBehaviorMarketResolver implements BehaviorMarketResolver {
  private readonly client: HyperliquidHttpClient;

  public constructor(
    private readonly sourceInfoUrl: string,
    options: HyperliquidHttpClientOptions = {},
  ) {
    // A configurable mirror/testnet endpoint is not canonical mainnet quote provenance.
    this.client = new HyperliquidHttpClient(OFFICIAL_HYPERLIQUID_INFO, options);
  }

  public async resolve(coin: string): Promise<BehaviorMarketResolution> {
    if (coin !== XYZ_CL_QUOTE_CONTRACT.coin) return unresolvedBehaviorMarket(coin);
    if (this.sourceInfoUrl !== OFFICIAL_HYPERLIQUID_INFO)
      return {
        quoteAsset: "UNKNOWN",
        usdEquivalent: false,
        detail: "Source is not the canonical Hyperliquid mainnet Info endpoint.",
      };
    const responses: BehaviorQuoteEvidence["responses"][number][] = [];
    const capture = async <T>(
      request: Record<string, string>,
      pending: Promise<HyperliquidHttpResponse<T>>,
    ) => {
      const response = await pending;
      responses.push({
        endpoint: OFFICIAL_HYPERLIQUID_INFO,
        request,
        observedAt: new Date().toISOString(),
        rawText: response.rawText,
        sha256: hash(response.rawText),
      });
      return response.data;
    };
    try {
      const dexes = await capture({ type: "perpDexs" }, this.client.perpDexs());
      const meta = await capture({ type: "meta", dex: "xyz" }, this.client.meta("xyz"));
      const spot = await capture({ type: "spotMeta" }, this.client.spotMeta());
      const annotation = await capture(
        { type: "perpAnnotation", coin },
        this.client.perpAnnotation(coin),
      );
      if (!verifyXyzClQuoteMetadata({ coin, dexes, meta, spot, annotation })) {
        return {
          quoteAsset: "UNKNOWN",
          usdEquivalent: false,
          detail:
            "Official metadata is missing, ambiguous, or conflicts with hyperliquid-xyz-cl-usd-v1.",
        };
      }
      return {
        quoteAsset: "USD",
        usdEquivalent: true,
        evidence: {
          contract: XYZ_CL_QUOTE_CONTRACT,
          responses,
          fingerprint: hash(
            JSON.stringify({
              contract: XYZ_CL_QUOTE_CONTRACT,
              responses: responses.map(({ request, sha256 }) => ({ request, sha256 })),
            }),
          ),
        },
      };
    } catch (error) {
      return {
        quoteAsset: "UNKNOWN",
        usdEquivalent: false,
        detail: `Official quote metadata could not be verified: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
