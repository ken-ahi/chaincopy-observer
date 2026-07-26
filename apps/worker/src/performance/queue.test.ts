import {
  hyperliquidJobPriorities,
  performanceJobNames,
  type PerformanceJobData,
} from "@chaincopy/domain";
import { type JobsOptions, type Queue } from "bullmq";
import { describe, expect, it } from "vitest";

import { PERFORMANCE_CALCULATION_VERSION } from "./constants.js";
import { enqueuePerformanceJob, performanceJobOptions } from "./queue.js";

class RecordingQueue {
  public readonly jobs: Array<{
    readonly data: PerformanceJobData;
    readonly name: string;
    readonly options: JobsOptions;
  }> = [];

  public async add(
    name: string,
    data: PerformanceJobData,
    options: JobsOptions,
  ): Promise<{ readonly id: string }> {
    this.jobs.push({ data, name, options });
    return { id: String(options.jobId) };
  }
}

const baseJob: PerformanceJobData = {
  calculationFrom: "2024-01-01T00:00:00.000Z",
  calculationTo: "2024-01-31T00:00:00.000Z",
  calculationVersion: PERFORMANCE_CALCULATION_VERSION,
  force: false,
  requestedAt: "2026-07-26T12:00:00.000Z",
  requestedBy: "phase4c-test",
  walletAddressId: "wallet-1",
};

describe("performance queue", () => {
  it("uses a deterministic job ID for the same address, range, and version", async () => {
    const queue = new RecordingQueue();

    const first = await enqueuePerformanceJob(
      queue as unknown as Queue<PerformanceJobData>,
      baseJob,
    );
    const duplicate = await enqueuePerformanceJob(queue as unknown as Queue<PerformanceJobData>, {
      ...baseJob,
      requestedAt: "2026-07-26T12:05:00.000Z",
    });

    expect(duplicate).toBe(first);
    expect(queue.jobs.map((job) => job.name)).toEqual([
      performanceJobNames.calculate,
      performanceJobNames.calculate,
    ]);
  });

  it("uses bounded exponential retries and a lower priority than existing sync work", () => {
    expect(performanceJobOptions.attempts).toBe(3);
    expect(performanceJobOptions.backoff).toEqual({
      delay: 5_000,
      type: "exponential",
    });
    expect(performanceJobOptions.priority).toBe(hyperliquidJobPriorities.addressPerformance);
    expect(hyperliquidJobPriorities.addressPerformance).toBeGreaterThan(
      hyperliquidJobPriorities.candidateEnrichment,
    );
  });

  it("creates a distinct forced recalculation while keeping its retry ID stable", async () => {
    const queue = new RecordingQueue();
    const firstRequest = { ...baseJob, force: true };

    const first = await enqueuePerformanceJob(
      queue as unknown as Queue<PerformanceJobData>,
      firstRequest,
    );
    const retry = await enqueuePerformanceJob(
      queue as unknown as Queue<PerformanceJobData>,
      firstRequest,
    );
    const laterRequest = await enqueuePerformanceJob(
      queue as unknown as Queue<PerformanceJobData>,
      {
        ...firstRequest,
        requestedAt: "2026-07-26T12:01:00.000Z",
      },
    );

    expect(retry).toBe(first);
    expect(laterRequest).not.toBe(first);
    expect(queue.jobs.every((job) => job.name === performanceJobNames.recalculate)).toBe(true);
  });

  it("rejects invalid ranges before registering a job", async () => {
    const queue = new RecordingQueue();

    await expect(
      enqueuePerformanceJob(queue as unknown as Queue<PerformanceJobData>, {
        ...baseJob,
        calculationTo: "invalid",
      }),
    ).rejects.toThrow("valid ordered time range");
    expect(queue.jobs).toHaveLength(0);
  });
});
