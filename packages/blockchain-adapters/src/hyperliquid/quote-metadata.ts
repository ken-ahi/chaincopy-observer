import { z } from "zod";

import { exactIntegerStringSchema } from "./schemas.js";

const indexSchema = exactIntegerStringSchema
  .transform(Number)
  .refine((value) => Number.isSafeInteger(value) && value >= 0);

export const perpDexsSchema = z.array(
  z.object({ name: z.string(), deployer: z.string() }).passthrough().nullable(),
);
export const quoteSpotMetaSchema = z
  .object({
    tokens: z.array(
      z
        .object({
          index: indexSchema,
          name: z.string(),
          tokenId: z.string(),
          isCanonical: z.boolean(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export const perpAnnotationSchema = z
  .object({
    category: z.string(),
    description: z.string(),
    displayName: z.string(),
  })
  .passthrough();

export const XYZ_CL_QUOTE_CONTRACT = {
  version: "hyperliquid-xyz-cl-usd-v1",
  coin: "xyz:CL",
  dex: "xyz",
  dexIndex: 1,
  deployer: "0x88806a71d74ad0a510b350545c9ae490912f0888",
  marketIndex: 29,
  assetId: 110029,
  baseAsset: "WTI_LIGHT_SWEET_CRUDE_OIL",
  baseUnit: "barrel",
  quoteAsset: "USD",
  collateralAsset: "USDC",
  collateralToken: 0,
  collateralTokenId: "0x6d1e7cde53ba9467b783cb7c530ce054",
  valuationCurrency: "USD",
  contractMultiplier: "1",
  szDecimals: 3,
  annotation: {
    category: "commodities",
    displayName: "WTIOIL",
    description:
      "WTIOIL references the USD price of 1 barrel of WTI Light Sweet Crude Oil. WTI serves as a primary global benchmark for oil prices due to its high quality (low density, low sulfur).",
  },
} as const;

// This is an exact, reviewed definition lookup, not an inference from coin/token names.
// Annotation is mutable: a changed description requires a new review, not a USD regex.
export function verifyXyzClQuoteMetadata(input: {
  coin: string;
  dexes: z.infer<typeof perpDexsSchema>;
  meta: { collateralToken?: unknown; universe: readonly { name: string; szDecimals: number }[] };
  spot: z.infer<typeof quoteSpotMetaSchema>;
  annotation: z.infer<typeof perpAnnotationSchema>;
}): boolean {
  const contract = XYZ_CL_QUOTE_CONTRACT;
  const dex = input.dexes[contract.dexIndex];
  const market = input.meta.universe[contract.marketIndex];
  const collateral = input.spot.tokens.filter((token) => token.index === contract.collateralToken);
  const token = collateral[0];
  const collateralIndex = indexSchema.safeParse(input.meta.collateralToken);
  return (
    input.coin === contract.coin &&
    input.dexes.filter((entry) => entry?.name === contract.dex).length === 1 &&
    dex?.name === contract.dex &&
    dex.deployer === contract.deployer &&
    input.meta.universe.filter((entry) => entry.name === contract.coin).length === 1 &&
    market?.name === contract.coin &&
    market.szDecimals === contract.szDecimals &&
    collateralIndex.success &&
    collateralIndex.data === contract.collateralToken &&
    collateral.length === 1 &&
    token?.name === contract.collateralAsset &&
    token.isCanonical &&
    token.tokenId === contract.collateralTokenId &&
    input.spot.tokens.filter((entry) => entry.tokenId === contract.collateralTokenId).length ===
      1 &&
    input.annotation.category === contract.annotation.category &&
    input.annotation.displayName === contract.annotation.displayName &&
    input.annotation.description === contract.annotation.description
  );
}
