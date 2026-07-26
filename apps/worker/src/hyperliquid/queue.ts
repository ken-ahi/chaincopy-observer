import {
  hyperliquidJobNames,
  hyperliquidJobPriorities,
  type HyperliquidJobData,
  type HyperliquidJobName,
} from "@chaincopy/domain";
import { type JobsOptions, type Queue } from "bullmq";

export const hyperliquidJobOptions: JobsOptions = {
  attempts: 5,
  backoff: {
    delay: 1_000,
    type: "exponential",
  },
  removeOnComplete: {
    age: 24 * 60 * 60,
    count: 2_000,
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60,
    count: 5_000,
  },
};

export async function enqueueHyperliquidJob(
  queue: Queue<HyperliquidJobData>,
  name: HyperliquidJobName,
  data: HyperliquidJobData,
  bucketMs = 60_000,
  idSuffix?: string,
): Promise<string> {
  const requestedAt = new Date(data.requestedAt).getTime();
  if (!Number.isFinite(requestedAt)) {
    throw new RangeError("Hyperliquid job requestedAt must be a valid date-time.");
  }
  if (!Number.isSafeInteger(bucketMs) || bucketMs <= 0) {
    throw new RangeError("Hyperliquid job bucketMs must be a positive safe integer.");
  }
  const bucket = Math.floor(requestedAt / bucketMs);
  const jobId = [name, data.walletAddressId, String(bucket), ...(idSuffix ? [idSuffix] : [])].join(
    "-",
  );
  const job = await queue.add(name, data, {
    ...hyperliquidJobOptions,
    jobId,
    priority:
      name === hyperliquidJobNames.gapRecovery
        ? hyperliquidJobPriorities.gapRecovery
        : name === hyperliquidJobNames.walletBackfill
          ? hyperliquidJobPriorities.manualSync
          : hyperliquidJobPriorities.monitoredSync,
  });
  return job.id ?? jobId;
}

export async function enqueueHyperliquidGapRecovery(
  queue: Queue<HyperliquidJobData>,
  data: HyperliquidJobData,
): Promise<string> {
  if (!data.startTime || !data.endTime) {
    throw new RangeError("Hyperliquid gap recovery requires startTime and endTime.");
  }
  const startTime = new Date(data.startTime).getTime();
  const endTime = new Date(data.endTime).getTime();
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    throw new RangeError("Hyperliquid gap recovery requires a valid ordered time range.");
  }
  return enqueueHyperliquidJob(
    queue,
    hyperliquidJobNames.gapRecovery,
    data,
    1,
    `gap-${startTime}-${endTime}`,
  );
}

export async function enqueueWalletBackfillChildren(
  queue: Queue<HyperliquidJobData>,
  data: HyperliquidJobData,
  parentJobId: string,
): Promise<ReadonlyArray<string>> {
  return Promise.all(
    [
      hyperliquidJobNames.fillSync,
      hyperliquidJobNames.fundingSync,
      hyperliquidJobNames.ledgerSync,
      hyperliquidJobNames.positionSnapshot,
      hyperliquidJobNames.dataQualityAudit,
      hyperliquidJobNames.websocketListener,
    ].map((name) => enqueueHyperliquidJob(queue, name, data, 60_000, parentJobId)),
  );
}
