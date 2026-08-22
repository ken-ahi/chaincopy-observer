import { describe, expect, it, vi } from "vitest";

import type { Queue } from "bullmq";
import type { BehaviorJobData } from "@chaincopy/domain";

import type { BehaviorRepository } from "./repository.js";
import { BehaviorNormalizationService } from "./service.js";

const selected = {
  evaluatedAt: new Date("2026-08-23T00:00:00Z"),
  performanceRunId: "performance-1",
  selectionRunId: "selection-1",
  walletAddressId: "wallet-1",
};

function repository(overrides: Record<string, unknown> = {}) {
  return {
    addSelectionScope: vi.fn(),
    completeRun: vi.fn(),
    createRun: vi.fn().mockResolvedValue({ id: "run-1" }),
    hasHistoryGap: vi.fn().mockResolvedValue(false),
    listCoins: vi.fn().mockResolvedValue(["BTC"]),
    listEffectiveSelectedWallets: vi.fn().mockResolvedValue([selected]),
    loadCursor: vi.fn().mockResolvedValue(null),
    loadFillPage: vi.fn().mockResolvedValue({
      fills: [
        {
          coin: "BTC",
          id: "fill-1",
          occurredAt: new Date("2026-08-23T00:00:00Z"),
          price: "100",
          side: "BUY",
          size: "1",
          sourceTradeId: "99",
          startPosition: "0",
        },
      ],
      hasMore: false,
      incompleteTimestampGroupAt: null,
    }),
    recordIssue: vi.fn(),
    rewindForLateFill: vi.fn(),
    saveSuccessfulGroup: vi.fn(),
    ...overrides,
  };
}

function queue() {
  return {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
    getJobCounts: vi.fn().mockResolvedValue({ active: 0, delayed: 0, prioritized: 0, waiting: 0 }),
  } as unknown as Queue<BehaviorJobData>;
}

describe("BehaviorNormalizationService", () => {
  it("is a normal no-op when no current Selection Run exists", async () => {
    const repo = repository({ listEffectiveSelectedWallets: vi.fn().mockResolvedValue([]) });
    const result = await new BehaviorNormalizationService(
      repo as unknown as BehaviorRepository,
      queue(),
    ).processControl("2026-08-23T00:00:00Z");
    expect(result).toEqual({ outcome: "no-op", processedEvents: 0 });
    expect(repo.listCoins).not.toHaveBeenCalled();
  });

  it("writes stable events and separate Selection Scope", async () => {
    const repo = repository();
    const service = new BehaviorNormalizationService(
      repo as unknown as BehaviorRepository,
      queue(),
    );
    await service.processWalletCoin({
      coin: "BTC",
      kind: "wallet-coin",
      requestedAt: "2026-08-23T00:00:00Z",
      walletAddressId: "wallet-1",
    });
    selected.selectionRunId = "selection-2";
    await service.processWalletCoin({
      coin: "BTC",
      kind: "wallet-coin",
      requestedAt: "2026-08-23T00:01:00Z",
      walletAddressId: "wallet-1",
    });
    const fingerprints = (repo.saveSuccessfulGroup as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0].events[0].fingerprint,
    );
    expect(fingerprints).toEqual([fingerprints[0], fingerprints[0]]);
    expect(repo.addSelectionScope).toHaveBeenCalledTimes(2);
  });

  it("resumes without rewriting when the cursor page is empty", async () => {
    const repo = repository({
      loadCursor: vi.fn().mockResolvedValue({
        boundaryAfterPosition: "1",
        lastCompletedTimestamp: new Date("2026-08-23T00:00:00Z"),
      }),
      loadFillPage: vi
        .fn()
        .mockResolvedValue({ fills: [], hasMore: false, incompleteTimestampGroupAt: null }),
    });
    const result = await new BehaviorNormalizationService(
      repo as unknown as BehaviorRepository,
      queue(),
    ).processWalletCoin({
      coin: "BTC",
      kind: "wallet-coin",
      requestedAt: "2026-08-23T00:01:00Z",
      walletAddressId: "wallet-1",
    });
    expect(result).toEqual({ outcome: "completed", processedEvents: 0 });
    expect(repo.saveSuccessfulGroup).not.toHaveBeenCalled();
  });

  it("rewinds a bounded late-fill segment before rebuilding", async () => {
    const repo = repository();
    await new BehaviorNormalizationService(
      repo as unknown as BehaviorRepository,
      queue(),
    ).processWalletCoin({
      coin: "BTC",
      kind: "wallet-coin",
      rebuildFrom: "2026-08-22T23:59:00Z",
      requestedAt: "2026-08-23T00:01:00Z",
      walletAddressId: "wallet-1",
    });
    expect(repo.rewindForLateFill).toHaveBeenCalledWith(
      "wallet-1",
      "BTC",
      "behavior-v1",
      new Date("2026-08-22T23:59:00Z"),
    );
  });
});
