export interface Page<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor: string | null;
}

export type SyncStatus = "IDLE" | "RUNNING" | "SUCCEEDED" | "FAILED" | "GAP_DETECTED";

export interface AddressSummary {
  readonly address: string;
  readonly displayName: string | null;
  readonly isWatched: boolean;
  readonly lastSyncAt: string | null;
  readonly syncStatus: SyncStatus | null;
  readonly fillCount: number;
  readonly fundingCount: number;
  readonly ledgerCount: number;
  readonly currentPositionCount: number;
  readonly openDataQualityIssues: number;
  readonly lastSuccessfulAt: string | null;
  readonly lastError: string | null;
}

export interface AddressDetail {
  readonly address: AddressSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly spotBalances: ReadonlyArray<{
    readonly coin: string;
    readonly total: string;
    readonly hold: string;
    readonly entryNotional: string;
    readonly capturedAt: string;
  }>;
  readonly portfolioSnapshots: ReadonlyArray<{
    readonly id: string;
    readonly snapshotType: string;
    readonly accountValue: string | null;
    readonly totalNotionalPosition: string | null;
    readonly totalMarginUsed: string | null;
    readonly withdrawable: string | null;
    readonly capturedAt: string;
  }>;
}

export interface CreateAddressResult {
  readonly address: AddressSummary;
  readonly syncJob: {
    readonly jobId: string;
    readonly status: "QUEUED";
  } | null;
}

export interface SyncStatusDetail {
  readonly address: string;
  readonly cursors: ReadonlyArray<{
    readonly cursorType: string;
    readonly scope: string;
    readonly status: SyncStatus;
    readonly lastTimestamp: string | null;
    readonly lastExternalId: string | null;
    readonly lastSuccessfulAt: string | null;
    readonly lastAttemptedAt: string | null;
    readonly errorMessage: string | null;
  }>;
  readonly jobs: ReadonlyArray<{
    readonly id: string;
    readonly jobName: string;
    readonly status: string;
    readonly attempt: number;
    readonly createdAt: string;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    readonly errorMessage: string | null;
  }>;
}

export interface Fill {
  readonly id: string;
  readonly coin: string;
  readonly side: string;
  readonly direction: string;
  readonly price: string;
  readonly size: string;
  readonly fee: string;
  readonly closedPnl: string;
  readonly occurredAt: string;
  readonly transactionHash: string;
}

export interface Funding {
  readonly id: string;
  readonly coin: string;
  readonly amount: string;
  readonly positionSize: string;
  readonly fundingRate: string;
  readonly occurredAt: string;
}

export interface Ledger {
  readonly id: string;
  readonly flowType: string;
  readonly asset: string | null;
  readonly amount: string | null;
  readonly usdValue: string | null;
  readonly fee: string | null;
  readonly occurredAt: string;
}

export interface Position {
  readonly id: string;
  readonly coin: string;
  readonly side: string;
  readonly size: string;
  readonly entryPrice: string | null;
  readonly positionValue: string;
  readonly unrealizedPnl: string;
  readonly leverageType: string;
  readonly leverageValue: string;
  readonly liquidationPrice: string | null;
  readonly updatedExternalAt: string;
}

export interface Order {
  readonly id: string;
  readonly coin: string;
  readonly side: string;
  readonly status: string;
  readonly orderType: string;
  readonly limitPrice: string;
  readonly size: string;
  readonly statusTimestamp: string;
}

export interface DataQualityIssue {
  readonly id: string;
  readonly issueType: string;
  readonly severity: string;
  readonly status: string;
  readonly message: string;
  readonly details: unknown;
  readonly firstDetectedAt: string;
  readonly lastDetectedAt: string;
  readonly resolvedAt: string | null;
}

export class ApiRequestError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

export async function apiRequest<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, {
    cache: "no-store",
    ...init,
    headers: {
      accept: "application/json",
      ...(init?.body ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error =
      typeof payload === "object" && payload !== null
        ? (payload as { error?: unknown }).error
        : undefined;
    const message =
      typeof payload === "object" && payload !== null
        ? (payload as { message?: unknown }).message
        : undefined;
    throw new ApiRequestError(
      typeof error === "string" ? error : "request_failed",
      typeof message === "string" ? message : "API request failed.",
      response.status,
    );
  }
  return payload as T;
}
