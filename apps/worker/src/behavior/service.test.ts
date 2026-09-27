import { describe, expect, it, vi } from "vitest";
import { XYZ_CL_QUOTE_CONTRACT } from "@chaincopy/blockchain-adapters";

import type { Queue } from "bullmq";
import type { BehaviorJobData } from "@chaincopy/domain";

import type { BehaviorFillRow, BehaviorRepository } from "./repository.js";
import type { BehaviorSelectionSource } from "./selection-source.js";
import { BehaviorNormalizationService } from "./service.js";
import type { BehaviorMarketResolver } from "./market-provenance.js";

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
    recordQuoteEvidence: vi.fn(),
    rewindForLateFill: vi.fn(),
    saveSuccessfulGroup: vi.fn(),
    ...overrides,
  };
}

function selectionSource(wallets = [selected]) {
  return {
    listEffectiveSelectedWallets: vi.fn().mockResolvedValue(wallets),
  } as unknown as BehaviorSelectionSource;
}

function queue() {
  return {
    add: vi.fn().mockResolvedValue({ id: "job-1" }),
    getJobCounts: vi.fn().mockResolvedValue({ active: 0, delayed: 0, prioritized: 0, waiting: 0 }),
  } as unknown as Queue<BehaviorJobData>;
}

describe("BehaviorNormalizationService", () => {
  const job = {
    coin: "BTC",
    kind: "wallet-coin" as const,
    requestedAt: "2026-09-27T00:00:00Z",
    walletAddressId: "wallet-1",
  };
  function input(overrides: Partial<BehaviorFillRow> = {}): BehaviorFillRow {
    return {
      id: "fill-1",
      coin: "BTC",
      sourceTradeId: "99",
      side: "BUY",
      startPosition: "0",
      size: "1",
      price: "100",
      occurredAt: new Date("2026-08-04T19:16:40.471Z"),
      ...overrides,
    };
  }
  function withFills(fills: readonly BehaviorFillRow[], cursorPosition: string | null = null) {
    return repository({
      loadFillPage: vi
        .fn()
        .mockResolvedValue({ fills, hasMore: false, incompleteTimestampGroupAt: null }),
      loadCursor: vi.fn().mockResolvedValue(
        cursorPosition === null
          ? null
          : {
              boundaryAfterPosition: cursorPosition,
              lastCompletedTimestamp: new Date("2026-08-03T00:38:33.720Z"),
            },
      ),
    });
  }
  function serviceFor(repo: ReturnType<typeof repository>, resolver?: BehaviorMarketResolver) {
    return new BehaviorNormalizationService(
      repo as unknown as BehaviorRepository,
      selectionSource(),
      queue(),
      resolver,
    );
  }

  const provenMarket = {
    quoteAsset: "USD",
    usdEquivalent: true,
    evidence: { contract: XYZ_CL_QUOTE_CONTRACT, fingerprint: "metadata-1", responses: [] },
  };

  it("appends proven custom events with durable provenance without changing event identity", async () => {
    const repo = withFills([
      input({ coin: "xyz:CL", feeToken: "USDC", size: "1.499", price: "72.246" }),
    ]);
    const resolver = { resolve: vi.fn().mockResolvedValue(provenMarket) };
    const service = serviceFor(repo, resolver);
    const customJob = { ...job, coin: "xyz:CL" };
    expect(await service.processWalletCoin(customJob)).toEqual({
      outcome: "completed",
      processedEvents: 1,
    });
    const first = repo.saveSuccessfulGroup.mock.calls[0]![0].events[0];
    expect(first).toMatchObject({
      notionalDeltaUsd: "108.296754",
      sourceEventId: "fill-1",
      behaviorVersion: "behavior-v1",
    });
    expect(repo.recordQuoteEvidence.mock.invocationCallOrder[0]).toBeLessThan(
      repo.saveSuccessfulGroup.mock.invocationCallOrder[0]!,
    );
    const fingerprint = repo.createRun.mock.calls[0]![0].inputFingerprint;
    resolver.resolve.mockResolvedValue({
      ...provenMarket,
      evidence: { ...provenMarket.evidence, fingerprint: "metadata-2" },
    });
    await service.processWalletCoin(customJob);
    expect(repo.createRun.mock.calls[1]![0].inputFingerprint).not.toBe(fingerprint);
    expect(repo.saveSuccessfulGroup.mock.calls[1]![0].events[0]).toEqual(first);
    repo.loadFillPage.mockResolvedValue({
      fills: [],
      hasMore: false,
      incompleteTimestampGroupAt: null,
    });
    expect(await service.processWalletCoin(customJob)).toEqual({
      outcome: "completed",
      processedEvents: 0,
    });
    expect(repo.saveSuccessfulGroup).toHaveBeenCalledTimes(2);
    expect(repo.rewindForLateFill).not.toHaveBeenCalled();
  });

  it("does not emit an event if proof persistence fails", async () => {
    const repo = withFills([input({ coin: "xyz:CL", feeToken: "USDC" })]);
    repo.recordQuoteEvidence.mockRejectedValue(new Error("evidence storage unavailable"));
    await expect(
      serviceFor(repo, { resolve: async () => provenMarket }).processWalletCoin({
        ...job,
        coin: "xyz:CL",
      }),
    ).rejects.toThrow("evidence storage unavailable");
    expect(repo.saveSuccessfulGroup).not.toHaveBeenCalled();
  });

  it("rejects conflicting or missing per-fill collateral evidence", async () => {
    for (const feeToken of ["OTHER", undefined]) {
      const repo = withFills([
        input({ coin: "xyz:CL", ...(feeToken === undefined ? {} : { feeToken }) }),
      ]);
      await serviceFor(repo, { resolve: async () => provenMarket }).processWalletCoin({
        ...job,
        coin: "xyz:CL",
      });
      expect(repo.recordIssue).toHaveBeenCalledWith(
        expect.objectContaining({ reason: "SOURCE_INCONSISTENT" }),
      );
      expect(repo.saveSuccessfulGroup).not.toHaveBeenCalled();
    }
  });

  it("reports unsupported quote, not missing boundary, for a source-proven xyz FLAT opening", async () => {
    const repo = withFills([
      input({ coin: "xyz:CL", startPosition: "0.0", size: "1.499", price: "72.246" }),
    ]);
    expect(await serviceFor(repo).processWalletCoin({ ...job, coin: "xyz:CL" })).toEqual({
      outcome: "blocked",
      processedEvents: 0,
    });
    expect(repo.recordIssue).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "UNSUPPORTED_QUOTE" }),
    );
    expect(repo.saveSuccessfulGroup).not.toHaveBeenCalled();
  });

  it.each([
    ["NaN", "INVALID_DECIMAL"],
    ["0.01601", "MISSING_BOUNDARY"],
  ])(
    "fails closed for initial position %s without inventing a boundary",
    async (startPosition, reason) => {
      const repo = withFills([input({ startPosition, side: "SELL", size: "0.01601" })]);
      await serviceFor(repo).processWalletCoin(job);
      expect(repo.recordIssue).toHaveBeenCalledWith(expect.objectContaining({ reason }));
      expect(repo.saveSuccessfulGroup).not.toHaveBeenCalled();
    },
  );

  it("does not skip an unknown prefix even when a later FLAT segment exists", async () => {
    const repo = withFills([
      input({ startPosition: "1", side: "SELL" }),
      input({ id: "later-open", occurredAt: new Date("2026-08-05T00:00:00Z") }),
    ]);
    await serviceFor(repo).processWalletCoin(job);
    expect(repo.recordIssue).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "MISSING_BOUNDARY" }),
    );
    expect(repo.saveSuccessfulGroup).not.toHaveBeenCalled();
    expect(repo.rewindForLateFill).not.toHaveBeenCalled();
  });

  it("preserves same-timestamp ambiguity rather than relabeling it as a missing boundary", async () => {
    const repo = withFills([
      input(),
      input({ id: "close1", side: "SELL", startPosition: "1" }),
      input({ id: "open2", size: "2" }),
      input({ id: "close2", side: "SELL", startPosition: "2", size: "2" }),
    ]);
    await serviceFor(repo).processWalletCoin(job);
    expect(repo.recordIssue).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "ORDERING_AMBIGUOUS" }),
    );
    expect(repo.saveSuccessfulGroup).not.toHaveBeenCalled();
  });

  it("keeps BTC stopped at the exact discontinuity, without skipping to a later FLAT", async () => {
    const repo = withFills(
      [
        input({ startPosition: "0.01601", side: "SELL", size: "0.01601", price: "64293" }),
        input({ id: "later-open", occurredAt: new Date("2026-08-05T00:00:00Z") }),
      ],
      "0",
    );
    await serviceFor(repo).processWalletCoin(job);
    expect(repo.recordIssue).toHaveBeenCalledWith(
      expect.objectContaining({
        reason: "IMPOSSIBLE_TRANSITION",
        sourceGroupAt: new Date("2026-08-04T19:16:40.471Z"),
      }),
    );
    expect(repo.saveSuccessfulGroup).not.toHaveBeenCalled();
    expect(repo.loadFillPage).toHaveBeenCalledWith(
      "wallet-1",
      "BTC",
      new Date("2026-08-03T00:38:33.720Z"),
    );
  });

  it("resumes BTC after the real missing opening is ingested, without a cursor rewind", async () => {
    const repo = withFills(
      [
        input({
          id: "recovered-open",
          size: "0.01601",
          price: "64119",
          occurredAt: new Date(1785858599780),
        }),
        input({ startPosition: "0.01601", side: "SELL", size: "0.01601", price: "64293" }),
      ],
      "0",
    );
    expect(await serviceFor(repo).processWalletCoin(job)).toEqual({
      outcome: "completed",
      processedEvents: 2,
    });
    expect(repo.recordIssue).not.toHaveBeenCalled();
    expect(repo.rewindForLateFill).not.toHaveBeenCalled();
    expect(repo.saveSuccessfulGroup).toHaveBeenLastCalledWith(
      expect.objectContaining({ afterPosition: "0" }),
    );
  });

  it("isolates an unsupported coin from a healthy coin", async () => {
    const repo = withFills([input({ coin: "xyz:CL" })]);
    const service = serviceFor(repo);
    await service.processWalletCoin({ ...job, coin: "xyz:CL" });
    repo.loadFillPage.mockResolvedValue({
      fills: [input()],
      hasMore: false,
      incompleteTimestampGroupAt: null,
    });
    expect(await service.processWalletCoin(job)).toEqual({
      outcome: "completed",
      processedEvents: 1,
    });
    expect(repo.saveSuccessfulGroup).toHaveBeenCalledTimes(1);
  });
  it("is a normal no-op when no current Selection Run exists", async () => {
    const repo = repository();
    const result = await new BehaviorNormalizationService(
      repo as unknown as BehaviorRepository,
      selectionSource([]),
      queue(),
    ).processControl("2026-08-23T00:00:00Z");
    expect(result).toEqual({ outcome: "no-op", processedEvents: 0 });
    expect(repo.listCoins).not.toHaveBeenCalled();
  });

  it("writes stable events and separate Selection Scope", async () => {
    const repo = repository();
    const service = new BehaviorNormalizationService(
      repo as unknown as BehaviorRepository,
      selectionSource(),
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
      selectionSource(),
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
      selectionSource(),
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
