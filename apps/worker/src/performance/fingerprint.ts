import { createHash } from "node:crypto";

import type { DataCompleteness } from "@chaincopy/analytics";
export { createPerformanceJobFingerprint } from "@chaincopy/domain";

import type { PerformanceCalculationInput } from "./types.js";

export interface PerformanceFingerprintInput {
  readonly calculationFrom: string;
  readonly calculationTo: string;
  readonly calculationVersion: string;
  readonly historyCompleteness: DataCompleteness;
  readonly input: PerformanceCalculationInput;
}

export function createPerformanceInputFingerprint(value: PerformanceFingerprintInput): string {
  const canonical = {
    accountSnapshots: sortedObjects(value.input.accountSnapshots),
    calculationFrom: value.calculationFrom,
    calculationTo: value.calculationTo,
    calculationVersion: value.calculationVersion,
    cashFlows: sortedObjects(value.input.cashFlows),
    fills: sortedObjects(value.input.fills),
    funding: sortedObjects(value.input.funding),
    historyCompleteness: value.historyCompleteness,
    navSnapshots: sortedObjects(value.input.navSnapshots),
    positionSnapshots: sortedObjects(value.input.positionSnapshots),
    walletAddress: value.input.walletAddress.toLowerCase(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function sortedObjects<T extends { readonly externalId: string }>(
  values: readonly T[],
): readonly T[] {
  return [...values].sort((left, right) => left.externalId.localeCompare(right.externalId));
}
