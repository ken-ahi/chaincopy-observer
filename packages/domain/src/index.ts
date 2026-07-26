export const systemJobNames = {
  sampleHealthCheck: "sample.health-check",
} as const;

export type SystemJobName = (typeof systemJobNames)[keyof typeof systemJobNames];

export const hyperliquidQueueName = "hyperliquid-sync";

export const hyperliquidJobNames = {
  walletBackfill: "hyperliquid-wallet-backfill",
  fillSync: "hyperliquid-fill-sync",
  fundingSync: "hyperliquid-funding-sync",
  ledgerSync: "hyperliquid-ledger-sync",
  positionSnapshot: "hyperliquid-position-snapshot",
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
