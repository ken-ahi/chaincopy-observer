import {
  hyperliquidDiscoveryJobNames,
  hyperliquidDiscoveryQueueName,
  type HyperliquidDiscoveryJobData,
  type HyperliquidJobData,
} from "@chaincopy/domain";
import type { PrismaClient } from "@chaincopy/database";
import type { Job, JobsOptions, Queue } from "bullmq";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import type { CandidateEnrichmentService } from "./enrichment-service.js";
import { HyperliquidDiscoveryJobProcessor } from "./processor.js";
import type { HyperliquidDiscoveryRepository } from "./repository.js";
import type { HyperliquidDiscoveryWebSocketSupervisor } from "./websocket-supervisor.js";

class RecordingDiscoveryQueue {
  public readonly jobs: Array<{
    readonly data: HyperliquidDiscoveryJobData;
    readonly name: string;
    readonly options: JobsOptions;
  }> = [];

  public async add(
    name: string,
    data: HyperliquidDiscoveryJobData,
    options: JobsOptions,
  ): Promise<{ readonly id: string }> {
    this.jobs.push({ data, name, options });
    return { id: String(options.jobId) };
  }
}

describe("HyperliquidDiscoveryJobProcessor automatic promotion", () => {
  it("enqueues an idempotent promotion as soon as full enrichment is eligible", async () => {
    const queue = new RecordingDiscoveryQueue();
    const database = {
      syncJob: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => ({})),
        upsert: vi.fn(async () => ({})),
      },
    };
    const repository = {
      getCandidateFilterContext: vi.fn(async () => ({
        candidate: {
          address: "0x1111111111111111111111111111111111111111",
          enrichmentStatus: "SUCCEEDED",
          estimatedNotionalUsd: "100000",
          exclusionReasons: [],
          filterStatus: "ELIGIBLE",
          id: "candidate-1",
          lastSeenAt: new Date("2026-09-23T00:00:00.000Z"),
          nextEnrichmentAt: null,
          tradeCount: 100,
        },
        settings: {
          fullMinimumActiveDays: 90,
          fullMinimumActiveMonths: 3,
          fullMinimumNotionalUsd: "1000",
          fullMinimumTradeCount: 20,
          fullRecentActivityDays: 7,
          minimumEnrichmentIntervalMin: 60,
          minimumObservedNotionalUsd: "100",
          minimumObservedTradeCount: 1,
          recentActivityHours: 24,
        },
        watched: false,
      })),
      getStoredFullFilterResult: vi.fn(async () => ({
        endpointFailures: 0,
        historyTruncated: false,
        result: {
          activeDays: 365,
          activeMonths: 12,
          availableFrom: new Date("2025-09-23T00:00:00.000Z"),
          availableTo: new Date("2026-09-23T00:00:00.000Z"),
          completeness: "COMPLETE",
          cumulativeNotionalUsd: "100000",
          dataQualityScore: 100,
          reasons: [],
          status: "ELIGIBLE",
        },
        retrievedFillCount: 100,
      })),
      updateFullFilter: vi.fn(async () => true),
    };
    const processor = new HyperliquidDiscoveryJobProcessor(
      database as unknown as PrismaClient,
      queue as unknown as Queue<HyperliquidDiscoveryJobData>,
      queue as unknown as Queue<HyperliquidDiscoveryJobData>,
      {} as Queue<HyperliquidJobData>,
      repository as unknown as HyperliquidDiscoveryRepository,
      {} as CandidateEnrichmentService,
      {} as HyperliquidDiscoveryWebSocketSupervisor,
      "source-1",
      () => true,
      new Set(),
      pino({ level: "silent" }),
    );
    const data = {
      address: "0x1111111111111111111111111111111111111111",
      candidateId: "candidate-1",
      kind: "candidate" as const,
      requestedAt: "2026-09-23T00:00:00.000Z",
    };
    const job = {
      attemptsMade: 0,
      data,
      id: "filter-candidate-1",
      name: hyperliquidDiscoveryJobNames.candidateFilter,
    } as unknown as Job<HyperliquidDiscoveryJobData>;

    await expect(processor.process(job, hyperliquidDiscoveryQueueName)).resolves.toMatchObject({
      promotionJobId: "promote-candidate-1",
      status: "ELIGIBLE",
    });
    expect(queue.jobs).toContainEqual(
      expect.objectContaining({
        data: { ...data, automatic: true },
        name: hyperliquidDiscoveryJobNames.candidatePromotion,
        options: expect.objectContaining({ jobId: "promote-candidate-1" }),
      }),
    );
  });
});
