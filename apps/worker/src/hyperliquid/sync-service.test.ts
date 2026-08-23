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

  it("resolves each partial API issue only after that snapshot part succeeds", async () => {
    const response = (data: unknown) => ({ data, rawText: "{}" });
    const client = {
      clearinghouseState: vi.fn(async () =>
        response({ assetPositions: [], marginSummary: {}, withdrawable: "0" }),
      ),
      frontendOpenOrders: vi.fn(async () => response([])),
      openOrders: vi.fn(async () => response([])),
      spotClearinghouseState: vi.fn(async () => response({ balances: [] })),
      userRateLimit: vi.fn(async () => response({ cumVlm: "0", nRequestsUsed: 0 })),
    } as unknown as HyperliquidClient;
    const resolveQualityIssue = vi.fn(async () => undefined);
    const repository = {
      beginCursor: vi.fn(async () => undefined),
      completeCursor: vi.fn(async () => undefined),
      markSourceSuccess: vi.fn(async () => undefined),
      resolveQualityIssue,
      saveClearinghouseSnapshot: vi.fn(async () => undefined),
      saveOpenOrders: vi.fn(async () => 0),
      savePositions: vi.fn(async () => undefined),
      saveRawEvent: vi.fn(async () => undefined),
      saveSpotBalances: vi.fn(async () => 0),
    } as unknown as HyperliquidRepository;
    const service = new HyperliquidSyncService(client, repository, pino({ level: "silent" }));

    await expect(service.snapshotPositions(job)).resolves.toMatchObject({
      failures: [],
      successes: 5,
    });
    expect(resolveQualityIssue).toHaveBeenCalledTimes(5);
    expect(resolveQualityIssue).toHaveBeenCalledWith({
      details: { part: "clearinghouseState" },
      issueType: "HYPERLIQUID_PARTIAL_API_FAILURE",
      walletAddress: job.walletAddress,
    });
  });

  it("resolves standalone portfolio and historical-order failures after persistence succeeds", async () => {
    const client = {
      historicalOrders: vi.fn(async () => ({ data: [], rawText: "[]" })),
      portfolio: vi.fn(async () => ({ data: [], rawText: "[]" })),
    } as unknown as HyperliquidClient;
    const resolveQualityIssue = vi.fn(async () => undefined);
    const repository = {
      resolveQualityIssue,
      saveHistoricalOrders: vi.fn(async () => 0),
      savePortfolioHistory: vi.fn(async () => undefined),
      saveRawEvent: vi.fn(async () => undefined),
    } as unknown as HyperliquidRepository;
    const service = new HyperliquidSyncService(client, repository, pino({ level: "silent" }));

    await service.snapshotPortfolio(job);
    await service.syncHistoricalOrders(job);

    expect(resolveQualityIssue).toHaveBeenCalledWith({
      details: { part: "portfolio" },
      issueType: "HYPERLIQUID_PARTIAL_API_FAILURE",
      walletAddress: job.walletAddress,
    });
    expect(resolveQualityIssue).toHaveBeenCalledWith({
      details: { part: "historicalOrders" },
      issueType: "HYPERLIQUID_PARTIAL_API_FAILURE",
      walletAddress: job.walletAddress,
    });
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

  it("recovers a historical gap without rewinding a newer connection cursor", async () => {
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
    ).resolves.toMatchObject({ connectionCursorUpdated: false });
    expect(repository.resolveQualityIssue).toHaveBeenCalledOnce();
    expect(repository.markSourceSuccess).toHaveBeenCalledOnce();
    expect(error).not.toHaveBeenCalled();
  });

  it("keeps a gap open when bounded HTTP recovery reaches a source limit", async () => {
    const repository = {
      completeWebSocketGap: vi.fn(async () => false),
      markSourceSuccess: vi.fn(async () => undefined),
      resolveQualityIssue: vi.fn(async () => undefined),
    } as unknown as HyperliquidRepository;
    const service = new HyperliquidSyncService(
      {} as HyperliquidClient,
      repository,
      pino({ level: "silent" }),
    );
    vi.spyOn(service, "syncFills").mockResolvedValue({ reachedHistoryLimit: true });
    vi.spyOn(service, "syncFunding").mockResolvedValue({ reachedHistoryLimit: false });
    vi.spyOn(service, "syncLedger").mockResolvedValue({ reachedHistoryLimit: false });

    await expect(
      service.recoverGap({
        ...job,
        endTime: "2026-07-25T12:01:00.000Z",
        startTime: "2026-07-25T12:00:00.000Z",
      }),
    ).rejects.toThrow("coverage is not proven");
    expect(repository.completeWebSocketGap).not.toHaveBeenCalled();
    expect(repository.resolveQualityIssue).not.toHaveBeenCalled();
    expect(repository.markSourceSuccess).not.toHaveBeenCalled();
  });
});
