import { createHash } from "node:crypto";

import {
  behaviorJobNames,
  hyperliquidJobPriorities,
  type BehaviorJobData,
} from "@chaincopy/domain";
import { type Queue } from "bullmq";

export const BEHAVIOR_BACKLOG_LIMIT = 1_000;

export async function enqueueBehaviorJob(
  queue: Queue<BehaviorJobData>,
  data: BehaviorJobData,
): Promise<string | null> {
  const counts = await queue.getJobCounts("waiting", "active", "delayed", "prioritized");
  if (Object.values(counts).reduce((sum, count) => sum + count, 0) >= BEHAVIOR_BACKLOG_LIMIT)
    return null;
  const name =
    data.kind === "control"
      ? behaviorJobNames.backfillSelected
      : data.rebuildFrom
        ? behaviorJobNames.rebuildWalletCoin
        : behaviorJobNames.normalizeWalletCoin;
  const jobId = `behavior:${createHash("sha256").update(JSON.stringify(data)).digest("hex")}`;
  const job = await queue.add(name, data, {
    attempts: 5,
    backoff: { delay: 5_000, type: "exponential" },
    jobId,
    priority: hyperliquidJobPriorities.behaviorNormalization,
    removeOnComplete: 1_000,
    removeOnFail: 5_000,
  });
  return job.id ?? jobId;
}
