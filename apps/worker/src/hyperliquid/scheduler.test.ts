import { type PrismaClient } from "@chaincopy/database";
import { hyperliquidJobNames, type HyperliquidJobData } from "@chaincopy/domain";
import { type JobsOptions, type Queue } from "bullmq";
import { type Redis } from "ioredis";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { HyperliquidScheduler } from "./scheduler.js";

interface WatchedWallet {
  readonly address: string;
  readonly id: string;
}

class LeaseRedis {
  private readonly values = new Map<string, string>();

  public async set(
    key: string,
    token: string,
    _px: "PX",
    _ttlMs: number,
    _nx: "NX",
  ): Promise<"OK" | null> {
    if (this.values.has(key)) {
      return null;
    }
    this.values.set(key, token);
    return "OK";
  }

  public async eval(
    script: string,
    _keyCount: number,
    key: string,
    token: string,
  ): Promise<number> {
    if (this.values.get(key) !== token) {
      return 0;
    }
    if (script.includes("'del'")) {
      this.values.delete(key);
    }
    return 1;
  }
}

class RecordingQueue {
  public readonly names: string[] = [];

  public constructor(private readonly backlog = 0) {}

  public async getJobCounts(): Promise<Record<string, number>> {
    return { active: 0, delayed: 0, prioritized: 0, waiting: this.backlog };
  }

  public async getJobs(): Promise<readonly []> {
    return [];
  }

  public async add(
    name: string,
    _data: HyperliquidJobData,
    options: JobsOptions,
  ): Promise<{ readonly id: string }> {
    this.names.push(name);
    return { id: String(options.jobId) };
  }
}

function createSupervisor() {
  return {
    reconcile: vi.fn(async (_wallets: ReadonlyArray<WatchedWallet>) => undefined),
    stop: vi.fn(async () => undefined),
  };
}

const schedule = {
  accountMs: 600_000,
  auditMs: 3_600_000,
  backlogLimit: 500,
  fillMs: 60_000,
  orderHistoryMs: 3_600_000,
  portfolioMs: 1_800_000,
} as const;

describe("HyperliquidScheduler", () => {
  it("allows only one process to schedule and supervise a source", async () => {
    const wallets: ReadonlyArray<WatchedWallet> = [
      {
        address: "0x1111111111111111111111111111111111111111",
        id: "wallet-1",
      },
    ];
    const findMany = vi.fn(async () => wallets);
    const database = {
      walletAddress: { findMany },
    } as unknown as PrismaClient;
    const redis = new LeaseRedis();
    const firstQueue = new RecordingQueue();
    const secondQueue = new RecordingQueue();
    const firstSupervisor = createSupervisor();
    const secondSupervisor = createSupervisor();
    const logger = pino({ level: "silent" });
    const first = new HyperliquidScheduler(
      database,
      redis as unknown as Redis,
      firstQueue as unknown as Queue<HyperliquidJobData>,
      firstSupervisor,
      "hyperliquid-mainnet",
      60_000,
      schedule,
      logger,
    );
    const second = new HyperliquidScheduler(
      database,
      redis as unknown as Redis,
      secondQueue as unknown as Queue<HyperliquidJobData>,
      secondSupervisor,
      "hyperliquid-mainnet",
      60_000,
      schedule,
      logger,
    );

    try {
      await first.start();
      await second.start();

      expect(first.hasLeadership()).toBe(true);
      expect(second.hasLeadership()).toBe(false);
      expect(firstSupervisor.reconcile).toHaveBeenCalledWith(wallets);
      expect(secondSupervisor.reconcile).not.toHaveBeenCalled();
      expect(firstQueue.names).toEqual([
        hyperliquidJobNames.fillSync,
        hyperliquidJobNames.fundingSync,
        hyperliquidJobNames.ledgerSync,
        hyperliquidJobNames.currentStateSnapshot,
        hyperliquidJobNames.portfolioSnapshot,
        hyperliquidJobNames.historicalOrdersSync,
        hyperliquidJobNames.dataQualityAudit,
      ]);
      expect(secondQueue.names).toEqual([]);
      expect(findMany).toHaveBeenCalledOnce();
    } finally {
      await second.stop();
      await first.stop();
    }
  });

  it("releases leadership before waiting for WebSocket shutdown", async () => {
    const database = {
      walletAddress: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient;
    const redis = new LeaseRedis();
    const logger = pino({ level: "silent" });
    let finishWebSocketStop: (() => void) | undefined;
    const webSocketStop = new Promise<void>((resolve) => {
      finishWebSocketStop = resolve;
    });
    const firstSupervisor = {
      ...createSupervisor(),
      stop: vi.fn(() => webSocketStop),
    };
    const secondSupervisor = createSupervisor();
    const first = new HyperliquidScheduler(
      database,
      redis as unknown as Redis,
      new RecordingQueue() as unknown as Queue<HyperliquidJobData>,
      firstSupervisor,
      "hyperliquid-mainnet",
      60_000,
      schedule,
      logger,
    );
    const second = new HyperliquidScheduler(
      database,
      redis as unknown as Redis,
      new RecordingQueue() as unknown as Queue<HyperliquidJobData>,
      secondSupervisor,
      "hyperliquid-mainnet",
      60_000,
      schedule,
      logger,
    );

    await first.start();
    const stopping = first.stop();
    await vi.waitFor(() => expect(firstSupervisor.stop).toHaveBeenCalledOnce());
    await second.start();

    expect(second.hasLeadership()).toBe(true);

    finishWebSocketStop?.();
    await stopping;
    await second.stop();
  });

  it("suppresses enqueue when the queue backlog reaches the configured limit", async () => {
    const database = {
      walletAddress: {
        findMany: vi.fn(async () => [
          { address: "0x1111111111111111111111111111111111111111", id: "wallet-1" },
        ]),
      },
    } as unknown as PrismaClient;
    const queue = new RecordingQueue(schedule.backlogLimit);
    const scheduler = new HyperliquidScheduler(
      database,
      new LeaseRedis() as unknown as Redis,
      queue as unknown as Queue<HyperliquidJobData>,
      createSupervisor(),
      "hyperliquid-mainnet",
      60_000,
      schedule,
      pino({ level: "silent" }),
    );

    try {
      await scheduler.start();
      expect(queue.names).toEqual([]);
    } finally {
      await scheduler.stop();
    }
  });
});
