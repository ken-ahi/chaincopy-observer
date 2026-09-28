import { createHash } from "node:crypto";
import { Decimal } from "decimal.js";
import { aggregationScope, type AggregationMember } from "./behavior-aggregation.js";

export const WALLET_WEIGHT_VERSION = "wallet-weight-v1";
export const WALLET_WEIGHT_POLICY = {
  version: WALLET_WEIGHT_VERSION,
  confidenceAnchor: "30",
  rawScale: 36,
  normalizedScale: 18,
  precision: 80,
  rounding: "HALF_EVEN",
  allocation: "LARGEST_REMAINDER_ADDRESS_ASC",
} as const;
const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_EVEN });
export const WEIGHT_METRICS = [
  "winRate",
  "profitFactor",
  "topTradeContribution",
  "averageWin",
  "averageLoss",
  "maxLosingStreak",
] as const;
export type WeightMetrics = Record<(typeof WEIGHT_METRICS)[number], string>;
export interface WalletWeightInput extends AggregationMember {
  performanceRunId: string;
  performanceInputFingerprint: string;
  trustRevision: number;
  metricFrom: string;
  metricTo: string;
  trustedClosedCycleCount: string;
  metrics: WeightMetrics;
}
export class WalletWeightInputError extends Error {}
const fail = (reason: string): never => {
  throw new WalletWeightInputError(reason);
};
export function walletWeightHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function decimal(value: string, key: string) {
  if (typeof value !== "string" || value.length > 60 || !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    return fail(`INVALID_DECIMAL:${key}`);
  const result = new D(value);
  if (!result.isFinite() || result.decimalPlaces() > 18 || result.abs().gte("1e20"))
    return fail(`INVALID_DECIMAL:${key}`);
  return result;
}

// Inputs are admitted ONLY by the Selection SSoT service, never by this formula.
export function calculateWalletWeights(input: readonly WalletWeightInput[]) {
  const cohort = aggregationScope(input);
  const canonical = input
    .map((row) => {
      if (
        !row.performanceInputFingerprint ||
        !Number.isSafeInteger(row.trustRevision) ||
        row.trustRevision < 0
      )
        return fail("INVALID_PERFORMANCE_PROVENANCE");
      for (const value of [row.metricFrom, row.metricTo])
        if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value)
          return fail("INVALID_METRIC_WINDOW");
      if (row.metricFrom > row.metricTo) return fail("INVALID_METRIC_WINDOW");
      const n = decimal(row.trustedClosedCycleCount, "trustedClosedCycleCount");
      if (!n.isInteger() || n.lte(0)) return fail("INVALID_CYCLE_COUNT");
      const metrics = Object.fromEntries(
        WEIGHT_METRICS.map((key) => [key, decimal(row.metrics[key], key).toFixed()]),
      ) as WeightMetrics;
      const w = new D(metrics.winRate),
        p = new D(metrics.profitFactor),
        c = new D(metrics.topTradeContribution);
      if (
        w.lt(0) ||
        w.gt(1) ||
        p.lt(0) ||
        c.lt(0) ||
        c.gt(1) ||
        new D(metrics.averageWin).lte(0) ||
        new D(metrics.averageLoss).gte(0) ||
        new D(metrics.maxLosingStreak).lt(0) ||
        !new D(metrics.maxLosingStreak).isInteger()
      )
        return fail("INVALID_METRIC_DOMAIN");
      return {
        walletAddressId: row.walletAddressId,
        address: row.address,
        selectionRunId: row.selectionRunId,
        performanceRunId: row.performanceRunId,
        performanceInputFingerprint: row.performanceInputFingerprint,
        trustRevision: row.trustRevision,
        metricFrom: row.metricFrom,
        metricTo: row.metricTo,
        trustedClosedCycleCount: n.toFixed(),
        metrics,
      };
    })
    .sort((a, b) => (a.address < b.address ? -1 : a.address > b.address ? 1 : 0));
  if (new Set(canonical.map((r) => r.address)).size !== canonical.length)
    return fail("DUPLICATE_ADDRESS");
  const inputSnapshot = {
    policy: WALLET_WEIGHT_POLICY,
    selectionRunId: cohort.selectionRunId,
    cohortFingerprint: cohort.fingerprint,
    members: canonical,
  };
  const inputFingerprint = walletWeightHash(inputSnapshot);
  const scored = canonical.map((row) => {
    const pfShare = new D(row.metrics.profitFactor).div(new D(row.metrics.profitFactor).plus(1));
    const quality = new D(row.metrics.winRate).plus(pfShare).div(2);
    const confidence = new D(row.trustedClosedCycleCount).div(
      new D(row.trustedClosedCycleCount).plus(WALLET_WEIGHT_POLICY.confidenceAnchor),
    );
    const concentration = new D(1).minus(row.metrics.topTradeContribution);
    const raw = quality.times(confidence).times(concentration).toDecimalPlaces(36);
    return {
      input: row,
      rawWeight: raw.toFixed(),
      components: {
        profitShare: pfShare.toFixed(),
        quality: quality.toFixed(),
        sampleConfidence: confidence.toFixed(),
        concentration: concentration.toFixed(),
      },
      rawUnits: raw.times("1e36"),
    };
  });
  const sum = scored.reduce((a, r) => a.plus(r.rawUnits), new D(0));
  if (sum.isZero()) return fail("ZERO_COHORT_WEIGHT");
  const scale = new D("1e18");
  const allocated = scored.map((row) => {
    const numerator = row.rawUnits.times(scale);
    return { ...row, units: numerator.divToInt(sum), remainder: numerator.mod(sum) };
  });
  const residual = scale.minus(allocated.reduce((a, r) => a.plus(r.units), new D(0))).toNumber(); // bounded integer allocation count, not a financial value
  const order = [...allocated].sort(
    (a, b) => b.remainder.cmp(a.remainder) || (a.input.address < b.input.address ? -1 : 1),
  );
  if (!Number.isSafeInteger(residual) || residual < 0 || residual >= allocated.length)
    return fail("INVALID_ALLOCATION");
  for (let i = 0; i < residual; i++) order[i]!.units = order[i]!.units.plus(1);
  const entries = allocated.map((row) => ({
    ...row.input,
    rawWeight: row.rawWeight,
    normalizedWeight: row.units.div(scale).toFixed(),
    components: row.components,
  }));
  if (!entries.reduce((a, r) => a.plus(r.normalizedWeight), new D(0)).eq(1))
    return fail("INVALID_WEIGHT_SUM");
  return {
    id: inputFingerprint,
    weightVersion: WALLET_WEIGHT_VERSION,
    selectionRunId: cohort.selectionRunId,
    cohortFingerprint: cohort.fingerprint,
    inputFingerprint,
    inputSnapshot,
    entries,
  };
}
