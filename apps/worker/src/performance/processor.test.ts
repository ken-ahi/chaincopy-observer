import { performanceJobNames, type PerformanceJobData } from "@chaincopy/domain";
import { type Job } from "bullmq";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { PERFORMANCE_CALCULATION_VERSION } from "./constants.js";
import { PerformanceJobProcessor } from "./processor.js";
import type { PerformanceCalculationService } from "./service.js";

const jobData: PerformanceJobData = {
  calculationFrom: "2024-01-01T00:00:00.000Z",
  calculationTo: "2024-01-31T00:00:00.000Z",
  calculationVersion: PERFORMANCE_CALCULATION_VERSION,
  force: false,
  requestedAt: "2026-07-26T12:00:00.000Z",
  requestedBy: "phase4c-test",
  walletAddressId: "wallet-1",
};

function createJob(name: string): Job<PerformanceJobData> {
  return {
    attemptsMade: 0,
    data: jobData,
    id: "performance-job-1",
    name,
  } as unknown as Job<PerformanceJobData>;
}

describe("PerformanceJobProcessor", () => {
  it.each([performanceJobNames.calculate, performanceJobNames.recalculate])(
    "processes the supported %s job",
    async (name) => {
      const result = {
        calculationRunId: "run-1",
        inputFingerprint: "fingerprint-1",
        metricCount: 12,
        reused: false,
        status: "SUCCEEDED" as const,
      };
      const process = vi.fn(async () => result);
      const processor = new PerformanceJobProcessor(
        { process } as unknown as PerformanceCalculationService,
        pino({ level: "silent" }),
      );

      await expect(processor.process(createJob(name))).resolves.toEqual(result);
      expect(process).toHaveBeenCalledWith(jobData);
    },
  );

  it("rejects unsupported jobs without invoking the service", async () => {
    const process = vi.fn();
    const processor = new PerformanceJobProcessor(
      { process } as unknown as PerformanceCalculationService,
      pino({ level: "silent" }),
    );

    await expect(processor.process(createJob("unknown-job"))).rejects.toThrow(
      "Unsupported performance job",
    );
    expect(process).not.toHaveBeenCalled();
  });

  it("rethrows processing failures so BullMQ can retry them", async () => {
    const process = vi.fn(async () => {
      throw new Error("calculation unavailable");
    });
    const processor = new PerformanceJobProcessor(
      { process } as unknown as PerformanceCalculationService,
      pino({ level: "silent" }),
    );

    await expect(processor.process(createJob(performanceJobNames.calculate))).rejects.toThrow(
      "calculation unavailable",
    );
  });
});
