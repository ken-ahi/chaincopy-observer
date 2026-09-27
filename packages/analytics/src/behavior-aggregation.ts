import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";

import { BEHAVIOR_VERSION, behaviorEventFingerprint } from "./behavior-normalization.js";

export const AGGREGATION_VERSION = "behavior-aggregation-v1";
export const AGGREGATION_BUCKET_MS = 15 * 60 * 1_000;
export const AGGREGATION_MAX_EVENTS = 10_000;
export const AGGREGATION_SEMANTICS = [
  "LONG_OPEN",
  "LONG_INCREASE",
  "LONG_REDUCE",
  "LONG_CLOSE",
  "SHORT_OPEN",
  "SHORT_INCREASE",
  "SHORT_REDUCE",
  "SHORT_CLOSE",
] as const;
export type AggregationSemantic = (typeof AGGREGATION_SEMANTICS)[number];
const Money = Decimal.clone({ precision: 80 });

export interface AggregationMember {
  walletAddressId: string;
  address: string;
  selectionRunId: string;
  performanceRunId: string | null;
}
export interface AggregationEvent {
  id: string;
  fingerprint: string;
  behaviorVersion: string;
  walletAddressId: string;
  coin: string;
  occurredAt: string;
  eventType: string;
  direction: string;
  notionalDeltaUsd: string;
  sourceEventId: string;
  sourceOrdinal: number;
  normalizationRunId: string;
  generationSelectionRunId: string | null;
  generationPerformanceRunId: string | null;
}
export interface AggregationInput {
  coin: string;
  bucketStart: string;
  members: readonly AggregationMember[];
  events: readonly AggregationEvent[];
  issues: readonly string[];
}
export interface AggregationCell {
  eventCount: number;
  uniqueWalletCount: number;
  walletIds: string[];
  notionalUsd: string;
}
export interface AggregationTotals extends AggregationCell {
  semantics: Record<AggregationSemantic, AggregationCell>;
}

export function aggregationHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function utcBucketStart(value: string | Date): string {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (
    !Number.isSafeInteger(time) ||
    (typeof value === "string" && new Date(time).toISOString() !== value)
  )
    throw new RangeError("A canonical UTC millisecond timestamp is required.");
  return new Date(Math.floor(time / AGGREGATION_BUCKET_MS) * AGGREGATION_BUCKET_MS).toISOString();
}
export function aggregationScope(members: readonly AggregationMember[]) {
  const sorted = members
    .map((member) => ({
      walletAddressId: member.walletAddressId,
      address: member.address,
      selectionRunId: member.selectionRunId,
      performanceRunId: member.performanceRunId,
    }))
    .sort((a, b) =>
      a.walletAddressId < b.walletAddressId ? -1 : a.walletAddressId > b.walletAddressId ? 1 : 0,
    );
  if (
    !sorted.length ||
    sorted.length > 200 ||
    new Set(sorted.map((m) => m.walletAddressId)).size !== sorted.length ||
    new Set(sorted.map((m) => m.selectionRunId)).size !== 1 ||
    sorted.some(
      (m) => !m.performanceRunId || !m.selectionRunId || !/^0x[0-9a-f]{40}$/.test(m.address),
    )
  )
    throw new RangeError("Inconsistent or unbounded Selection provenance.");
  return {
    members: sorted,
    selectionRunId: sorted[0]!.selectionRunId,
    fingerprint: aggregationHash(sorted),
  };
}

export function aggregateBehaviorBucket(input: AggregationInput) {
  const bucketStart = utcBucketStart(input.bucketStart);
  if (bucketStart !== input.bucketStart || !input.coin || input.coin.length > 100)
    throw new RangeError("Invalid aggregation bucket key.");
  const bucketEnd = new Date(Date.parse(bucketStart) + AGGREGATION_BUCKET_MS).toISOString();
  const scope = aggregationScope(input.members);
  const issues = new Set(input.issues);
  const events = new Map<string, AggregationEvent>();
  if (input.events.length > AGGREGATION_MAX_EVENTS)
    throw new RangeError("Aggregation event bound exceeded.");
  for (const event of input.events) {
    const canonical: AggregationEvent = {
      id: event.id,
      fingerprint: event.fingerprint,
      behaviorVersion: event.behaviorVersion,
      walletAddressId: event.walletAddressId,
      coin: event.coin,
      occurredAt: event.occurredAt,
      eventType: event.eventType,
      direction: event.direction,
      notionalDeltaUsd: event.notionalDeltaUsd,
      sourceEventId: event.sourceEventId,
      sourceOrdinal: event.sourceOrdinal,
      normalizationRunId: event.normalizationRunId,
      generationSelectionRunId: event.generationSelectionRunId,
      generationPerformanceRunId: event.generationPerformanceRunId,
    };
    try {
      const amount = new Money(event.notionalDeltaUsd);
      if (
        !amount.isFinite() ||
        amount.isNegative() ||
        amount.decimalPlaces() > 18 ||
        amount.gte("1e20")
      )
        throw new Error("Invalid notional");
      canonical.notionalDeltaUsd = amount.toFixed();
    } catch {
      issues.add(`INVALID_DECIMAL:${event.id}`);
    }
    try {
      if (utcBucketStart(event.occurredAt) !== bucketStart)
        issues.add(`INVALID_TIMESTAMP:${event.id}`);
    } catch {
      issues.add(`INVALID_TIMESTAMP:${event.id}`);
    }
    if (
      event.coin !== input.coin ||
      event.behaviorVersion !== BEHAVIOR_VERSION ||
      !scope.members.some((m) => m.walletAddressId === event.walletAddressId) ||
      !event.generationSelectionRunId ||
      !event.generationPerformanceRunId ||
      !event.normalizationRunId
    )
      issues.add(`INCONSISTENT_PROVENANCE:${event.id}`);
    if (
      !Number.isSafeInteger(event.sourceOrdinal) ||
      ![0, 1].includes(event.sourceOrdinal) ||
      event.fingerprint !== behaviorEventFingerprint(event)
    )
      issues.add(`INVALID_IDENTITY:${event.id}`);
    if (!semanticFor(event)) issues.add(`INVALID_SEMANTIC:${event.id}`);
    const previous = events.get(event.fingerprint);
    if (previous && JSON.stringify(previous) !== JSON.stringify(canonical))
      issues.add(`CONFLICTING_DUPLICATE:${event.fingerprint}`);
    else events.set(event.fingerprint, canonical);
  }
  const ordered = [...events.values()].sort((a, b) =>
    a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0,
  );
  const snapshot = {
    aggregationVersion: AGGREGATION_VERSION,
    behaviorVersion: BEHAVIOR_VERSION,
    coverageBasis: "PERSISTED_BEHAVIOR_EVENTS",
    coin: input.coin,
    bucketStart,
    bucketEnd,
    members: scope.members,
    events: ordered,
    issues: [...issues].sort(),
  };
  const bucketId = aggregationHash([
    AGGREGATION_VERSION,
    BEHAVIOR_VERSION,
    scope.selectionRunId,
    scope.fingerprint,
    input.coin,
    bucketStart,
  ]);
  const inputFingerprint = aggregationHash(snapshot);
  let totals: AggregationTotals | null = null;
  if (!issues.size) {
    const semantics = Object.fromEntries(
      AGGREGATION_SEMANTICS.map((semantic) => [
        semantic,
        cell(ordered.filter((event) => semanticFor(event) === semantic)),
      ]),
    ) as Record<AggregationSemantic, AggregationCell>;
    totals = { ...cell(ordered), semantics };
  }
  return {
    bucketId,
    bucketStart,
    bucketEnd,
    selectionRunId: scope.selectionRunId,
    scopeFingerprint: scope.fingerprint,
    inputFingerprint,
    snapshot,
    status: issues.size
      ? ("BLOCKED" as const)
      : ordered.length
        ? ("VALID" as const)
        : ("EMPTY" as const),
    totals,
  };
}

function semanticFor(
  event: Pick<AggregationEvent, "direction" | "eventType">,
): AggregationSemantic | null {
  const mapped = `${event.direction}_${event.eventType.replace(/^POSITION_/, "")}`;
  return event.eventType.startsWith("POSITION_") &&
    AGGREGATION_SEMANTICS.includes(mapped as AggregationSemantic)
    ? (mapped as AggregationSemantic)
    : null;
}
function cell(events: readonly AggregationEvent[]): AggregationCell {
  const walletIds = [...new Set(events.map((event) => event.walletAddressId))].sort();
  return {
    eventCount: events.length,
    uniqueWalletCount: walletIds.length,
    walletIds,
    notionalUsd: events
      .reduce((sum, event) => sum.plus(event.notionalDeltaUsd), new Money(0))
      .toFixed(),
  };
}
