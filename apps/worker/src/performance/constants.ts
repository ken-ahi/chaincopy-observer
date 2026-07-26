export const PERFORMANCE_CALCULATION_VERSION = "performance-v1";

export const performanceRetryPolicy = {
  attempts: 3,
  backoffDelayMs: 5_000,
} as const;
