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
      logger,
    );
    const second = new HyperliquidScheduler(
      database,
      redis as unknown as Redis,
      secondQueue as unknown as Queue<HyperliquidJobData>,
      secondSupervisor,
      "hyperliquid-mainnet",
      60_000,
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
        hyperliquidJobNames.positionSnapshot,
        hyperliquidJobNames.dataQualityAudit,
      ]);
      expect(secondQueue.names).toEqual([]);
      expect(findMany).toHaveBeenCalledOnce();
    } finally {
      await second.stop();
      await first.stop();
    }
  });
});
