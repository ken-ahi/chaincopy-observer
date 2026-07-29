import { apiRequest } from "./address-api";

export type PerformancePrecision = "EXACT" | "DERIVED" | "ESTIMATED" | "UNAVAILABLE";

export type PerformanceHistoryCompleteness =
  "COMPLETE" | "PARTIAL" | "TRUNCATED" | "GAP_DETECTED" | "INSUFFICIENT_HISTORY";

export type PerformanceCalculationStatus =
  "PENDING" | "RUNNING" | "SUCCEEDED" | "INSUFFICIENT_DATA" | "FAILED";

export type PerformanceMetricStatus = "AVAILABLE" | "REFERENCE_ONLY";
export type PositionCycleStatus = "OPEN" | "CLOSED";
export type MetricAvailabilityStatus = "AVAILABLE" | "PARTIAL" | "UNAVAILABLE";

export interface MetricGroupAvailabilityDto {
  readonly from: string | null;
  readonly reasons: ReadonlyArray<string>;
  readonly status: MetricAvailabilityStatus;
  readonly to: string | null;
}

export interface PerformanceAvailabilityDto {
  readonly exposure: MetricGroupAvailabilityDto;
  readonly return: MetricGroupAvailabilityDto;
  readonly trade: MetricGroupAvailabilityDto;
}

export interface TradePrefixDto {
  readonly coin: string;
  readonly skippedFillCount: number;
  readonly skippedFrom: string;
  readonly trustedFrom: string | null;
}

export interface PerformanceCalculationDetailsDto {
  readonly excludedFillCount: number;
  readonly excludedFundingCount: number;
  readonly navGapCount: number;
  readonly tradePrefixes: ReadonlyArray<TradePrefixDto>;
  readonly trustedClosedCycleCount: number;
  readonly unknownCashFlowCount: number;
}

export interface CalculationRunDto {
  readonly runId: string;
  readonly status: PerformanceCalculationStatus;
  readonly calculationVersion: string;
  readonly calculationFrom: string;
  readonly calculationTo: string;
  readonly requestedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly historyCompleteness: PerformanceHistoryCompleteness;
  readonly precision: PerformancePrecision | null;
  readonly warningCount: number;
  readonly warningCodes: ReadonlyArray<string>;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly inputFingerprint: string;
  readonly inputFingerprintShort: string;
}

export interface PerformanceMetricDto {
  readonly metricKey: string;
  readonly metricValue: string;
  readonly precision: PerformancePrecision;
  readonly status: PerformanceMetricStatus;
  readonly warningCodes: ReadonlyArray<string>;
  readonly calculationFrom: string;
  readonly calculationTo: string;
  readonly metricVersion: string;
}

export interface AddressPerformanceDto {
  readonly availability: PerformanceAvailabilityDto;
  readonly calculationDetails: PerformanceCalculationDetailsDto;
  readonly walletAddress: string;
  readonly latestRun: CalculationRunDto | null;
  readonly latestSuccessfulRun: CalculationRunDto | null;
  readonly latestFailedRun: CalculationRunDto | null;
  readonly metrics: Readonly<Record<string, PerformanceMetricDto>>;
  readonly navSummary: {
    readonly count: number;
    readonly firstDate: string | null;
    readonly lastDate: string | null;
    readonly firstNav: string | null;
    readonly lastNav: string | null;
    readonly minNav: string | null;
    readonly maxNav: string | null;
  };
  readonly cycleSummary: {
    readonly total: number;
    readonly open: number;
    readonly closed: number;
    readonly profitable: number;
    readonly losing: number;
  };
}

export interface DailyNavDto {
  readonly id: string;
  readonly runId: string;
  readonly date: string;
  readonly nav: string;
  readonly cashBalance: string | null;
  readonly unrealizedPnl: string | null;
  readonly realizedPnl: string | null;
  readonly funding: string | null;
  readonly fees: string | null;
  readonly externalCashFlow: string | null;
  readonly precision: PerformancePrecision;
  readonly historyCompleteness: PerformanceHistoryCompleteness;
}

export interface PositionCycleDto {
  readonly id: string;
  readonly runId: string;
  readonly coin: string;
  readonly side: string;
  readonly openedAt: string;
  readonly closedAt: string | null;
  readonly averageEntryPrice: string;
  readonly averageExitPrice: string | null;
  readonly entryQuantity: string;
  readonly exitQuantity: string;
  readonly grossRealizedPnl: string;
  readonly fees: string;
  readonly funding: string;
  readonly netRealizedPnl: string;
  readonly fillCount: number;
  readonly status: PositionCycleStatus;
  readonly inputFingerprint: string;
}

export interface PaginatedPerformanceRunsDto {
  readonly items: ReadonlyArray<CalculationRunDto>;
  readonly nextCursor: string | null;
}

export interface PaginatedDailyNavDto {
  readonly items: ReadonlyArray<DailyNavDto>;
  readonly nextCursor: string | null;
}

export interface PaginatedPositionCyclesDto {
  readonly items: ReadonlyArray<PositionCycleDto>;
  readonly nextCursor: string | null;
}

export interface PerformancePageOptions {
  readonly cursor?: string;
  readonly limit?: number;
}

export interface PerformanceRunPageOptions extends PerformancePageOptions {
  readonly runId?: string;
}

export interface PerformanceCalculationRequestDto {
  readonly jobId: string;
  readonly status: "QUEUED";
  readonly force: boolean;
  readonly walletAddress: string;
  readonly calculationVersion: string;
}

export function getAddressPerformance(address: string): Promise<AddressPerformanceDto> {
  return apiRequest(`/api/addresses/${encodeURIComponent(address)}/performance`);
}

export function getAddressPerformanceRuns(
  address: string,
  options: PerformancePageOptions = {},
): Promise<PaginatedPerformanceRunsDto> {
  return apiRequest(
    withQuery(`/api/addresses/${encodeURIComponent(address)}/performance/runs`, options),
  );
}

export function getAddressPerformanceRun(
  address: string,
  runId: string,
): Promise<CalculationRunDto> {
  return apiRequest(
    `/api/addresses/${encodeURIComponent(address)}/performance/runs/${encodeURIComponent(runId)}`,
  );
}

export function getAddressPerformanceNav(
  address: string,
  options: PerformanceRunPageOptions = {},
): Promise<PaginatedDailyNavDto> {
  return apiRequest(
    withQuery(`/api/addresses/${encodeURIComponent(address)}/performance/nav`, options),
  );
}

export function getAddressPerformanceCycles(
  address: string,
  options: PerformanceRunPageOptions = {},
): Promise<PaginatedPositionCyclesDto> {
  return apiRequest(
    withQuery(`/api/addresses/${encodeURIComponent(address)}/performance/cycles`, options),
  );
}

export function calculateAddressPerformance(
  address: string,
): Promise<PerformanceCalculationRequestDto> {
  return apiRequest(`/api/addresses/${encodeURIComponent(address)}/performance/calculate`, {
    method: "POST",
  });
}

export function recalculateAddressPerformance(
  address: string,
): Promise<PerformanceCalculationRequestDto> {
  return apiRequest(`/api/addresses/${encodeURIComponent(address)}/performance/recalculate`, {
    method: "POST",
  });
}

function withQuery(
  path: string,
  options: PerformancePageOptions | PerformanceRunPageOptions,
): string {
  const query = new URLSearchParams();
  if ("runId" in options && options.runId !== undefined) {
    query.set("runId", options.runId);
  }
  if (options.cursor !== undefined) {
    query.set("cursor", options.cursor);
  }
  if (options.limit !== undefined) {
    query.set("limit", String(options.limit));
  }
  const queryString = query.toString();
  return queryString ? `${path}?${queryString}` : path;
}
