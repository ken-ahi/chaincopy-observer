import {
  hyperliquidDiscoveryJobNames,
  hyperliquidJobPriorities,
  type HyperliquidDiscoveryJobData,
} from "@chaincopy/domain";
import { type JobsOptions, type Queue } from "bullmq";
import { describe, expect, it } from "vitest";

import {
  enqueueCandidateEnrichment,
  enqueueCandidateFilter,
  enqueueCandidateUpsert,
  enqueueMarketDiscovery,
} from "./queue.js";

class RecordingQueue {
  public readonly jobs: Array<{
    readonly name: string;
    readonly options: JobsOptions;
  }> = [];

  public async add(
    name: string,
    _data: HyperliquidDiscoveryJobData,
    options: JobsOptions,
  ): Promise<{ readonly id: string }> {
    this.jobs.push({ name, options });
    return { id: String(options.jobId) };
  }
}

describe("Hyperliquid discovery queue", () => {
  it("uses one fixed job ID for the same market trade", async () => {
    const queue = new RecordingQueue();
    const data = {
      kind: "trade" as const,
      requestedAt: "2026-07-26T00:00:00.000Z",
      trade: {
        buyerAddress: "0x1111111111111111111111111111111111111111",
        coin: "BTC",
        externalTradeId: "1:BTC:1",
        fingerprint: "fingerprint-1",
        notionalUsd: "10000",
        occurredAt: "2026-07-26T00:00:00.000Z",
        price: "10000",
        rawPayload: "{}",
        sellerAddress: "0x2222222222222222222222222222222222222222",
        side: "BUY" as const,
        size: "1",
        tradeId: "1",
        transactionHash: "0xhash",
      },
    };
    const first = await enqueueCandidateUpsert(
      queue as unknown as Queue<HyperliquidDiscoveryJobData>,
      data,
    );
    const duplicate = await enqueueCandidateUpsert(
      queue as unknown as Queue<HyperliquidDiscoveryJobData>,
      data,
    );

    expect(first).toBe(duplicate);
    expect(first).toBe("trade-fingerprint-1");
    expect(queue.jobs[0]?.name).toBe(hyperliquidDiscoveryJobNames.candidateUpsert);
  });

  it("fixes enrichment identity to candidate and exact requested range", async () => {
    const queue = new RecordingQueue();
    const jobId = await enqueueCandidateEnrichment(
      queue as unknown as Queue<HyperliquidDiscoveryJobData>,
      {
        address: "0x1111111111111111111111111111111111111111",
        candidateId: "candidate-1",
        kind: "candidate",
        requestedAt: "2026-07-26T00:00:00.000Z",
        requestedFrom: "2021-07-26T00:00:00.000Z",
        requestedTo: "2026-07-26T00:00:00.000Z",
      },
    );

    expect(jobId).toBe("enrich-candidate-1-1627257600000-1785024000000");
    expect(queue.jobs[0]?.options.priority).toBe(hyperliquidJobPriorities.candidateEnrichment);
  });

  it("places candidate rechecks behind first enrichment", async () => {
    const queue = new RecordingQueue();
    const data = {
      address: "0x1111111111111111111111111111111111111111",
      candidateId: "candidate-1",
      kind: "candidate" as const,
      requestedAt: "2026-07-26T00:00:00.000Z",
      requestedFrom: "2021-07-26T00:00:00.000Z",
      requestedTo: "2026-07-26T00:00:00.000Z",
    };

    await enqueueCandidateEnrichment(queue as unknown as Queue<HyperliquidDiscoveryJobData>, data);
    await enqueueCandidateEnrichment(
      queue as unknown as Queue<HyperliquidDiscoveryJobData>,
      { ...data, candidateId: "candidate-2" },
      true,
    );

    expect(queue.jobs.map((job) => job.options.priority)).toEqual([
      hyperliquidJobPriorities.candidateEnrichment,
      hyperliquidJobPriorities.candidateRecheck,
    ]);
  });

  it("deduplicates discovery control jobs per scheduler interval and allows restart", async () => {
    const queue = new RecordingQueue() as unknown as Queue<HyperliquidDiscoveryJobData>;
    const first = await enqueueMarketDiscovery(
      queue,
      "2026-07-26T00:00:01.000Z",
      "mainnet",
      10_000,
    );
    const duplicate = await enqueueMarketDiscovery(
      queue,
      "2026-07-26T00:00:09.999Z",
      "mainnet",
      10_000,
    );
    const nextInterval = await enqueueMarketDiscovery(
      queue,
      "2026-07-26T00:00:10.000Z",
      "mainnet",
      10_000,
    );

    expect(first).toBe(duplicate);
    expect(nextInterval).not.toBe(first);
  });

  it("uses one lightweight filter job per candidate and UTC day", async () => {
    const queue = new RecordingQueue() as unknown as Queue<HyperliquidDiscoveryJobData>;
    const candidate = {
      address: "0x1111111111111111111111111111111111111111",
      candidateId: "candidate-1",
      kind: "candidate" as const,
      requestedAt: "2026-07-26T00:00:00.000Z",
    };

    const first = await enqueueCandidateFilter(queue, candidate, "light-2026-07-26");
    const duplicate = await enqueueCandidateFilter(queue, candidate, "light-2026-07-26");
    const nextDay = await enqueueCandidateFilter(queue, candidate, "light-2026-07-27");

    expect(first).toBe(duplicate);
    expect(nextDay).not.toBe(first);
  });
});
