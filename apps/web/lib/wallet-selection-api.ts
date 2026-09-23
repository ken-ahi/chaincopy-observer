export type WalletSelectionStatus = "SELECTED" | "QUALIFIED" | "REVIEW" | "EXCLUDED";
export type WalletSelectionOverride = "AUTO" | "INCLUDE" | "EXCLUDE";

export interface WalletSelectionItem {
  readonly walletAddressId: string;
  readonly address: string;
  readonly automaticStatus: WalletSelectionStatus;
  readonly effectiveStatus: WalletSelectionStatus;
  readonly manualOverride: WalletSelectionOverride;
  readonly overrideNote: string | null;
  readonly rank: number | null;
  readonly reasonCodes: ReadonlyArray<string>;
  readonly performanceRunId: string | null;
  readonly lastSyncAt: string | null;
  readonly historyCompleteness: string | null;
  readonly trustedClosedCycleCount: number;
  readonly metrics: Readonly<Record<string, string>>;
}

export interface WalletSelectionResponse {
  readonly run: {
    readonly id: string;
    readonly policyVersion: string;
    readonly inputFingerprint: string;
    readonly evaluatedAt: string;
    readonly universeCount: number;
    readonly selectedCount: number;
    readonly qualifiedCount: number;
    readonly reviewCount: number;
    readonly excludedCount: number;
  } | null;
  readonly items: ReadonlyArray<WalletSelectionItem>;
}

export interface WalletRankingItem {
  readonly walletAddressId: string;
  readonly address: string;
  readonly automaticStatus: "SELECTED" | "QUALIFIED";
  readonly rank: number;
  readonly performanceRunId: string;
  readonly latestActivityAt: string;
  readonly lastSyncAt: string;
  readonly trustedClosedCycleCount: number;
  readonly metrics: Readonly<Record<string, string>>;
}

export interface WalletRankingResponse {
  readonly run: {
    readonly id: string;
    readonly policyVersion: string;
    readonly evaluatedAt: string;
    readonly eligibleCount: number;
    readonly selectedCount: number;
  } | null;
  readonly items: ReadonlyArray<WalletRankingItem>;
}

export interface WalletSelectionSettings {
  readonly policyVersion: "wallet-selection-v1";
  readonly maxAutoSelected: number;
  readonly minimumEvaluationDays: number;
  readonly minimumTrustedClosedCycles: number;
  readonly minimumAnnualizedReturn: string;
  readonly maximumDrawdown: string;
  readonly maximumTopTradeContribution: string;
  readonly maximumDataAgeHours: number;
  readonly updatedAt: string;
}
