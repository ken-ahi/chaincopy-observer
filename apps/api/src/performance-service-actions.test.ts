import { type PrismaClient } from "@chaincopy/database";
import { performanceJobNames, type PerformanceJobData } from "@chaincopy/domain";
import { type Job, type Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import {
  PerformanceCalculationConflictError,
  PrismaPerformanceService,
} from "./performance-service.js";

const address = "0x1111111111111111111111111111111111111111";

function actionDatabase(options?: {
  readonly activeRun?: boolean;
  readonly found?: boolean;
  readonly latest?: Date | null;
}): PrismaClient {
  const aggregate = (field: "occurredAt" | "capturedAt") =>
    vi.fn(async () => ({
      _max: { [field]: options?.latest ?? new Date("2026-07-25T12:00:00.000Z") },
      _min: { [field]: new Date("2024-01-01T00:00:00.000Z") },
    }));
  return {
    cashFlow: { aggregate: aggregate("occurredAt") },
    fundingPayment: { aggregate: aggregate("occurredAt") },
    metricCalculationRun: {
      findFirst: vi.fn(async () => (options?.activeRun ? { id: "run-active" } : null)),
    },
    normalizedTrade: { aggregate: aggregate("occurredAt") },
    perpPositionEvent: { aggregate: aggregate("occurredAt") },
    portfolioSnapshot: { aggregate: aggregate("capturedAt") },
    syncCursor: {
      aggregate: vi.fn(async () => ({
        _max: {
          lastSuccessfulAt: new Date("2026-07-25T12:01:00.000Z"),
          lastTimestamp: null,
        },
      })),
    },
    walletAddress: {
      findFirst: vi.fn(async () =>
        options?.found === false
          ? null
          : {
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              id: "wallet-1",
            },
      ),
    },
  } as unknown as PrismaClient;
}

function actionQueue(existingJobs: ReadonlyArray<Job<PerformanceJobData>> = []) {
  const add = vi.fn(
    async (_name: string, _data: PerformanceJobData, options: { readonly jobId?: string }) => ({
      id: String(options.jobId),
    }),
  );
  return {
    add,
    getJobs: vi.fn(async () => existingJobs),
  } as unknown as Queue<PerformanceJobData> & { readonly add: typeof add };
}

describe("PrismaPerformanceService calculation actions", () => {
  it("queues calculate with the persisted input range and existing queue policy", async () => {
    const queue = actionQueue();
    const service = new PrismaPerformanceService(
      actionDatabase(),
      queue,
      () => new Date("2026-07-27T00:00:00.000Z"),
    );

    const result = await service.calculate(address);
    const [name, data, options] = queue.add.mock.calls[0] ?? [];

    expect(result).toMatchObject({
      calculationVersion: "performance-v1",
      force: false,
      status: "QUEUED",
      walletAddress: address,
    });
    expect(name).toBe(performanceJobNames.calculate);
    expect(data).toMatchObject({
      calculationFrom: "2024-01-01T00:00:00.000Z",
      calculationTo: "2026-07-25T12:00:00.000Z",
      requestedBy: "admin-api",
    });
    expect(options).toMatchObject({
      attempts: 3,
      backoff: { delay: 5_000, type: "exponential" },
      priority: 15,
    });
  });

  it("queues recalculate as a distinct forced job", async () => {
    const queue = actionQueue();
    const service = new PrismaPerformanceService(
      actionDatabase(),
      queue,
      () => new Date("2026-07-27T00:00:00.000Z"),
    );

    const result = await service.recalculate(address);
    const [name, data] = queue.add.mock.calls[0] ?? [];

    expect(name).toBe(performanceJobNames.recalculate);
    expect(data?.force).toBe(true);
    expect(result.force).toBe(true);
  });

  it("rejects an address that is not registered as monitored", async () => {
    const queue = actionQueue();
    const service = new PrismaPerformanceService(actionDatabase({ found: false }), queue);

    await expect(service.calculate(address)).rejects.toThrow("is not registered");
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("rejects a PENDING or RUNNING calculation for the same range", async () => {
    const queue = actionQueue();
    const service = new PrismaPerformanceService(actionDatabase({ activeRun: true }), queue);

    await expect(service.calculate(address)).rejects.toBeInstanceOf(
      PerformanceCalculationConflictError,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("rejects a queued duplicate before its calculation run is created", async () => {
    const queued = {
      data: {
        calculationFrom: "2024-01-01T00:00:00.000Z",
        calculationTo: "2026-07-25T12:00:00.000Z",
        calculationVersion: "performance-v1",
        force: false,
        requestedAt: "2026-07-27T00:00:00.000Z",
        requestedBy: "admin-api",
        walletAddressId: "wallet-1",
      },
    } as Job<PerformanceJobData>;
    const queue = actionQueue([queued]);
    const service = new PrismaPerformanceService(actionDatabase(), queue);

    await expect(service.calculate(address)).rejects.toBeInstanceOf(
      PerformanceCalculationConflictError,
    );
    expect(queue.add).not.toHaveBeenCalled();
  });
});
