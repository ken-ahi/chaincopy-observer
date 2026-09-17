import { createHash } from "node:crypto";

import { Decimal } from "decimal.js";
import { parse as parseLossless } from "lossless-json";
import { z } from "zod";

import { hyperliquidAddressSchema, normalizeHyperliquidAddress } from "./address.js";
import { createEventFingerprint } from "./event-fingerprint.js";
import { exactIntegerStringSchema, fillSchema, type HyperliquidFill } from "./schemas.js";

const FinancialDecimal = Decimal.clone({ precision: 80 });
const hourMs = 60 * 60 * 1_000;
const officialBucket = "hl-mainnet-node-data";
export const historicalFillParserVersion = "hyperliquid-official-fills-v1" as const;

export type HistoricalFillFormat = "NODE_FILLS" | "NODE_FILLS_BY_BLOCK";

export interface HistoricalFillObject {
  readonly bucket: typeof officialBucket;
  readonly etag: string;
  readonly format: HistoricalFillFormat;
  readonly hourStart: string;
  readonly key: string;
  readonly lastModified: string;
  readonly sizeBytes: string;
  readonly versionId?: string | undefined;
}

export interface HistoricalFillTarget {
  readonly from: string;
  readonly to: string;
  readonly walletAddress: string;
  readonly walletAddressId: string;
}

export interface HistoricalFillInventory {
  readonly bucket: typeof officialBucket;
  readonly generatedAt: string;
  readonly objects: ReadonlyArray<HistoricalFillObject>;
  readonly requesterPays: true;
}

export interface HistoricalFillPlan {
  readonly ambiguousHours: ReadonlyArray<string>;
  readonly complete: boolean;
  readonly inventoryManifestSha256: string;
  readonly missingHours: ReadonlyArray<string>;
  readonly selectedObjects: ReadonlyArray<HistoricalFillObject>;
  readonly targets: ReadonlyArray<HistoricalFillTarget>;
  readonly totalBytes: string;
}

export interface HistoricalFillPricing {
  readonly egressUsdPerGib: string;
  readonly getRequestUsdPerThousand: string;
  readonly inventoryRequestCount: string;
  readonly inventoryRequestUsdPerThousand: string;
}

export interface HistoricalFillCostEstimate {
  readonly downloadGib: string;
  readonly egressUsd: string;
  readonly getRequestCount: string;
  readonly getRequestUsd: string;
  readonly inventoryRequestCount: string;
  readonly inventoryRequestUsd: string;
  readonly totalUsd: string;
}

export interface HistoricalFillProvenance {
  readonly bucket: typeof officialBucket;
  readonly etag: string;
  readonly eventIndex: number;
  readonly format: HistoricalFillFormat;
  readonly hourStart: string;
  readonly inventoryManifestSha256: string;
  readonly key: string;
  readonly lastModified: string;
  readonly lineNumber: number;
  readonly objectSha256: string;
  readonly parserVersion: typeof historicalFillParserVersion;
  readonly requesterCharged: true;
  readonly sizeBytes: string;
  readonly versionId?: string | undefined;
  readonly blockNumber?: string | undefined;
}

export interface AddressedHistoricalFill {
  readonly fill: HyperliquidFill;
  readonly provenance: HistoricalFillProvenance;
  readonly walletAddress: string;
}

export interface HistoricalFillDeduplicationResult {
  readonly duplicates: number;
  readonly fills: ReadonlyArray<AddressedHistoricalFill>;
}

const isoTimestampSchema = z.iso
  .datetime({ offset: true })
  .transform((value) => new Date(value).toISOString());
const nonNegativeIntegerStringSchema = exactIntegerStringSchema.refine(
  (value) => !new FinancialDecimal(value).isNegative(),
  "Expected a non-negative integer string.",
);

const objectSchema = z
  .object({
    bucket: z.literal(officialBucket),
    etag: z.string().trim().min(1),
    format: z.enum(["NODE_FILLS", "NODE_FILLS_BY_BLOCK"]),
    hourStart: isoTimestampSchema,
    key: z.string().trim().min(1),
    lastModified: isoTimestampSchema,
    sizeBytes: nonNegativeIntegerStringSchema,
    versionId: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((object, context) => {
    const expectedPrefix = object.format === "NODE_FILLS" ? "node_fills/" : "node_fills_by_block/";
    if (!object.key.startsWith(expectedPrefix)) {
      context.addIssue({
        code: "custom",
        message: `Object key must start with ${expectedPrefix} for ${object.format}.`,
        path: ["key"],
      });
    }
    if (Date.parse(object.hourStart) % hourMs !== 0) {
      context.addIssue({
        code: "custom",
        message: "hourStart must be aligned to an exact UTC hour.",
        path: ["hourStart"],
      });
    }
  });

export const historicalFillInventorySchema = z
  .object({
    bucket: z.literal(officialBucket),
    generatedAt: isoTimestampSchema,
    objects: z.array(objectSchema),
    requesterPays: z.literal(true),
  })
  .strict();

export const historicalFillTargetSchema = z
  .object({
    from: isoTimestampSchema,
    to: isoTimestampSchema,
    walletAddress: hyperliquidAddressSchema,
    walletAddressId: z.string().trim().min(1),
  })
  .strict()
  .superRefine((target, context) => {
    if (Date.parse(target.from) > Date.parse(target.to)) {
      context.addIssue({
        code: "custom",
        message: "from must be at or before to.",
        path: ["from"],
      });
    }
  });

const addressedFillSchema = z.tuple([hyperliquidAddressSchema, fillSchema]);
const blockFillSchema = z
  .object({
    block_number: exactIntegerStringSchema,
    block_time: isoTimestampSchema,
    events: z.array(addressedFillSchema),
    local_time: isoTimestampSchema,
  })
  .passthrough();
const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);
const provenanceBaseSchema = z
  .object({
    bucket: z.literal(officialBucket),
    etag: z.string().trim().min(1),
    format: z.enum(["NODE_FILLS", "NODE_FILLS_BY_BLOCK"]),
    hourStart: isoTimestampSchema,
    inventoryManifestSha256: sha256Schema,
    key: z.string().trim().min(1),
    lastModified: isoTimestampSchema,
    lineNumber: z.number().int().positive(),
    objectSha256: sha256Schema,
    parserVersion: z.literal(historicalFillParserVersion),
    requesterCharged: z.literal(true),
    sizeBytes: nonNegativeIntegerStringSchema,
    versionId: z.string().trim().min(1).optional(),
  })
  .strict()
  .superRefine((provenance, context) => {
    const expectedPrefix =
      provenance.format === "NODE_FILLS" ? "node_fills/" : "node_fills_by_block/";
    if (!provenance.key.startsWith(expectedPrefix)) {
      context.addIssue({
        code: "custom",
        message: `Object key must start with ${expectedPrefix} for ${provenance.format}.`,
        path: ["key"],
      });
    }
  });

export function buildHistoricalFillPlan(
  inventoryInput: unknown,
  targetInputs: ReadonlyArray<unknown>,
): HistoricalFillPlan {
  const inventory = historicalFillInventorySchema.parse(inventoryInput);
  const targets = targetInputs.map((target) => historicalFillTargetSchema.parse(target));
  if (targets.length === 0) {
    throw new RangeError("At least one historical fill target is required.");
  }

  const objectsByHour = new Map<string, HistoricalFillObject[]>();
  for (const object of inventory.objects) {
    const hour = new Date(object.hourStart).toISOString();
    const current = objectsByHour.get(hour) ?? [];
    current.push(object);
    objectsByHour.set(hour, current);
  }

  const requiredHours = new Set<string>();
  for (const target of targets) {
    for (const hour of enumerateUtcHours(target.from, target.to)) requiredHours.add(hour);
  }

  const ambiguousHours: string[] = [];
  const missingHours: string[] = [];
  const selectedObjects: HistoricalFillObject[] = [];
  for (const hour of [...requiredHours].sort()) {
    const candidates = objectsByHour.get(hour) ?? [];
    if (candidates.length === 0) missingHours.push(hour);
    else if (candidates.length > 1) ambiguousHours.push(hour);
    else selectedObjects.push(candidates[0]!);
  }

  const totalBytes = selectedObjects.reduce(
    (total, object) => total.plus(object.sizeBytes),
    new FinancialDecimal(0),
  );
  return {
    ambiguousHours,
    complete: missingHours.length === 0 && ambiguousHours.length === 0,
    inventoryManifestSha256: fingerprintInventory(inventory),
    missingHours,
    selectedObjects,
    targets,
    totalBytes: totalBytes.toFixed(0),
  };
}

export function estimateHistoricalFillCost(
  plan: HistoricalFillPlan,
  pricingInput: HistoricalFillPricing,
): HistoricalFillCostEstimate {
  const pricing = parsePricing(pricingInput);
  const bytes = new FinancialDecimal(plan.totalBytes);
  const gib = bytes.div(new FinancialDecimal(2).pow(30));
  const getRequests = new FinancialDecimal(plan.selectedObjects.length);
  const inventoryRequests = new FinancialDecimal(pricing.inventoryRequestCount);
  const egressUsd = gib.mul(pricing.egressUsdPerGib);
  const getRequestUsd = getRequests.div(1_000).mul(pricing.getRequestUsdPerThousand);
  const inventoryRequestUsd = inventoryRequests
    .div(1_000)
    .mul(pricing.inventoryRequestUsdPerThousand);

  return {
    downloadGib: gib.toFixed(9),
    egressUsd: egressUsd.toFixed(9),
    getRequestCount: getRequests.toFixed(0),
    getRequestUsd: getRequestUsd.toFixed(9),
    inventoryRequestCount: inventoryRequests.toFixed(0),
    inventoryRequestUsd: inventoryRequestUsd.toFixed(9),
    totalUsd: egressUsd.plus(getRequestUsd).plus(inventoryRequestUsd).toFixed(9),
  };
}

export function parseHistoricalFillLine(
  line: string,
  provenance: Omit<HistoricalFillProvenance, "eventIndex" | "blockNumber">,
): ReadonlyArray<AddressedHistoricalFill> {
  const validatedProvenance = provenanceBaseSchema.parse(provenance);
  const parsed = parseLossless(line);
  if (validatedProvenance.format === "NODE_FILLS") {
    const [walletAddress, fill] = addressedFillSchema.parse(parsed);
    return [{ fill, provenance: { ...validatedProvenance, eventIndex: 0 }, walletAddress }];
  }

  const block = blockFillSchema.parse(parsed);
  return block.events.map(([walletAddress, fill], eventIndex) => ({
    fill,
    provenance: {
      ...validatedProvenance,
      blockNumber: block.block_number,
      eventIndex,
    },
    walletAddress,
  }));
}

export function selectAndDeduplicateHistoricalFills(
  records: ReadonlyArray<AddressedHistoricalFill>,
  targetWalletAddresses: ReadonlyArray<string>,
): HistoricalFillDeduplicationResult {
  const targets = new Set(targetWalletAddresses.map(normalizeHyperliquidAddress));
  if (targets.size === 0) throw new RangeError("At least one target wallet address is required.");

  const selected = records.filter((record) => targets.has(record.walletAddress));
  const byIdentity = new Map<string, AddressedHistoricalFill>();
  let duplicates = 0;
  for (const record of selected) {
    const identity = historicalFillIdentity(record.walletAddress, record.fill);
    const existing = byIdentity.get(identity);
    if (!existing) {
      byIdentity.set(identity, record);
      continue;
    }
    if (historicalFillPayloadFingerprint(existing) !== historicalFillPayloadFingerprint(record)) {
      throw new Error(`Conflicting historical fill payloads share identity ${identity}.`);
    }
    duplicates += 1;
  }

  return {
    duplicates,
    fills: [...byIdentity.values()].sort(compareHistoricalFills),
  };
}

export function historicalFillIdentity(walletAddress: string, fill: HyperliquidFill): string {
  return [normalizeHyperliquidAddress(walletAddress), fill.time, fill.coin, fill.tid].join(":");
}

function historicalFillPayloadFingerprint(record: AddressedHistoricalFill): string {
  const fill = record.fill;
  const knownKeys = new Set([
    "builderFee",
    "closedPnl",
    "coin",
    "crossed",
    "dir",
    "fee",
    "feeToken",
    "hash",
    "liquidation",
    "oid",
    "px",
    "side",
    "startPosition",
    "sz",
    "tid",
    "time",
  ]);
  const additionalFields = Object.fromEntries(
    Object.entries(fill).filter(([key]) => !knownKeys.has(key)),
  );
  return createEventFingerprint("historical-fill-payload", record.walletAddress, {
    additionalFields,
    builderFee: canonicalOptionalDecimal(fill.builderFee),
    closedPnl: canonicalDecimal(fill.closedPnl),
    coin: fill.coin,
    crossed: fill.crossed,
    dir: fill.dir,
    fee: canonicalDecimal(fill.fee),
    feeToken: fill.feeToken,
    hash: fill.hash,
    liquidation: fill.liquidation
      ? {
          ...fill.liquidation,
          markPx: canonicalDecimal(fill.liquidation.markPx),
        }
      : null,
    oid: fill.oid,
    px: canonicalDecimal(fill.px),
    side: fill.side,
    startPosition: canonicalDecimal(fill.startPosition),
    sz: canonicalDecimal(fill.sz),
    tid: fill.tid,
    time: fill.time,
  });
}

function compareHistoricalFills(
  left: AddressedHistoricalFill,
  right: AddressedHistoricalFill,
): number {
  return (
    left.fill.time - right.fill.time ||
    left.walletAddress.localeCompare(right.walletAddress) ||
    left.fill.coin.localeCompare(right.fill.coin) ||
    new FinancialDecimal(left.fill.tid).comparedTo(right.fill.tid)
  );
}

function enumerateUtcHours(from: string, to: string): string[] {
  const first = Math.floor(Date.parse(from) / hourMs) * hourMs;
  const last = Math.floor(Date.parse(to) / hourMs) * hourMs;
  const result: string[] = [];
  for (let timestamp = first; timestamp <= last; timestamp += hourMs) {
    result.push(new Date(timestamp).toISOString());
  }
  return result;
}

function fingerprintInventory(inventory: HistoricalFillInventory): string {
  const canonical = {
    bucket: inventory.bucket,
    generatedAt: inventory.generatedAt,
    objects: [...inventory.objects].sort((left, right) =>
      `${left.hourStart}:${left.key}:${left.etag}`.localeCompare(
        `${right.hourStart}:${right.key}:${right.etag}`,
      ),
    ),
    requesterPays: inventory.requesterPays,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function parsePricing(pricing: HistoricalFillPricing): HistoricalFillPricing {
  const entries = Object.entries(pricing);
  for (const [name, value] of entries) {
    if (typeof value !== "string") {
      throw new TypeError(`${name} must be a Decimal string.`);
    }
    const decimal = new FinancialDecimal(value);
    if (!decimal.isFinite() || decimal.isNegative()) {
      throw new RangeError(`${name} must be a non-negative Decimal string.`);
    }
  }
  if (!new FinancialDecimal(pricing.inventoryRequestCount).isInteger()) {
    throw new RangeError("inventoryRequestCount must be an integer Decimal string.");
  }
  return pricing;
}

function canonicalDecimal(value: string): string {
  const decimal = new FinancialDecimal(value);
  return decimal.isZero() ? "0" : decimal.toFixed();
}

function canonicalOptionalDecimal(value: string | undefined): string | null {
  return value === undefined ? null : canonicalDecimal(value);
}
