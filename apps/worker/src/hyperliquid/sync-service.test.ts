import { type HyperliquidClient } from "@chaincopy/blockchain-adapters";
import { type HyperliquidJobData } from "@chaincopy/domain";
import { type Logger } from "pino";
import pino from "pino";
import { describe, expect, it, vi } from "vitest";

import { type HyperliquidRepository } from "./repository.js";
import { HyperliquidSyncService } from "./sync-service.js";

const job: HyperliquidJobData = {
  requestedAt: "2026-07-25T12:00:00.000Z",
  walletAddress: "0x1111111111111111111111111111111111111111",
  walletAddressId: "wallet-1",
};

describe("HyperliquidSyncService", () => {
  it("persists HTTP pages before advancing the successful cursor", async () => {
    const fill = {
      closedPnl: "0",
      coin: "BTC",
      crossed: true,
      dir: "Open Long",
      fee: "0.01",
      feeToken: "USDC",
      hash: "0xfill",
      oid: "1",
      px: "100",
      side: "B" as const,
      startPosition: "0",
      sz: "1",
      tid: "2",
      time: 1_721_862_400_000,
    };
    const operations: string[] = [];
    const client = {
      allUserFillsByTime: vi.fn(async () => ({
        items: [fill],
        pages: ["[]"],
        reachedHistoryLimit: false,
      })),
    } as unknown as HyperliquidClient;
    const repository = {
      beginCursor: vi.fn(async () => {
        operations.push("begin");
      }),
      completeCursor: vi.fn(async () => {
        operations.push("complete");
      }),
      getCursor: vi.fn(async () => ({
        lastExternalId: null,
        lastTimestamp: null,
      })),
      saveFills: vi.fn(async () => {
        operations.push("fills");
        return 1;
      }),
      saveRawPages: vi.fn(async () => {
        operations.push("raw");
      }),
    } as unknown as HyperliquidRepository;
    const service = new HyperliquidSyncService(client, repository, pino({ level: "silent" }));

    await expect(service.syncFills(job)).resolves.toMatchObject({
      fetched: 1,
      inserted: 1,
    });
    expect(operations).toEqual(["begin", "raw", "fills", "complete"]);
  });

  it("marks the cursor and source failed when HTTP synchronization fails", async () => {
    const client = {
      allUserFillsByTime: vi.fn(async () => {
        throw new Error("upstream unavailable");
      }),
    } as unknown as HyperliquidClient;
    const repository = {
      beginCursor: vi.fn(async () => undefined),
      failCursor: vi.fn(async () => undefined),
      getCursor: vi.fn(async () => ({
        lastExternalId: null,
        lastTimestamp: null,
      })),
      markSourceFailure: vi.fn(async () => undefined),
    } as unknown as HyperliquidRepository;
    const service = new HyperliquidSyncService(client, repository, pino({ level: "silent" }));

    await expect(service.syncFills(job)).rejects.toThrow("upstream unavailable");
    expect(repository.failCursor).toHaveBeenCalledWith(
      "wallet-1",
      "fills",
      "timestamp",
      "upstream unavailable",
    );
    expect(repository.markSourceFailure).toHaveBeenCalledWith("upstream unavailable");
  });

  it("logs gap recovery start and success after the matching cursor is completed", async () => {
    const repository = {
      completeWebSocketGap: vi.fn(async () => true),
      markSourceSuccess: vi.fn(async () => undefined),
      resolveQualityIssue: vi.fn(async () => undefined),
    } as unknown as HyperliquidRepository;
    const info = vi.fn();
    const logger = {
      error: vi.fn(),
      info,
      warn: vi.fn(),
    } as unknown as Logger;
    const service = new HyperliquidSyncService({} as HyperliquidClient, repository, logger);
    vi.spyOn(service, "syncFills").mockResolvedValue({ inserted: 1 });
    vi.spyOn(service, "syncFunding").mockResolvedValue({ inserted: 1 });
    vi.spyOn(service, "syncLedger").mockResolvedValue({ inserted: 1 });
    const gapJob = {
      ...job,
      endTime: "2026-07-25T12:01:00.000Z",
      startTime: "2026-07-25T12:00:00.000Z",
    };

    await expect(service.recoverGap(gapJob)).resolves.toMatchObject({
      connectionCursorUpdated: true,
    });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "hyperliquid_gap_recovery_started" }),
      "Hyperliquid gap recovery started",
    );
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ event: "hyperliquid_gap_recovery_succeeded" }),
      "Hyperliquid gap recovery succeeded",
    );
    expect(repository.markSourceSuccess).toHaveBeenCalledOnce();
  });

  it("logs and throws when gap recovery cannot complete its matching cursor", async () => {
    const repository = {
      completeWebSocketGap: vi.fn(async () => false),
      markSourceSuccess: vi.fn(async () => undefined),
      resolveQualityIssue: vi.fn(async () => undefined),
    } as unknown as HyperliquidRepository;
    const error = vi.fn();
    const logger = {
      error,
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;
    const service = new HyperliquidSyncService({} as HyperliquidClient, repository, logger);
    vi.spyOn(service, "syncFills").mockResolvedValue({ inserted: 1 });
    vi.spyOn(service, "syncFunding").mockResolvedValue({ inserted: 1 });
    vi.spyOn(service, "syncLedger").mockResolvedValue({ inserted: 1 });

    await expect(
      service.recoverGap({
        ...job,
        endTime: "2026-07-25T12:01:00.000Z",
        startTime: "2026-07-25T12:00:00.000Z",
      }),
    ).rejects.toThrow("matching WebSocket cursor");
    expect(repository.resolveQualityIssue).not.toHaveBeenCalled();
    expect(repository.markSourceSuccess).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ event: "hyperliquid_gap_recovery_failed" }),
      "Hyperliquid gap recovery failed",
    );
  });
});
