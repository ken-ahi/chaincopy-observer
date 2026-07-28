import { type PrismaClient } from "@chaincopy/database";
import { type PerformanceJobData } from "@chaincopy/domain";
import { type Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import { PerformanceJobScheduler, resolvePerformanceCalculationRange } from "./scheduler.js";

function databaseWithRange(options?: {
  readonly earliest?: Date | null;
  readonly latest?: Date | null;
  readonly syncCompletedAt?: Date | null;
}): PrismaClient {
  const aggregate = (field: "occurredAt" | "capturedAt") =>
    vi.fn(async () => ({
      _max: { [field]: options?.latest ?? null },
      _min: { [field]: options?.earliest ?? null },
    }));
  return {
    cashFlow: { aggregate: aggregate("occurredAt") },
    fundingPayment: { aggregate: aggregate("occurredAt") },
    normalizedTrade: { aggregate: aggregate("occurredAt") },
    perpPositionEvent: { aggregate: aggregate("occurredAt") },
    portfolioSnapshot: { aggregate: aggregate("capturedAt") },
    syncCursor: {
      aggregate: vi.fn(async () => ({
        _max: {
          lastSuccessfulAt: options?.syncCompletedAt ?? null,
          lastTimestamp: null,
        },
      })),
    },
    walletAddress: {
      findUnique: vi.fn(async () => ({
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      })),
    },
  } as unknown as PrismaClient;
}

describe("PerformanceJobScheduler", () => {
  it("uses the oldest and newest persisted performance inputs", async () => {
    const range = await resolvePerformanceCalculationRange(
      databaseWithRange({
        earliest: new Date("2024-01-01T00:00:00.000Z"),
        latest: new Date("2026-07-25T12:00:00.000Z"),
      }),
      "wallet-1",
    );

    expect(range).toEqual({
      calculationFrom: new Date("2024-01-01T00:00:00.000Z"),
      calculationTo: new Date("2026-07-25T12:00:00.000Z"),
    });
  });

  it("uses persisted registration and synchronization timestamps when inputs are empty", async () => {
    const range = await resolvePerformanceCalculationRange(
      databaseWithRange({
        syncCompletedAt: new Date("2026-07-25T12:00:00.000Z"),
      }),
      "wallet-1",
    );

    expect(range).toEqual({
      calculationFrom: new Date("2026-01-01T00:00:00.000Z"),
      calculationTo: new Date("2026-07-25T12:00:00.000Z"),
    });
  });

  it("relies on deterministic queue IDs to suppress the same synchronization batch", async () => {
    const jobs = new Map<string, PerformanceJobData>();
    const queue = {
      add: vi.fn(async (_name: string, data: PerformanceJobData, options: { jobId?: string }) => {
        const id = String(options.jobId);
        jobs.set(id, data);
        return { id };
      }),
    } as unknown as Queue<PerformanceJobData>;
    const scheduler = new PerformanceJobScheduler(
      databaseWithRange({
        earliest: new Date("2024-01-01T00:00:00.000Z"),
        latest: new Date("2026-07-25T12:00:00.000Z"),
      }),
      queue,
    );

    const first = await scheduler.enqueue(
      "wallet-1",
      new Date("2026-07-25T12:01:00.000Z"),
      "automatic:test",
    );
    const duplicate = await scheduler.enqueue(
      "wallet-1",
      new Date("2026-07-25T12:02:00.000Z"),
      "automatic:test",
    );

    expect(duplicate.jobId).toBe(first.jobId);
    expect(jobs).toHaveLength(1);
  });

  it("creates a new calculation target when a newly persisted input extends the range", async () => {
    let latest = new Date("2026-07-25T12:00:00.000Z");
    const database = databaseWithRange();
    const rangeAggregate = vi.fn(async () => ({
      _max: { occurredAt: latest },
      _min: { occurredAt: new Date("2024-01-01T00:00:00.000Z") },
    }));
    Object.assign(database.normalizedTrade, { aggregate: rangeAggregate });
    const queue = {
      add: vi.fn(async (_name: string, _data: PerformanceJobData, options: { jobId?: string }) => ({
        id: String(options.jobId),
      })),
    } as unknown as Queue<PerformanceJobData>;
    const scheduler = new PerformanceJobScheduler(database, queue);

    const first = await scheduler.enqueue(
      "wallet-1",
      new Date("2026-07-25T12:01:00.000Z"),
      "automatic:test",
    );
    latest = new Date("2026-07-25T13:00:00.000Z");
    const second = await scheduler.enqueue(
      "wallet-1",
      new Date("2026-07-25T13:01:00.000Z"),
      "automatic:test",
    );

    expect(second.calculationTo).toBe("2026-07-25T13:00:00.000Z");
    expect(second.jobId).not.toBe(first.jobId);
  });
});
