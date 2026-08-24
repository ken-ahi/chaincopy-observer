import { type PrismaClient } from "@chaincopy/database";
import { hyperliquidJobNames, type HyperliquidJobData } from "@chaincopy/domain";
import { type Job, type Queue } from "bullmq";
import { type Redis } from "ioredis";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { SyncLockUnavailableError } from "./lock.js";
import { HyperliquidJobProcessor, suppressImmediateLockRetry } from "./processor.js";

const jobData: HyperliquidJobData = {
  requestedAt: "2026-07-25T12:00:00.000Z",
  walletAddress: "0x1111111111111111111111111111111111111111",
  walletAddressId: "wallet-1",
};

function createProcessor(
  database: PrismaClient,
  websocketSupervisor: ConstructorParameters<typeof HyperliquidJobProcessor>[4],
  isSchedulerLeader = false,
  syncService = {} as ConstructorParameters<typeof HyperliquidJobProcessor>[3],
  performanceScheduler = {
    enqueue: vi.fn(async () => ({
      calculationFrom: "2026-01-01T00:00:00.000Z",
      calculationTo: "2026-07-25T12:00:00.000Z",
      jobId: "performance-job-1",
    })),
  } as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[7],
  canonicalAddress = jobData.walletAddress,
): HyperliquidJobProcessor {
  const databaseWithCanonicalWallet = {
    ...database,
    walletAddress: {
      findUnique: vi.fn(async () => ({ address: canonicalAddress })),
    },
  } as unknown as PrismaClient;
  return new HyperliquidJobProcessor(
    databaseWithCanonicalWallet,
    {
      eval: vi.fn(async () => 1),
      set: vi.fn(async () => "OK"),
    } as unknown as Redis,
    {} as unknown as Queue<HyperliquidJobData>,
    syncService,
    websocketSupervisor,
    "source-1",
    () => isSchedulerLeader,
    performanceScheduler,
    pino({ level: "silent" }),
  );
}

describe("HyperliquidJobProcessor", () => {
  it("fails closed before API calls or persistence when wallet identity and address differ", async () => {
    const snapshotPortfolio = vi.fn();
    const upsert = vi.fn();
    const processor = createProcessor(
      { syncJob: { upsert } } as unknown as PrismaClient,
      {} as ConstructorParameters<typeof HyperliquidJobProcessor>[4],
      false,
      { snapshotPortfolio } as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[3],
      undefined,
      "0x2222222222222222222222222222222222222222",
    );

    await expect(
      processor.process({
        attemptsMade: 0,
        data: jobData,
        id: "mismatched-wallet-job",
        name: hyperliquidJobNames.portfolioSnapshot,
      } as Job<HyperliquidJobData>),
    ).rejects.toMatchObject({ name: "UnrecoverableError" });
    expect(snapshotPortfolio).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it("uses the canonical DB address after case-insensitive identity validation", async () => {
    const snapshotPortfolio = vi.fn(async () => ({ captured: true }));
    const database = {
      syncJob: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => undefined),
        upsert: vi.fn(async () => undefined),
      },
    } as unknown as PrismaClient;
    const canonicalAddress = jobData.walletAddress.toUpperCase().replace("0X", "0x");
    const processor = createProcessor(
      database,
      {} as ConstructorParameters<typeof HyperliquidJobProcessor>[4],
      false,
      { snapshotPortfolio } as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[3],
      undefined,
      canonicalAddress,
    );

    await processor.process({
      attemptsMade: 0,
      data: jobData,
      id: "canonical-wallet-job",
      name: hyperliquidJobNames.portfolioSnapshot,
    } as Job<HyperliquidJobData>);

    expect(snapshotPortfolio).toHaveBeenCalledWith({ ...jobData, walletAddress: canonicalAddress });
  });

  it("marks lock contention unrecoverable for the current BullMQ job", () => {
    const error = suppressImmediateLockRetry(new SyncLockUnavailableError("wallet-lock"));

    expect(error.name).toBe("UnrecoverableError");
    expect(error.message).toContain("later scheduler tick");
  });

  it("skips a BullMQ redelivery already committed as successful", async () => {
    const upsert = vi.fn(async () => undefined);
    const database = {
      syncJob: {
        findUnique: vi.fn(async () => ({ status: "SUCCEEDED" })),
        upsert,
      },
    } as unknown as PrismaClient;
    const processor = createProcessor(
      database,
      {} as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[4],
    );
    const job = {
      attemptsMade: 0,
      data: jobData,
      id: "fill-job-1",
      name: hyperliquidJobNames.fillSync,
    } as unknown as Job<HyperliquidJobData>;

    await expect(processor.process(job)).resolves.toEqual({
      duplicateSuppressed: true,
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("keeps WebSocket ownership with the scheduler leader", async () => {
    const ensureWallet = vi.fn(async () => undefined);
    const database = {
      syncJob: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => undefined),
        upsert: vi.fn(async () => undefined),
      },
    } as unknown as PrismaClient;
    const processor = createProcessor(database, {
      ensureWallet,
    } as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[4]);
    const job = {
      attemptsMade: 0,
      data: jobData,
      id: "websocket-job-1",
      name: hyperliquidJobNames.websocketListener,
    } as unknown as Job<HyperliquidJobData>;

    await expect(processor.process(job)).resolves.toEqual({
      delegatedToSchedulerLeader: true,
      listening: false,
    });
    expect(ensureWallet).not.toHaveBeenCalled();
    expect(database.syncJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
  });

  it("records a failed attempt before BullMQ retries it", async () => {
    const update = vi.fn(async () => undefined);
    const database = {
      syncJob: {
        findUnique: vi.fn(async () => null),
        update,
        upsert: vi.fn(async () => undefined),
      },
    } as unknown as PrismaClient;
    const processor = createProcessor(
      database,
      {
        ensureWallet: vi.fn(async () => {
          throw new Error("websocket unavailable");
        }),
      } as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[4],
      true,
    );
    const job = {
      attemptsMade: 1,
      data: jobData,
      id: "websocket-job-failure",
      name: hyperliquidJobNames.websocketListener,
    } as unknown as Job<HyperliquidJobData>;

    await expect(processor.process(job)).rejects.toThrow("websocket unavailable");
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          errorMessage: "websocket unavailable",
          status: "FAILED",
        }),
      }),
    );
  });

  it("registers one performance job after a successful sync batch audit", async () => {
    const enqueue = vi.fn(async () => ({
      calculationFrom: "2026-01-01T00:00:00.000Z",
      calculationTo: "2026-07-25T12:00:00.000Z",
      jobId: "performance-job-1",
    }));
    const database = {
      syncJob: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => undefined),
        upsert: vi.fn(async () => undefined),
      },
    } as unknown as PrismaClient;
    const processor = createProcessor(
      database,
      {} as ConstructorParameters<typeof HyperliquidJobProcessor>[4],
      false,
      {
        auditDataQuality: vi.fn(async () => ({ openIssues: 0 })),
      } as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[3],
      { enqueue } as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[7],
    );

    await processor.process({
      attemptsMade: 0,
      data: jobData,
      id: "audit-job-1",
      name: hyperliquidJobNames.dataQualityAudit,
    } as Job<HyperliquidJobData>);

    expect(enqueue).toHaveBeenCalledOnce();
    expect(enqueue).toHaveBeenCalledWith(
      jobData.walletAddressId,
      new Date(jobData.requestedAt),
      `automatic:${hyperliquidJobNames.dataQualityAudit}`,
    );
  });

  it("does not register performance when history synchronization fails", async () => {
    const enqueue = vi.fn();
    const database = {
      syncJob: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => undefined),
        upsert: vi.fn(async () => undefined),
      },
    } as unknown as PrismaClient;
    const processor = createProcessor(
      database,
      {} as ConstructorParameters<typeof HyperliquidJobProcessor>[4],
      false,
      {
        auditDataQuality: vi.fn(async () => {
          throw new Error("sync failed");
        }),
      } as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[3],
      { enqueue } as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[7],
    );

    await expect(
      processor.process({
        attemptsMade: 0,
        data: jobData,
        id: "audit-job-failure",
        name: hyperliquidJobNames.dataQualityAudit,
      } as Job<HyperliquidJobData>),
    ).rejects.toThrow("sync failed");
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("registers performance recalculation after successful gap recovery", async () => {
    const enqueue = vi.fn(async () => ({
      calculationFrom: "2026-01-01T00:00:00.000Z",
      calculationTo: "2026-07-25T12:00:00.000Z",
      jobId: "performance-gap-job",
    }));
    const database = {
      syncJob: {
        findUnique: vi.fn(async () => null),
        update: vi.fn(async () => undefined),
        upsert: vi.fn(async () => undefined),
      },
    } as unknown as PrismaClient;
    const processor = createProcessor(
      database,
      {} as ConstructorParameters<typeof HyperliquidJobProcessor>[4],
      false,
      {
        recoverGap: vi.fn(async () => ({ recovered: true })),
      } as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[3],
      { enqueue } as unknown as ConstructorParameters<typeof HyperliquidJobProcessor>[7],
    );

    await processor.process({
      attemptsMade: 0,
      data: {
        ...jobData,
        endTime: "2026-07-25T12:00:00.000Z",
        startTime: "2026-07-25T11:00:00.000Z",
      },
      id: "gap-job-1",
      name: hyperliquidJobNames.gapRecovery,
    } as Job<HyperliquidJobData>);

    expect(enqueue).toHaveBeenCalledOnce();
  });
});
