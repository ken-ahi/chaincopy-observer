import { createHash } from "node:crypto";

import { Decimal } from "decimal.js";

export const BEHAVIOR_VERSION = "behavior-v1" as const;

export type BehaviorEventType =
  "POSITION_OPEN" | "POSITION_INCREASE" | "POSITION_REDUCE" | "POSITION_CLOSE";
export type BehaviorDirection = "LONG" | "SHORT";
export type BehaviorFailureReason =
  | "MISSING_BOUNDARY"
  | "ORDERING_AMBIGUOUS"
  | "INVALID_DECIMAL"
  | "SOURCE_INCONSISTENT"
  | "IMPOSSIBLE_TRANSITION"
  | "HISTORY_GAP"
  | "UNSUPPORTED_QUOTE"
  | "INCOMPLETE_TIMESTAMP_GROUP";

export interface BehaviorFillInput {
  readonly sourceEventId: string;
  readonly sourceTradeId: string | null;
  readonly coin: string;
  readonly side: "BUY" | "SELL";
  readonly quantity: string;
  readonly price: string;
  readonly startPosition: string;
  readonly occurredAt: Date;
}

export interface BehaviorMarketProvenance {
  readonly quoteAsset: string;
  readonly usdEquivalent: boolean;
}

export interface SelectedWalletBehaviorEventValue {
  readonly behaviorVersion: typeof BEHAVIOR_VERSION;
  readonly coin: string;
  readonly direction: BehaviorDirection;
  readonly eventType: BehaviorEventType;
  readonly fingerprint: string;
  readonly sourceEventId: string;
  readonly sourceOrdinal: number;
  readonly sourceTradeId: string | null;
  readonly occurredAt: Date;
  readonly beforePosition: string;
  readonly afterPosition: string;
  readonly quantityDelta: string;
  readonly notionalDeltaUsd: string;
  readonly sourcePrice: string;
  readonly sourceQuantity: string;
}

export type BehaviorGroupResult =
  | {
      readonly ok: true;
      readonly afterPosition: string;
      readonly events: readonly SelectedWalletBehaviorEventValue[];
      readonly orderedSourceEventIds: readonly string[];
    }
  | { readonly ok: false; readonly reason: BehaviorFailureReason; readonly detail: string };

const MAX_BRANCH_SEARCH_STEPS = 100_000;

export function canonicalDecimal(value: string): string {
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) throw new RangeError(`Invalid finite Decimal: ${value}`);
  const canonical = decimal.toFixed();
  return new Decimal(canonical).isZero() ? "0" : canonical;
}

export function signedQuantityDelta(fill: Pick<BehaviorFillInput, "quantity" | "side">): string {
  const quantity = new Decimal(canonicalDecimal(fill.quantity));
  if (!quantity.isPositive()) throw new RangeError("Fill quantity must be positive.");
  return canonicalDecimal(fill.side === "BUY" ? quantity.toFixed() : quantity.negated().toFixed());
}

export function behaviorEventFingerprint(input: {
  readonly sourceEventId: string;
  readonly sourceOrdinal: number;
  readonly behaviorVersion?: string;
}): string {
  return createHash("sha256")
    .update(
      `${input.behaviorVersion ?? BEHAVIOR_VERSION}\u0000${input.sourceEventId}\u0000${input.sourceOrdinal}`,
    )
    .digest("hex");
}

function positionDirection(value: Decimal): BehaviorDirection | null {
  return value.isZero() ? null : value.isPositive() ? "LONG" : "SHORT";
}

function eventForLeg(
  fill: BehaviorFillInput,
  before: Decimal,
  after: Decimal,
  ordinal: number,
  eventType: BehaviorEventType,
  direction: BehaviorDirection,
  quantityDelta: Decimal,
): SelectedWalletBehaviorEventValue {
  const sourceQuantity = canonicalDecimal(fill.quantity);
  const sourcePrice = canonicalDecimal(fill.price);
  return {
    behaviorVersion: BEHAVIOR_VERSION,
    coin: fill.coin,
    direction,
    eventType,
    fingerprint: behaviorEventFingerprint({
      sourceEventId: fill.sourceEventId,
      sourceOrdinal: ordinal,
    }),
    sourceEventId: fill.sourceEventId,
    sourceOrdinal: ordinal,
    sourceTradeId: fill.sourceTradeId,
    occurredAt: fill.occurredAt,
    beforePosition: canonicalDecimal(before.toFixed()),
    afterPosition: canonicalDecimal(after.toFixed()),
    quantityDelta: canonicalDecimal(quantityDelta.toFixed()),
    notionalDeltaUsd: canonicalDecimal(new Decimal(sourcePrice).mul(quantityDelta.abs()).toFixed()),
    sourcePrice,
    sourceQuantity,
  };
}

function eventsForTransition(
  fill: BehaviorFillInput,
  before: Decimal,
  after: Decimal,
): readonly SelectedWalletBehaviorEventValue[] {
  const beforeDirection = positionDirection(before);
  const afterDirection = positionDirection(after);
  if (beforeDirection !== null && afterDirection !== null && beforeDirection !== afterDirection) {
    const closeDelta = before.negated();
    const openDelta = after;
    return [
      eventForLeg(fill, before, new Decimal(0), 0, "POSITION_CLOSE", beforeDirection, closeDelta),
      eventForLeg(fill, new Decimal(0), after, 1, "POSITION_OPEN", afterDirection, openDelta),
    ];
  }
  const delta = after.sub(before);
  if (beforeDirection === null && afterDirection !== null)
    return [eventForLeg(fill, before, after, 0, "POSITION_OPEN", afterDirection, delta)];
  if (beforeDirection !== null && afterDirection === null)
    return [eventForLeg(fill, before, after, 0, "POSITION_CLOSE", beforeDirection, delta)];
  if (beforeDirection === null || afterDirection === null || beforeDirection !== afterDirection)
    throw new RangeError("Impossible position transition.");
  const eventType = after.abs().gt(before.abs()) ? "POSITION_INCREASE" : "POSITION_REDUCE";
  if (after.abs().eq(before.abs()))
    throw new RangeError("A fill cannot leave position size unchanged.");
  return [eventForLeg(fill, before, after, 0, eventType, afterDirection, delta)];
}

interface Edge {
  readonly fill: BehaviorFillInput;
  readonly before: string;
  readonly after: string;
}

function findChains(edges: readonly Edge[], boundary: string): readonly number[][] {
  const outgoing = new Map<string, number[]>();
  edges.forEach((edge, index) =>
    outgoing.set(edge.before, [...(outgoing.get(edge.before) ?? []), index]),
  );
  const solutions: number[][] = [];
  let steps = 0;
  const stack: Array<{ current: string; path: number[]; used: Set<number> }> = [
    { current: boundary, path: [], used: new Set() },
  ];
  while (stack.length > 0 && solutions.length < 2) {
    if (++steps > MAX_BRANCH_SEARCH_STEPS) return [];
    const state = stack.pop();
    if (state === undefined) break;
    if (state.path.length === edges.length) {
      solutions.push(state.path);
      continue;
    }
    const candidates = (outgoing.get(state.current) ?? []).filter(
      (index) => !state.used.has(index),
    );
    for (const index of candidates) {
      const used = new Set(state.used);
      used.add(index);
      stack.push({ current: edges[index]!.after, path: [...state.path, index], used });
    }
  }
  return solutions;
}

export function normalizeTimestampGroup(input: {
  readonly boundaryPosition: string | null;
  readonly fills: readonly BehaviorFillInput[];
  readonly market: BehaviorMarketProvenance;
}): BehaviorGroupResult {
  if (input.boundaryPosition === null)
    return {
      ok: false,
      reason: "MISSING_BOUNDARY",
      detail: "A trusted boundary position is required.",
    };
  if (
    !input.market.usdEquivalent ||
    !["USD", "USDC"].includes(input.market.quoteAsset.toUpperCase())
  ) {
    return {
      ok: false,
      reason: "UNSUPPORTED_QUOTE",
      detail: `Quote ${input.market.quoteAsset} is not proven USD-equivalent.`,
    };
  }
  if (input.fills.length === 0)
    return {
      ok: true,
      afterPosition: canonicalDecimal(input.boundaryPosition),
      events: [],
      orderedSourceEventIds: [],
    };
  const timestamp = input.fills[0]!.occurredAt.getTime();
  if (
    !Number.isFinite(timestamp) ||
    input.fills.some((fill) => fill.occurredAt.getTime() !== timestamp)
  ) {
    return {
      ok: false,
      reason: "INCOMPLETE_TIMESTAMP_GROUP",
      detail: "All fills must belong to one valid, complete timestamp group.",
    };
  }
  const sourceSnapshots = new Map<string, string>();
  const edges: Edge[] = [];
  try {
    for (const fill of input.fills) {
      const before = canonicalDecimal(fill.startPosition);
      const quantityDelta = signedQuantityDelta(fill);
      const price = canonicalDecimal(fill.price);
      const snapshot = JSON.stringify({
        before,
        coin: fill.coin,
        occurredAt: fill.occurredAt.toISOString(),
        price,
        quantityDelta,
        sourceTradeId: fill.sourceTradeId,
      });
      const previousSnapshot = sourceSnapshots.get(fill.sourceEventId);
      if (previousSnapshot === snapshot) continue;
      if (previousSnapshot !== undefined)
        return {
          ok: false,
          reason: "SOURCE_INCONSISTENT",
          detail: `Source event ${fill.sourceEventId} has conflicting snapshots.`,
        };
      sourceSnapshots.set(fill.sourceEventId, snapshot);
      const after = canonicalDecimal(new Decimal(before).add(quantityDelta).toFixed());
      edges.push({ fill, before, after });
    }
  } catch (error) {
    return {
      ok: false,
      reason: "INVALID_DECIMAL",
      detail: error instanceof Error ? error.message : "Invalid Decimal.",
    };
  }
  const boundary = canonicalDecimal(input.boundaryPosition);
  const chains = findChains(edges, boundary);
  if (chains.length > 1)
    return {
      ok: false,
      reason: "ORDERING_AMBIGUOUS",
      detail: "More than one complete causal chain exists.",
    };
  if (chains.length === 0)
    return {
      ok: false,
      reason: "IMPOSSIBLE_TRANSITION",
      detail: "No complete causal chain starts at the trusted boundary.",
    };
  try {
    const events: SelectedWalletBehaviorEventValue[] = [];
    let current = new Decimal(boundary);
    for (const index of chains[0]!) {
      const edge = edges[index]!;
      const after = new Decimal(edge.after);
      events.push(...eventsForTransition(edge.fill, current, after));
      current = after;
    }
    return {
      ok: true,
      afterPosition: canonicalDecimal(current.toFixed()),
      events,
      orderedSourceEventIds: chains[0]!.map((index) => edges[index]!.fill.sourceEventId),
    };
  } catch (error) {
    return {
      ok: false,
      reason: "IMPOSSIBLE_TRANSITION",
      detail: error instanceof Error ? error.message : "Impossible transition.",
    };
  }
}
