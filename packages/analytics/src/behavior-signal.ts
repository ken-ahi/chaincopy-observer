import { isDeepStrictEqual } from "node:util";
import { Decimal } from "decimal.js";
import { aggregateBehaviorBucket, aggregationHash } from "./behavior-aggregation.js";
import { calculateWalletWeights } from "./wallet-weight.js";

export const SIGNAL_VERSION = "signal-v1";
export const SIGNAL_POLICY = {
  version: SIGNAL_VERSION,
  contribution: "UNIQUE_WALLET_DIRECTION_SET",
  mixedShare: "0.5",
  breadthAnchor: "2",
  precision: 80,
  confidenceScale: 18,
  rounding: "HALF_EVEN",
  notionalInfluence: "NONE",
} as const;
const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_EVEN });
type Aggregate = ReturnType<typeof aggregateBehaviorBucket>;
type Weight = ReturnType<typeof calculateWalletWeights>;
export class SignalInputError extends Error {}
const fail = (reason: string): never => {
  throw new SignalInputError(reason);
};

export function calculateBehaviorSignal(aggregation: Aggregate, weight: Weight) {
  // Reconstruct canonical receipts; never trust totals or weights supplied alone.
  const checked = aggregateBehaviorBucket(aggregation.snapshot);
  if (!isDeepStrictEqual(checked, aggregation)) fail("AGGREGATION_RECEIPT_MISMATCH");
  if (aggregation.status === "BLOCKED") fail("AGGREGATION_BLOCKED");
  const checkedWeight = calculateWalletWeights(weight.inputSnapshot.members);
  if (!isDeepStrictEqual(checkedWeight, weight)) fail("WEIGHT_RECEIPT_MISMATCH");
  if (
    aggregation.selectionRunId !== weight.selectionRunId ||
    aggregation.scopeFingerprint !== weight.cohortFingerprint
  )
    fail("COHORT_MISMATCH");
  const revisionId = aggregationHash([aggregation.bucketId, aggregation.inputFingerprint]);
  const contributions = weight.entries.map((entry) => {
    const events = aggregation.snapshot.events.filter(
      (e) => e.walletAddressId === entry.walletAddressId,
    );
    const buy = events.filter(
      (e) =>
        (e.direction === "LONG") === ["POSITION_OPEN", "POSITION_INCREASE"].includes(e.eventType),
    );
    const sell = events.filter((e) => !buy.includes(e));
    const buyShare = buy.length ? (sell.length ? "0.5" : "1") : "0";
    const sellShare = sell.length ? (buy.length ? "0.5" : "1") : "0";
    return {
      walletAddressId: entry.walletAddressId,
      performanceRunId: entry.performanceRunId,
      normalizedWeight: entry.normalizedWeight,
      buyShare,
      sellShare,
      buyContribution: new D(entry.normalizedWeight).times(buyShare).toFixed(),
      sellContribution: new D(entry.normalizedWeight).times(sellShare).toFixed(),
      buyEventCount: buy.length,
      sellEventCount: sell.length,
      buyNotionalUsd: buy.reduce((s, e) => s.plus(e.notionalDeltaUsd), new D(0)).toFixed(),
      sellNotionalUsd: sell.reduce((s, e) => s.plus(e.notionalDeltaUsd), new D(0)).toFixed(),
    };
  });
  const participants = contributions.filter((c) => c.buyEventCount + c.sellEventCount > 0);
  const buy = contributions.reduce((s, c) => s.plus(c.buyContribution), new D(0));
  const sell = contributions.reduce((s, c) => s.plus(c.sellContribution), new D(0));
  const mass = buy.plus(sell);
  const agreement = mass.isZero() ? new D(0) : D.max(buy, sell).div(mass);
  const breadth = new D(participants.length).div(
    new D(participants.length).plus(SIGNAL_POLICY.breadthAnchor),
  );
  const inputSnapshot = {
    policy: SIGNAL_POLICY,
    aggregationRevisionId: revisionId,
    aggregationInputFingerprint: aggregation.inputFingerprint,
    aggregationVersion: aggregation.snapshot.aggregationVersion,
    behaviorVersion: aggregation.snapshot.behaviorVersion,
    weightSnapshotId: weight.id,
    weightVersion: weight.weightVersion,
    weightInputFingerprint: weight.inputFingerprint,
    selectionRunId: weight.selectionRunId,
    cohortFingerprint: weight.cohortFingerprint,
    coin: aggregation.snapshot.coin,
    bucketStart: aggregation.bucketStart,
    bucketEnd: aggregation.bucketEnd,
  };
  const inputFingerprint = aggregationHash(inputSnapshot);
  return {
    id: inputFingerprint,
    inputFingerprint,
    inputSnapshot,
    ...inputSnapshot,
    signalVersion: SIGNAL_VERSION,
    status: mass.isZero() ? ("NO_SIGNAL" as const) : ("VALID" as const),
    buyStrength: buy.toFixed(),
    sellStrength: sell.toFixed(),
    netSignal: buy.minus(sell).toFixed(),
    participatingWalletCount: participants.length,
    weightedParticipatingWalletCount: mass.toFixed(),
    buyOnlyWalletCount: participants.filter((c) => c.buyShare === "1").length,
    sellOnlyWalletCount: participants.filter((c) => c.sellShare === "1").length,
    mixedWalletCount: participants.filter((c) => c.buyShare === "0.5").length,
    agreement: agreement.toDecimalPlaces(18).toFixed(),
    breadth: breadth.toDecimalPlaces(18).toFixed(),
    confidence: mass.times(agreement).times(breadth).toDecimalPlaces(18).toFixed(),
    contributions,
  };
}
