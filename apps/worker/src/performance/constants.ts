import { performanceCalculationVersion } from "@chaincopy/domain";

export const PERFORMANCE_CALCULATION_VERSION = performanceCalculationVersion;

export const performanceRetryPolicy = {
  attempts: 3,
  backoffDelayMs: 5_000,
} as const;
