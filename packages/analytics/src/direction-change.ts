import { Decimal } from "decimal.js";
import { aggregationHash, utcBucketStart } from "./behavior-aggregation.js";
import { type calculateBehaviorSignal } from "./behavior-signal.js";

export const DIRECTION_CHANGE_VERSION = "direction-change-v1";
export const DIRECTION_CHANGE_POLICY = {
  version: DIRECTION_CHANGE_VERSION,
  intervalMs: 900000,
  minimumDelta: "0",
  comparison: "STRICT_SAME_BASIS",
  zeroEntry: "NONE",
  zeroExit: "WEAKENING",
  confidenceGate: "NONE",
} as const;
export const DIRECTION_CHANGE_EVENTS = [
  "BUY_ACCELERATING",
  "BUY_WEAKENING",
  "SELL_ACCELERATING",
  "SELL_WEAKENING",
  "BULLISH_REVERSAL",
  "BEARISH_REVERSAL",
  "NONE",
] as const;
export type DirectionChangeEvent = (typeof DIRECTION_CHANGE_EVENTS)[number];
export type DirectionSignal = Pick<
  ReturnType<typeof calculateBehaviorSignal>,
  | "id"
  | "inputFingerprint"
  | "coin"
  | "bucketStart"
  | "bucketEnd"
  | "signalVersion"
  | "status"
  | "selectionRunId"
  | "cohortFingerprint"
  | "weightSnapshotId"
  | "weightInputFingerprint"
  | "weightVersion"
  | "aggregationRevisionId"
  | "aggregationInputFingerprint"
  | "aggregationVersion"
  | "behaviorVersion"
  | "buyStrength"
  | "sellStrength"
  | "netSignal"
  | "confidence"
  | "participatingWalletCount"
  | "weightedParticipatingWalletCount"
>;
export class DirectionChangeInputError extends Error {}
const fail = (reason: string): never => {
  throw new DirectionChangeInputError(reason);
};
const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_EVEN });
function decimal(value: string, signed = false, scale = 19) {
  if (typeof value !== "string" || !/^-?(0|[1-9]\d*)(\.\d+)?$/.test(value)) fail("INVALID_DECIMAL");
  const d = new D(value);
  if (
    !d.isFinite() ||
    d.toFixed() !== value ||
    d.decimalPlaces() > scale ||
    d.gt(1) ||
    d.lt(signed ? -1 : 0)
  )
    fail("INVALID_DECIMAL");
  return d;
}
// Projection has fixed key order: object insertion order from callers cannot affect identity.
export function directionSignalEvidence(s: DirectionSignal): DirectionSignal {
  return {
    id: s.id,
    inputFingerprint: s.inputFingerprint,
    coin: s.coin,
    bucketStart: s.bucketStart,
    bucketEnd: s.bucketEnd,
    signalVersion: s.signalVersion,
    status: s.status,
    selectionRunId: s.selectionRunId,
    cohortFingerprint: s.cohortFingerprint,
    weightSnapshotId: s.weightSnapshotId,
    weightInputFingerprint: s.weightInputFingerprint,
    weightVersion: s.weightVersion,
    aggregationRevisionId: s.aggregationRevisionId,
    aggregationInputFingerprint: s.aggregationInputFingerprint,
    aggregationVersion: s.aggregationVersion,
    behaviorVersion: s.behaviorVersion,
    buyStrength: s.buyStrength,
    sellStrength: s.sellStrength,
    netSignal: s.netSignal,
    confidence: s.confidence,
    participatingWalletCount: s.participatingWalletCount,
    weightedParticipatingWalletCount: s.weightedParticipatingWalletCount,
  };
}
function validate(s: DirectionSignal) {
  if (s.status !== "VALID") fail("SIGNAL_NOT_VALID");
  if (
    s.signalVersion !== "signal-v1" ||
    s.weightVersion !== "wallet-weight-v1" ||
    s.aggregationVersion !== "behavior-aggregation-v1" ||
    s.behaviorVersion !== "behavior-v1"
  )
    fail("UNSUPPORTED_VERSION");
  for (const field of [
    s.id,
    s.inputFingerprint,
    s.cohortFingerprint,
    s.weightSnapshotId,
    s.weightInputFingerprint,
    s.aggregationRevisionId,
    s.aggregationInputFingerprint,
  ])
    if (!/^[0-9a-f]{64}$/.test(field)) fail("INVALID_PROVENANCE");
  if (
    s.id !== s.inputFingerprint ||
    s.weightSnapshotId !== s.weightInputFingerprint ||
    !s.selectionRunId ||
    !s.coin ||
    s.coin.length > 100
  )
    fail("INVALID_PROVENANCE");
  if (
    utcBucketStart(s.bucketStart) !== s.bucketStart ||
    new Date(Date.parse(s.bucketStart) + 900000).toISOString() !== s.bucketEnd
  )
    fail("INVALID_BUCKET");
  const b = decimal(s.buyStrength),
    sell = decimal(s.sellStrength),
    net = decimal(s.netSignal, true),
    mass = decimal(s.weightedParticipatingWalletCount);
  decimal(s.confidence, false, 18);
  if (
    !b.minus(sell).eq(net) ||
    !b.plus(sell).eq(mass) ||
    mass.isZero() ||
    !Number.isSafeInteger(s.participatingWalletCount) ||
    s.participatingWalletCount < 1 ||
    s.participatingWalletCount > 200
  )
    fail("INCONSISTENT_SIGNAL");
}
export function calculateDirectionChange(previous: DirectionSignal, current: DirectionSignal) {
  validate(previous);
  validate(current);
  for (const key of [
    "coin",
    "signalVersion",
    "selectionRunId",
    "cohortFingerprint",
    "weightSnapshotId",
    "weightInputFingerprint",
    "weightVersion",
    "aggregationVersion",
    "behaviorVersion",
  ] as const)
    if (previous[key] !== current[key]) fail(`INCOMPATIBLE_${key}`);
  if (previous.bucketEnd !== current.bucketStart || previous.id === current.id)
    fail("NON_ADJACENT_BUCKETS");
  const a = new D(previous.netSignal),
    b = new D(current.netSignal);
  let eventType: DirectionChangeEvent = "NONE";
  let reason = "UNCHANGED_NET";
  if (a.lt(0) && b.gt(0)) eventType = "BULLISH_REVERSAL";
  else if (a.gt(0) && b.lt(0)) eventType = "BEARISH_REVERSAL";
  else if (a.gt(0) && b.gt(a)) eventType = "BUY_ACCELERATING";
  else if (a.gt(0) && b.lt(a)) eventType = "BUY_WEAKENING";
  else if (a.lt(0) && b.lt(a)) eventType = "SELL_ACCELERATING";
  else if (a.lt(0) && b.gt(a)) eventType = "SELL_WEAKENING";
  else if (a.isZero() && !b.isZero())
    reason = b.gt(0) ? "DIRECTION_EMERGED_BUY" : "DIRECTION_EMERGED_SELL";
  if (eventType !== "NONE") reason = "EXACT_NET_TRANSITION";
  const inputSnapshot = {
    policy: DIRECTION_CHANGE_POLICY,
    previous: directionSignalEvidence(previous),
    current: directionSignalEvidence(current),
  };
  const id = aggregationHash(inputSnapshot);
  return {
    id,
    inputFingerprint: id,
    inputSnapshot,
    directionChangeVersion: DIRECTION_CHANGE_VERSION,
    signalVersion: current.signalVersion,
    coin: current.coin,
    previousSignalId: previous.id,
    currentSignalId: current.id,
    previousBucket: previous.bucketStart,
    currentBucket: current.bucketStart,
    previousNetSignal: previous.netSignal,
    currentNetSignal: current.netSignal,
    delta: b.minus(a).toFixed(),
    eventType,
    reason,
    selectionRunId: current.selectionRunId,
    cohortFingerprint: current.cohortFingerprint,
    weightSnapshotId: current.weightSnapshotId,
    confidence: {
      previous: previous.confidence,
      current: current.confidence,
      delta: new D(current.confidence).minus(previous.confidence).toFixed(),
      meaning: "EVIDENCE_BREADTH_NOT_PROBABILITY",
      previousParticipants: previous.participatingWalletCount,
      currentParticipants: current.participatingWalletCount,
      previousWeightMass: previous.weightedParticipatingWalletCount,
      currentWeightMass: current.weightedParticipatingWalletCount,
    },
  };
}
