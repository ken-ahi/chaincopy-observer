import { type PrismaClient } from "@chaincopy/database";
import { type HyperliquidClearinghouseState } from "@chaincopy/blockchain-adapters";
import { describe, expect, it, vi } from "vitest";

import { HyperliquidRepository } from "./repository.js";

interface CursorUpsertInput {
  readonly update: Readonly<Record<string, unknown>>;
}

describe("HyperliquidRepository cursors", () => {
  it("persists portfolio account-value history as deterministic NAV inputs", async () => {
    const createMany = vi.fn(async (_input: unknown) => ({ count: 3 }));
    const database = {
      dataSource: { upsert: vi.fn(async () => ({ id: "source-1" })) },
      portfolioSnapshot: { createMany },
    } as unknown as PrismaClient;
    const repository = new HyperliquidRepository(
      database,
      "hyperliquid-mainnet",
      "Hyperliquid Mainnet",
    );

    await repository.savePortfolioHistory(
      "wallet-1",
      "0x1111111111111111111111111111111111111111",
      [
        [
          "perpAllTime",
          {
            accountValueHistory: [
              [1_721_862_400_000, "100.0"],
              [1_721_948_800_000, "110"],
            ],
            pnlHistory: [],
            vlm: "1",
          },
        ],
        [
          "perpAllTime",
          {
            accountValueHistory: [[1_721_862_400_000, "100.00"]],
            pnlHistory: [],
            vlm: "1",
          },
        ],
      ],
      "[]",
      new Date("2026-07-25T12:00:00.000Z"),
    );

    expect(createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.arrayContaining([
          expect.objectContaining({
            accountValue: "100",
            capturedAt: new Date(1_721_862_400_000),
            snapshotType: "portfolio-history",
          }),
          expect.objectContaining({
            accountValue: "110",
            capturedAt: new Date(1_721_948_800_000),
            snapshotType: "portfolio-history",
          }),
        ]),
        skipDuplicates: true,
      }),
    );
  });

  it("rejects conflicting portfolio account values at the same timestamp", async () => {
    const database = {
      dataSource: { upsert: vi.fn(async () => ({ id: "source-1" })) },
      portfolioSnapshot: { createMany: vi.fn(async () => ({ count: 0 })) },
    } as unknown as PrismaClient;
    const repository = new HyperliquidRepository(
      database,
      "hyperliquid-mainnet",
      "Hyperliquid Mainnet",
    );
    const period = (accountValue: string) => ({
      accountValueHistory: [[1_721_862_400_000, accountValue] as [number, string]],
      pnlHistory: [] as [number, string][],
      vlm: "1",
    });

    await expect(
      repository.savePortfolioHistory(
        "wallet-1",
        "0x1111111111111111111111111111111111111111",
        [
          ["perpAllTime", period("100")],
          ["perpAllTime", period("101")],
        ],
        "[]",
        new Date("2026-07-25T12:00:00.000Z"),
      ),
    ).rejects.toThrow("conflicting account values");
  });

  it("resolves stale incomplete-initial-sync issues only after all required cursors succeed", async () => {
    const updateMany = vi.fn(async (_input: unknown) => ({ count: 3 }));
    const database = {
      cashFlow: { count: vi.fn(async () => 1) },
      dataQualityIssue: {
        count: vi.fn(async () => 0),
        updateMany,
      },
      dataSource: { upsert: vi.fn(async () => ({ id: "source-1" })) },
      fundingPayment: { count: vi.fn(async () => 1) },
      normalizedTrade: { count: vi.fn(async () => 1) },
      perpPosition: { count: vi.fn(async () => 1) },
      syncCursor: {
        findMany: vi.fn(async () =>
          ["fills", "funding", "ledger", "account-snapshot"].map((scope) => ({
            lastSuccessfulAt: new Date("2026-07-25T12:00:00.000Z"),
            scope,
            status: "SUCCEEDED",
          })),
        ),
      },
    } as unknown as PrismaClient;
    const repository = new HyperliquidRepository(
      database,
      "hyperliquid-mainnet",
      "Hyperliquid Mainnet",
    );

    await repository.auditWallet("wallet-1", "0x1111111111111111111111111111111111111111");

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          issueType: "HYPERLIQUID_INCOMPLETE_INITIAL_SYNC",
          status: "OPEN",
          walletAddressId: "wallet-1",
        },
      }),
    );
  });

  it("uses a batched transaction instead of a long interactive position transaction", async () => {
    const transaction = vi.fn(async (operations: readonly Promise<unknown>[]) =>
      Promise.all(operations),
    );
    const database = {
      $transaction: transaction,
      dataSource: { upsert: vi.fn(async () => ({ id: "source-1" })) },
      perpPosition: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        findFirst: vi.fn(async () => null),
        upsert: vi.fn(async () => undefined),
      },
      perpPositionEvent: { createMany: vi.fn(async () => ({ count: 0 })) },
    } as unknown as PrismaClient;
    const repository = new HyperliquidRepository(
      database,
      "hyperliquid-mainnet",
      "Hyperliquid Mainnet",
    );

    await repository.savePositions(
      "wallet-1",
      "0x1111111111111111111111111111111111111111",
      { assetPositions: [] } as unknown as HyperliquidClearinghouseState,
      new Date("2026-07-25T12:05:00.000Z"),
    );

    expect(transaction).toHaveBeenCalledWith(expect.any(Array));
    expect(typeof transaction.mock.calls[0]?.[0]).not.toBe("function");
  });

  it("preserves the durable cursor when a successful HTTP page is empty", async () => {
    const syncCursorUpsert = vi.fn(async (_input: unknown) => undefined);
    const database = {
      dataSource: {
        upsert: vi.fn(async () => ({ id: "source-1" })),
      },
      syncCursor: {
        upsert: syncCursorUpsert,
      },
      walletAddress: {
        update: vi.fn(async () => undefined),
      },
    } as unknown as PrismaClient;
    const repository = new HyperliquidRepository(
      database,
      "hyperliquid-mainnet",
      "Hyperliquid Mainnet",
    );

    await repository.completeCursor("wallet-1", "fills", "timestamp", undefined, undefined);

    const input = syncCursorUpsert.mock.calls[0]?.[0] as CursorUpsertInput | undefined;
    expect(input?.update).not.toHaveProperty("lastTimestamp");
    expect(input?.update).not.toHaveProperty("lastExternalId");
    expect(input?.update.status).toBe("SUCCEEDED");
  });

  it("completes only the WebSocket gap matching the recovered interval", async () => {
    const updateMany = vi.fn(async (_input: unknown) => ({ count: 1 }));
    const walletUpdate = vi.fn(async () => undefined);
    const database = {
      dataSource: {
        upsert: vi.fn(async () => ({ id: "source-1" })),
      },
      syncCursor: {
        updateMany,
      },
      walletAddress: {
        update: walletUpdate,
      },
    } as unknown as PrismaClient;
    const repository = new HyperliquidRepository(
      database,
      "hyperliquid-mainnet",
      "Hyperliquid Mainnet",
    );
    const disconnectedAt = "2026-07-25T12:00:00.000Z";
    const reconnectedAt = "2026-07-25T12:01:00.000Z";

    await expect(
      repository.completeWebSocketGap("wallet-1", disconnectedAt, reconnectedAt),
    ).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          lastExternalId: disconnectedAt,
          status: "GAP_DETECTED",
          walletAddressId: "wallet-1",
        }),
      }),
    );
    expect(walletUpdate).toHaveBeenCalledOnce();
  });

  it("records a WebSocket gap only when it cannot rewind a newer cursor", async () => {
    const updateMany = vi.fn(async (_input: unknown) => ({ count: 1 }));
    const database = {
      dataSource: {
        upsert: vi.fn(async () => ({ id: "source-1" })),
      },
      syncCursor: {
        updateMany,
      },
    } as unknown as PrismaClient;
    const repository = new HyperliquidRepository(
      database,
      "hyperliquid-mainnet",
      "Hyperliquid Mainnet",
    );
    const disconnectedAt = "2026-07-25T12:05:00.000Z";

    await expect(repository.recordWebSocketGap("wallet-1", disconnectedAt)).resolves.toBe(true);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lastExternalId: disconnectedAt,
          status: "GAP_DETECTED",
        }),
        where: expect.objectContaining({
          AND: expect.arrayContaining([
            expect.objectContaining({
              OR: expect.arrayContaining([
                { lastTimestamp: null },
                { lastTimestamp: { lte: new Date(disconnectedAt) } },
              ]),
            }),
            expect.objectContaining({
              OR: expect.arrayContaining([
                { lastExternalId: null },
                { lastExternalId: { lte: disconnectedAt } },
              ]),
            }),
          ]),
          walletAddressId: "wallet-1",
        }),
      }),
    );
  });

  it("reports a rejected WebSocket gap cursor update as unsuccessful", async () => {
    const database = {
      dataSource: {
        upsert: vi.fn(async () => ({ id: "source-1" })),
      },
      syncCursor: {
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    } as unknown as PrismaClient;
    const repository = new HyperliquidRepository(
      database,
      "hyperliquid-mainnet",
      "Hyperliquid Mainnet",
    );

    await expect(
      repository.recordWebSocketGap("wallet-1", "2026-07-25T12:05:00.000Z"),
    ).resolves.toBe(false);
  });

  it("does not move a durable cursor backwards during older gap recovery", async () => {
    const syncCursorUpsert = vi.fn(async (_input: unknown) => undefined);
    const database = {
      dataSource: {
        upsert: vi.fn(async () => ({ id: "source-1" })),
      },
      syncCursor: {
        findUnique: vi.fn(async () => ({
          lastExternalId: "newer",
          lastTimestamp: new Date("2026-07-25T12:10:00.000Z"),
        })),
        upsert: syncCursorUpsert,
      },
      walletAddress: {
        update: vi.fn(async () => undefined),
      },
    } as unknown as PrismaClient;
    const repository = new HyperliquidRepository(
      database,
      "hyperliquid-mainnet",
      "Hyperliquid Mainnet",
    );

    await repository.completeCursor(
      "wallet-1",
      "fills",
      "timestamp",
      new Date("2026-07-25T12:05:00.000Z"),
      "older",
    );

    const input = syncCursorUpsert.mock.calls[0]?.[0] as CursorUpsertInput | undefined;
    expect(input?.update).not.toHaveProperty("lastTimestamp");
    expect(input?.update).not.toHaveProperty("lastExternalId");
    expect(input?.update.status).toBe("SUCCEEDED");
  });

  it("rejects an out-of-order position snapshot instead of rewinding current state", async () => {
    const transaction = vi.fn(async (_operation: unknown) => undefined);
    const qualityUpsert = vi.fn(async (_input: unknown) => undefined);
    const database = {
      $transaction: transaction,
      dataQualityIssue: { upsert: qualityUpsert },
      dataSource: {
        upsert: vi.fn(async () => ({ id: "source-1" })),
      },
      perpPosition: {
        findFirst: vi.fn(async () => ({
          updatedExternalAt: new Date("2026-07-25T12:10:00.000Z"),
        })),
      },
    } as unknown as PrismaClient;
    const repository = new HyperliquidRepository(
      database,
      "hyperliquid-mainnet",
      "Hyperliquid Mainnet",
    );

    await repository.savePositions(
      "wallet-1",
      "0x1111111111111111111111111111111111111111",
      { assetPositions: [] } as unknown as HyperliquidClearinghouseState,
      new Date("2026-07-25T12:05:00.000Z"),
    );

    expect(transaction).not.toHaveBeenCalled();
    expect(qualityUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          issueType: "HYPERLIQUID_OUT_OF_ORDER_POSITION_SNAPSHOT",
        }),
      }),
    );
  });
});
