export const systemJobNames = {
  sampleHealthCheck: "sample.health-check",
} as const;

export type SystemJobName = (typeof systemJobNames)[keyof typeof systemJobNames];

export const hyperliquidQueueName = "hyperliquid-sync";
export const hyperliquidDiscoveryQueueName = "hyperliquid-discovery";
export const hyperliquidCandidateQueueName = "hyperliquid-candidate-enrichment";
export const performanceQueueName = "address-performance";
export const performanceCalculationVersion = "performance-v3";

export const hyperliquidJobNames = {
  walletBackfill: "hyperliquid-wallet-backfill",
  fillSync: "hyperliquid-fill-sync",
  fundingSync: "hyperliquid-funding-sync",
  ledgerSync: "hyperliquid-ledger-sync",
  positionSnapshot: "hyperliquid-position-snapshot",
  currentStateSnapshot: "hyperliquid-current-state-snapshot",
  portfolioSnapshot: "hyperliquid-portfolio-snapshot",
  historicalOrdersSync: "hyperliquid-historical-orders-sync",
  websocketListener: "hyperliquid-websocket-listener",
  gapRecovery: "hyperliquid-gap-recovery",
  dataQualityAudit: "hyperliquid-data-quality-audit",
} as const;

export type HyperliquidJobName = (typeof hyperliquidJobNames)[keyof typeof hyperliquidJobNames];

export interface HyperliquidJobData {
  readonly requestedAt: string;
  readonly walletAddress: string;
  readonly walletAddressId: string;
  readonly startTime?: string;
  readonly endTime?: string;
}

export const hyperliquidDiscoveryJobNames = {
  marketTradeDiscovery: "hyperliquid-market-trade-discovery",
  candidateUpsert: "hyperliquid-candidate-upsert",
  candidateEnrichment: "hyperliquid-candidate-enrichment",
  candidateFilter: "hyperliquid-candidate-filter",
  candidateQualityAudit: "hyperliquid-candidate-quality-audit",
  candidatePromotion: "hyperliquid-candidate-promotion",
} as const;

export type HyperliquidDiscoveryJobName =
  (typeof hyperliquidDiscoveryJobNames)[keyof typeof hyperliquidDiscoveryJobNames];

export interface DiscoveryMarketTradeData {
  readonly buyerAddress: string;
  readonly coin: string;
  readonly externalTradeId: string;
  readonly fingerprint: string;
  readonly notionalUsd: string;
  readonly occurredAt: string;
  readonly price: string;
  readonly rawPayload: string;
  readonly sellerAddress: string;
  readonly side: "BUY" | "SELL";
  readonly size: string;
  readonly tradeId: string;
  readonly transactionHash: string;
}

export interface DiscoveryControlJobData {
  readonly requestedAt: string;
  readonly kind: "control";
}

export interface DiscoveryTradeJobData {
  readonly requestedAt: string;
  readonly kind: "trade";
  readonly trade: DiscoveryMarketTradeData;
}

export interface DiscoveryCandidateJobData {
  readonly requestedAt: string;
  readonly kind: "candidate";
  readonly address: string;
  readonly candidateId: string;
  readonly requestedFrom?: string;
  readonly requestedTo?: string;
  readonly automatic?: boolean;
}

export type HyperliquidDiscoveryJobData =
  DiscoveryControlJobData | DiscoveryTradeJobData | DiscoveryCandidateJobData;

export const hyperliquidJobPriorities = {
  monitoredSync: 1,
  gapRecovery: 2,
  manualSync: 3,
  discoveryControl: 5,
  candidateUpsert: 6,
  candidateEnrichment: 10,
  addressPerformance: 15,
  candidateRecheck: 20,
} as const;

export const performanceJobNames = {
  calculate: "calculate-address-performance",
  recalculate: "recalculate-address-performance",
} as const;

export type PerformanceJobName = (typeof performanceJobNames)[keyof typeof performanceJobNames];

export interface PerformanceJobData {
  readonly calculationFrom: string;
  readonly calculationTo: string;
  readonly calculationVersion: string;
  readonly force: boolean;
  readonly requestedAt: string;
  readonly requestedBy: string;
  readonly walletAddressId: string;
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

export type ComponentStatus = "up" | "down";

export interface HealthComponent {
  readonly latencyMs: number;
  readonly status: ComponentStatus;
}

export interface ServiceHealth {
  readonly checkedAt: string;
  readonly components: Readonly<Record<string, HealthComponent>>;
  readonly service: string;
  readonly status: "healthy" | "unhealthy";
}
import { createHash } from "node:crypto";
