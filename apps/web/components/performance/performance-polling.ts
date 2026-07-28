import { type PerformanceCalculationStatus } from "../../lib/performance-api";

export const PERFORMANCE_POLL_INTERVAL_MS = 2_000;
export const PERFORMANCE_POLL_MAX_ATTEMPTS = 30;

export function shouldPollPerformance(
  status: PerformanceCalculationStatus | null,
  queuedLocally: boolean,
  attempt: number,
): boolean {
  return (
    attempt < PERFORMANCE_POLL_MAX_ATTEMPTS &&
    (queuedLocally || status === "PENDING" || status === "RUNNING")
  );
}

export function isPerformanceActionDisabled(
  status: PerformanceCalculationStatus | null,
  submitting: boolean,
  queuedLocally: boolean,
): boolean {
  return submitting || queuedLocally || status === "PENDING" || status === "RUNNING";
}

export function isCurrentPerformanceAddress(
  requestedAddress: string,
  currentAddress: string,
): boolean {
  return requestedAddress === currentAddress;
}
