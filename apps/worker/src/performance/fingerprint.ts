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
  const hash = createHash("sha256");
  hash.update('{"accountSnapshots":');
  updateArray(hash, sortedObjects(value.input.accountSnapshots));
  updateProperty(hash, "calculationFrom", value.calculationFrom);
  updateProperty(hash, "calculationTo", value.calculationTo);
  updateProperty(hash, "calculationVersion", value.calculationVersion);
  hash.update(',"cashFlows":');
  updateArray(hash, sortedObjects(value.input.cashFlows));
  hash.update(',"fills":');
  updateArray(hash, sortedObjects(value.input.fills));
  hash.update(',"funding":');
  updateArray(hash, sortedObjects(value.input.funding));
  updateProperty(hash, "historyCompleteness", value.historyCompleteness);
  hash.update(',"navSnapshots":');
  updateArray(hash, sortedObjects(value.input.navSnapshots));
  hash.update(',"positionSnapshots":');
  updateArray(hash, sortedObjects(value.input.positionSnapshots));
  updateProperty(hash, "walletAddress", value.input.walletAddress.toLowerCase());
  return hash.update("}").digest("hex");
}

function updateArray(hash: ReturnType<typeof createHash>, values: readonly object[]): void {
  hash.update("[");
  for (let index = 0; index < values.length; index += 1) {
    if (index > 0) hash.update(",");
    hash.update(JSON.stringify(values[index]));
  }
  hash.update("]");
}

function updateProperty(hash: ReturnType<typeof createHash>, name: string, value: string): void {
  hash.update(`,${JSON.stringify(name)}:${JSON.stringify(value)}`);
}

function sortedObjects<T extends { readonly externalId: string }>(
  values: readonly T[],
): readonly T[] {
  return [...values].sort((left, right) => left.externalId.localeCompare(right.externalId));
}
