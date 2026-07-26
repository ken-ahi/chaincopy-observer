import {
  hyperliquidDiscoveryJobNames,
  hyperliquidJobPriorities,
  type DiscoveryCandidateJobData,
  type DiscoveryControlJobData,
  type DiscoveryTradeJobData,
  type HyperliquidDiscoveryJobData,
  type HyperliquidDiscoveryJobName,
} from "@chaincopy/domain";
import { type JobsOptions, type Queue } from "bullmq";

export const discoveryJobOptions: JobsOptions = {
  attempts: 5,
  backoff: {
    delay: 1_000,
    type: "exponential",
  },
  removeOnComplete: {
    age: 24 * 60 * 60,
    count: 20_000,
  },
  removeOnFail: {
    age: 7 * 24 * 60 * 60,
    count: 20_000,
  },
};

export async function enqueueMarketDiscovery(
  queue: Queue<HyperliquidDiscoveryJobData>,
  requestedAt: string,
  sourceKey: string,
  intervalMs: number,
): Promise<string> {
  const data: DiscoveryControlJobData = { kind: "control", requestedAt };
  const intervalStart = Math.floor(new Date(requestedAt).getTime() / intervalMs) * intervalMs;
  return add(
    queue,
    hyperliquidDiscoveryJobNames.marketTradeDiscovery,
    data,
    `market-${sourceKey}-${intervalStart}`,
    hyperliquidJobPriorities.discoveryControl,
  );
}

export async function enqueueCandidateUpsert(
  queue: Queue<HyperliquidDiscoveryJobData>,
  data: DiscoveryTradeJobData,
): Promise<string> {
  return add(
    queue,
    hyperliquidDiscoveryJobNames.candidateUpsert,
    data,
    discoveryTradeJobId(data.trade.fingerprint),
    hyperliquidJobPriorities.candidateUpsert,
  );
}

export function discoveryTradeJobId(fingerprint: string): string {
  return `trade-${fingerprint}`;
}

export async function enqueueCandidateFilter(
  queue: Queue<HyperliquidDiscoveryJobData>,
  data: DiscoveryCandidateJobData,
  version: string,
): Promise<string> {
  return add(
    queue,
    hyperliquidDiscoveryJobNames.candidateFilter,
    data,
    `filter-${data.candidateId}-${version}`,
    hyperliquidJobPriorities.candidateUpsert,
  );
}

export async function enqueueCandidateEnrichment(
  queue: Queue<HyperliquidDiscoveryJobData>,
  data: DiscoveryCandidateJobData,
  lowPriority = false,
): Promise<string> {
  if (!data.requestedFrom || !data.requestedTo) {
    throw new RangeError("Candidate enrichment requires a requested time range.");
  }
  const from = new Date(data.requestedFrom).getTime();
  const to = new Date(data.requestedTo).getTime();
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    throw new RangeError("Candidate enrichment requires an ordered time range.");
  }
  return add(
    queue,
    hyperliquidDiscoveryJobNames.candidateEnrichment,
    data,
    `enrich-${data.candidateId}-${from}-${to}`,
    lowPriority
      ? hyperliquidJobPriorities.candidateRecheck
      : hyperliquidJobPriorities.candidateEnrichment,
  );
}

export async function enqueueCandidateQualityAudit(
  queue: Queue<HyperliquidDiscoveryJobData>,
  requestedAt: string,
): Promise<string> {
  const date = requestedAt.slice(0, 10);
  return add(
    queue,
    hyperliquidDiscoveryJobNames.candidateQualityAudit,
    { kind: "control", requestedAt },
    `quality-${date}`,
    hyperliquidJobPriorities.candidateRecheck,
  );
}

export async function enqueueCandidatePromotion(
  queue: Queue<HyperliquidDiscoveryJobData>,
  data: DiscoveryCandidateJobData,
): Promise<string> {
  return add(
    queue,
    hyperliquidDiscoveryJobNames.candidatePromotion,
    data,
    `promote-${data.candidateId}`,
    hyperliquidJobPriorities.candidateEnrichment,
  );
}

async function add(
  queue: Queue<HyperliquidDiscoveryJobData>,
  name: HyperliquidDiscoveryJobName,
  data: HyperliquidDiscoveryJobData,
  jobId: string,
  priority: number,
): Promise<string> {
  const job = await queue.add(name, data, {
    ...discoveryJobOptions,
    jobId,
    priority,
  });
  return job.id ?? jobId;
}
