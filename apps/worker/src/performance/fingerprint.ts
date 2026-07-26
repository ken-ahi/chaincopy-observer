import { createHash } from "node:crypto";

import type { DataCompleteness } from "@chaincopy/analytics";

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
    calculationFrom: value.calculationFrom,
    calculationTo: value.calculationTo,
    calculationVersion: value.calculationVersion,
    cashFlowIds: sorted(value.input.cashFlows.map((item) => item.externalId)),
    fillIds: sorted(value.input.fills.map((item) => item.externalId)),
    fundingIds: sorted(value.input.funding.map((item) => item.externalId)),
    historyCompleteness: value.historyCompleteness,
    navSnapshotIds: sorted(value.input.navSnapshots.map((item) => item.externalId)),
    positionSnapshotIds: sorted(value.input.positionSnapshots.map((item) => item.externalId)),
    walletAddress: value.input.walletAddress.toLowerCase(),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

export function createPerformanceJobFingerprint(parts: {
  readonly calculationFrom: string;
  readonly calculationTo: string;
  readonly calculationVersion: string;
  readonly requestedAt?: string;
  readonly walletAddressId: string;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        calculationFrom: parts.calculationFrom,
        calculationTo: parts.calculationTo,
        calculationVersion: parts.calculationVersion,
        requestedAt: parts.requestedAt ?? null,
        walletAddressId: parts.walletAddressId,
      }),
    )
    .digest("hex");
}

function sorted(values: readonly string[]): readonly string[] {
  return [...values].sort();
}
