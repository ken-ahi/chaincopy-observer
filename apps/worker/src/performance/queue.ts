import {
  hyperliquidJobPriorities,
  createPerformanceJobFingerprint,
  performanceJobNames,
  type PerformanceJobData,
  type PerformanceJobName,
} from "@chaincopy/domain";
import { type JobsOptions, type Queue } from "bullmq";

import { PERFORMANCE_CALCULATION_VERSION, performanceRetryPolicy } from "./constants.js";

export const performanceJobOptions: JobsOptions = {
  attempts: performanceRetryPolicy.attempts,
  backoff: {
    delay: performanceRetryPolicy.backoffDelayMs,
    type: "exponential",
  },
  priority: hyperliquidJobPriorities.addressPerformance,
  removeOnComplete: {
    age: 24 * 60 * 60,
    count: 1_000,
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60,
    count: 2_000,
  },
};

export async function enqueuePerformanceJob(
  queue: Queue<PerformanceJobData>,
  data: PerformanceJobData,
): Promise<string> {
  validateData(data);
  const name: PerformanceJobName = data.force
    ? performanceJobNames.recalculate
    : performanceJobNames.calculate;
  const fingerprint = createPerformanceJobFingerprint({
    calculationFrom: data.calculationFrom,
    calculationTo: data.calculationTo,
    calculationVersion: data.calculationVersion,
    walletAddressId: data.walletAddressId,
    ...(data.force ? { requestedAt: data.requestedAt } : {}),
  });
  const jobId = `${name}-${fingerprint}`;
  const job = await queue.add(name, data, {
    ...performanceJobOptions,
    jobId,
  });
  return job.id ?? jobId;
}

function validateData(data: PerformanceJobData): void {
  const from = new Date(data.calculationFrom).getTime();
  const to = new Date(data.calculationTo).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    throw new RangeError("Performance job requires a valid ordered time range.");
  }
  if (!Number.isFinite(new Date(data.requestedAt).getTime())) {
    throw new RangeError("Performance job requestedAt must be valid.");
  }
  if (data.calculationVersion !== PERFORMANCE_CALCULATION_VERSION) {
    throw new RangeError(`Unsupported calculation version ${data.calculationVersion}.`);
  }
}
