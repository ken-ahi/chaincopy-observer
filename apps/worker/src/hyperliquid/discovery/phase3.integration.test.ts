import { randomUUID } from "node:crypto";

import { loadRootEnvironment } from "@chaincopy/config";
import { PrismaClient } from "@chaincopy/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { HyperliquidDiscoveryRepository } from "./repository.js";

loadRootEnvironment();

const databaseUrl = localServiceUrl(
  process.env.DATABASE_URL ??
    "postgresql://chaincopy:chaincopy@127.0.0.1:5432/chaincopy?schema=public",
);
const database = new PrismaClient({
  datasources: { db: { url: databaseUrl } },
});
const runId = randomUUID();
const sourceKey = `phase3-discovery-${runId}`;
const buyer = `0x${runId.replaceAll("-", "").slice(0, 32)}11111111`;
const seller = `0x${runId.replaceAll("-", "").slice(0, 32)}22222222`;
const third = `0x${runId.replaceAll("-", "").slice(0, 32)}33333333`;
let sourceId = "";
let repository: HyperliquidDiscoveryRepository;

describe.sequential("Phase 3 candidate persistence integration", () => {
  beforeAll(async () => {
    await database.$queryRaw`SELECT 1`;
    const source = await database.dataSource.create({
      data: {
        enabled: true,
        key: sourceKey,
        kind: "HYPERLIQUID",
        name: "Phase 3 discovery integration",
      },
    });
    sourceId = source.id;
    repository = new HyperliquidDiscoveryRepository(database, source.id);
    await repository.ensureInfrastructure({
      enabled: false,
      minimumEnrichmentIntervalMin: 1_440,
      minimumObservedNotionalUsd: "10000",
      minimumObservedTradeCount: 10,
      mode: "MAJOR",
      priorityCoins: ["BTC", "ETH"],
      recentActivityHours: 24,
    });
  });

  afterAll(async () => {
    await database.walletAddress.deleteMany({ where: { sourceId } });
    await database.addressCandidate.deleteMany({ where: { sourceId } });
    await database.discoveryTrade.deleteMany({ where: { sourceId } });
    await database.dataSource.deleteMany({ where: { id: sourceId } });
    await database.$disconnect();
  });

  it("upserts buyer and seller once and aggregates exact notionals across coins", async () => {
    const first = marketTrade({
      buyerAddress: buyer,
      coin: "BTC",
      externalTradeId: "1721862400000:BTC:1",
      fingerprint: `fingerprint-${runId}-1`,
      notionalUsd: "10000.000000000000000001",
      occurredAt: "2026-07-25T12:00:00.000Z",
      sellerAddress: seller,
      side: "BUY",
      tradeId: "1",
    });
    expect(await repository.upsertTrade(first)).toMatchObject({
      candidates: [{ address: buyer }, { address: seller }],
      duplicate: false,
    });
    expect(await repository.upsertTrade(first)).toMatchObject({
      candidates: [{ address: buyer }, { address: seller }],
      duplicate: true,
    });

    await repository.upsertTrade(
      marketTrade({
        buyerAddress: buyer,
        coin: "ETH",
        externalTradeId: "1721862460000:ETH:2",
        fingerprint: `fingerprint-${runId}-2`,
        notionalUsd: "2500.000000000000000009",
        occurredAt: "2026-07-25T12:01:00.000Z",
        sellerAddress: third,
        side: "SELL",
        tradeId: "2",
      }),
    );

    const candidate = await database.addressCandidate.findUniqueOrThrow({
      where: { sourceId_address: { address: buyer, sourceId } },
    });
    expect(candidate.tradeCount).toBe(2);
    expect(candidate.estimatedNotionalUsd.toFixed()).toBe("12500.00000000000000001");
    expect(candidate.distinctCoins).toBe(2);
    expect(candidate.buyCount).toBe(2);
    expect(candidate.makerCount).toBe(1);
    expect(candidate.takerCount).toBe(1);
  });

  it("counts a buyer-seller self trade once and never rewinds the discovery cursor", async () => {
    await repository.upsertTrade(
      marketTrade({
        buyerAddress: buyer,
        coin: "BTC",
        externalTradeId: "1721862520000:BTC:3",
        fingerprint: `fingerprint-${runId}-3`,
        notionalUsd: "100",
        occurredAt: "2026-07-25T12:02:00.000Z",
        sellerAddress: buyer,
        side: "SELL",
        tradeId: "3",
      }),
    );
    await repository.upsertTrade(
      marketTrade({
        buyerAddress: buyer,
        coin: "BTC",
        externalTradeId: "1721862399000:BTC:4",
        fingerprint: `fingerprint-${runId}-4`,
        notionalUsd: "50",
        occurredAt: "2026-07-25T11:59:59.000Z",
        sellerAddress: third,
        side: "BUY",
        tradeId: "4",
      }),
    );

    const [candidate, selfParticipations, cursor, stats] = await Promise.all([
      database.addressCandidate.findUniqueOrThrow({
        where: { sourceId_address: { address: buyer, sourceId } },
      }),
      database.candidateTradeParticipation.count({
        where: { candidate: { address: buyer, sourceId }, role: "SELF" },
      }),
      database.discoveryCursor.findUniqueOrThrow({
        where: {
          sourceId_scope_cursorType: {
            cursorType: "timestamp",
            scope: "market-trades",
            sourceId,
          },
        },
      }),
      database.discoveryStats.findUniqueOrThrow({ where: { sourceId } }),
    ]);
    expect(candidate.tradeCount).toBe(4);
    expect(selfParticipations).toBe(1);
    expect(cursor.lastTimestamp?.toISOString()).toBe("2026-07-25T12:02:00.000Z");
    expect(cursor.lastExternalId).toBe("1721862520000:BTC:3");
    expect(stats.lastEventAt?.toISOString()).toBe("2026-07-25T12:02:00.000Z");
  });

  it("records a restart gap from the persisted cursor without moving it forward", async () => {
    const reconnectedAt = new Date("2026-07-25T12:03:00.000Z");
    await expect(repository.recordDiscoveryStartupGap(reconnectedAt)).resolves.toEqual(
      new Date("2026-07-25T12:02:00.000Z"),
    );

    const [cursor, issue] = await Promise.all([
      database.discoveryCursor.findUniqueOrThrow({
        where: {
          sourceId_scope_cursorType: {
            cursorType: "timestamp",
            scope: "market-trades",
            sourceId,
          },
        },
      }),
      database.discoveryDataQualityIssue.findFirstOrThrow({
        where: { issueType: "HYPERLIQUID_DISCOVERY_GAP", sourceId },
      }),
    ]);
    expect(cursor).toMatchObject({
      lastTimestamp: new Date("2026-07-25T12:02:00.000Z"),
      status: "GAP_DETECTED",
    });
    expect(issue.details).toMatchObject({
      disconnectedAt: "2026-07-25T12:02:00.000Z",
      reconnectedAt: "2026-07-25T12:03:00.000Z",
      recovery: "UNAVAILABLE_FROM_FREE_MARKET_API",
    });
  });

  it("records every WebSocket receipt while separating duplicate observations", async () => {
    const before = await database.discoveryStats.findUniqueOrThrow({ where: { sourceId } });
    await repository.recordReceivedTradeEvents(3);
    await repository.recordDuplicateTradeEvents(2);
    const after = await database.discoveryStats.findUniqueOrThrow({ where: { sourceId } });

    expect(after.receivedTradeEvents - before.receivedTradeEvents).toBe(3n);
    expect(after.duplicateTradeEvents - before.duplicateTradeEvents).toBe(2n);
  });

  it("serializes concurrent market updates without losing candidate aggregates", async () => {
    const before = await database.addressCandidate.findUniqueOrThrow({
      where: { sourceId_address: { address: buyer, sourceId } },
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        repository.upsertTrade(
          marketTrade({
            buyerAddress: buyer,
            coin: index % 2 === 0 ? "BTC" : "ETH",
            externalTradeId: `17218626${String(index).padStart(2, "0")}:BTC:${100 + index}`,
            fingerprint: `fingerprint-${runId}-concurrent-${index}`,
            notionalUsd: "25",
            occurredAt: `2026-07-25T12:03:${String(index).padStart(2, "0")}.000Z`,
            sellerAddress: seller,
            side: index % 2 === 0 ? "BUY" : "SELL",
            tradeId: String(100 + index),
          }),
        ),
      ),
    );
    const after = await database.addressCandidate.findUniqueOrThrow({
      where: { sourceId_address: { address: buyer, sourceId } },
    });

    expect(after.tradeCount - before.tradeCount).toBe(8);
    expect(after.estimatedNotionalUsd.minus(before.estimatedNotionalUsd).toFixed()).toBe("200");
    expect(
      results.some((result) =>
        result.candidates.some((candidate) => candidate.address === buyer && candidate.filterReady),
      ),
    ).toBe(true);
  });

  it("preserves a manual exclusion when a lightweight filter runs later", async () => {
    const candidate = await createCandidate("00000001", {
      exclusionReasons: ["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"],
      filterStatus: "EXCLUDED",
    });

    await expect(repository.updateLightFilter(candidate.id, "LIGHT_ELIGIBLE", [])).resolves.toBe(
      false,
    );

    await expect(
      database.addressCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
    ).resolves.toMatchObject({
      exclusionReasons: ["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"],
      filterStatus: "EXCLUDED",
    });
  });

  it("preserves manual and automatic reasons when a full filter runs later", async () => {
    const candidate = await createCandidate("00000002", {
      enrichmentStatus: "SUCCEEDED",
      exclusionReasons: ["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"],
      filterStatus: "EXCLUDED",
    });

    await expect(
      repository.updateFullFilter(
        candidate.id,
        fullFilterResult(["FULL_FILTER_REASON"], "ELIGIBLE"),
        0,
        100,
        false,
      ),
    ).resolves.toBe(false);

    const updated = await database.addressCandidate.findUniqueOrThrow({
      where: { id: candidate.id },
    });
    expect(updated.filterStatus).toBe("EXCLUDED");
    expect(updated.exclusionReasons).toEqual([
      "AUTOMATIC_REASON",
      "MANUALLY_EXCLUDED",
      "FULL_FILTER_REASON",
    ]);
  });

  it("does not overwrite a manual exclusion added after filter context was read", async () => {
    const candidate = await createCandidate("00000003");
    const context = await repository.getCandidateFilterContext(candidate.id);
    expect(context.candidate.exclusionReasons).not.toContain("MANUALLY_EXCLUDED");
    await database.addressCandidate.update({
      data: {
        exclusionReasons: ["MANUALLY_EXCLUDED"],
        filterStatus: "EXCLUDED",
      },
      where: { id: candidate.id },
    });

    await expect(repository.updateLightFilter(candidate.id, "LIGHT_ELIGIBLE", [])).resolves.toBe(
      false,
    );

    await expect(
      database.addressCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
    ).resolves.toMatchObject({
      exclusionReasons: ["MANUALLY_EXCLUDED"],
      filterStatus: "EXCLUDED",
    });
  });

  it("does not queue enrichment for a manually excluded candidate", async () => {
    const candidate = await createCandidate("00000004", {
      exclusionReasons: ["MANUALLY_EXCLUDED"],
      filterStatus: "EXCLUDED",
    });

    await expect(repository.markEnrichmentQueued(candidate.id)).resolves.toBe(false);
    await expect(
      database.addressCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
    ).resolves.toMatchObject({
      enrichmentStatus: "PENDING",
      exclusionReasons: ["MANUALLY_EXCLUDED"],
    });
  });

  it("does not queue enrichment for an address already being monitored", async () => {
    const candidate = await createCandidate("00000005");
    await database.walletAddress.create({
      data: {
        address: candidate.address,
        isWatched: true,
        sourceId,
      },
    });

    await expect(repository.markEnrichmentQueued(candidate.id)).resolves.toBe(false);
    await expect(
      database.addressCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
    ).resolves.toMatchObject({ enrichmentStatus: "PENDING" });
  });

  it("suppresses beginEnrichment without clearing manual exclusion reasons", async () => {
    const candidate = await createCandidate("00000006", {
      enrichmentStatus: "QUEUED",
      exclusionReasons: ["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"],
      filterStatus: "EXCLUDED",
    });

    await expect(
      repository.beginEnrichment(
        candidate.id,
        new Date("2021-07-26T00:00:00.000Z"),
        new Date("2026-07-26T00:00:00.000Z"),
      ),
    ).resolves.toBeNull();

    await expect(
      database.addressCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
    ).resolves.toMatchObject({
      enrichmentStatus: "QUEUED",
      exclusionReasons: ["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"],
    });
    await expect(
      database.candidateEnrichmentAttempt.count({ where: { candidateId: candidate.id } }),
    ).resolves.toBe(0);
  });

  it("allows filtering again after the manual exclusion is explicitly removed", async () => {
    const candidate = await createCandidate("00000007", {
      exclusionReasons: ["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"],
      filterStatus: "EXCLUDED",
    });
    await database.addressCandidate.update({
      data: {
        exclusionReasons: ["AUTOMATIC_REASON"],
        filterStatus: "PENDING",
      },
      where: { id: candidate.id },
    });

    await expect(repository.updateLightFilter(candidate.id, "LIGHT_ELIGIBLE", [])).resolves.toBe(
      true,
    );
    await expect(
      database.addressCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
    ).resolves.toMatchObject({
      exclusionReasons: [],
      filterStatus: "LIGHT_ELIGIBLE",
    });
  });

  it("recovers an interrupted enrichment exactly once", async () => {
    const candidate = await database.addressCandidate.findUniqueOrThrow({
      where: { sourceId_address: { address: seller, sourceId } },
    });
    const attempt = await database.candidateEnrichmentAttempt.create({
      data: {
        candidateId: candidate.id,
        requestedFrom: new Date("2021-07-26T00:00:00.000Z"),
        requestedTo: new Date("2026-07-26T00:00:00.000Z"),
      },
    });
    await database.addressCandidate.update({
      data: { enrichmentStatus: "RUNNING" },
      where: { id: candidate.id },
    });
    const statsBefore = await database.discoveryStats.findUniqueOrThrow({
      where: { sourceId },
    });

    await expect(repository.failInterruptedEnrichment(candidate.id, "job stalled")).resolves.toBe(
      true,
    );
    await expect(
      repository.failInterruptedEnrichment(candidate.id, "duplicate event"),
    ).resolves.toBe(false);

    const [updatedCandidate, updatedAttempt, statsAfter] = await Promise.all([
      database.addressCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
      database.candidateEnrichmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
      database.discoveryStats.findUniqueOrThrow({ where: { sourceId } }),
    ]);
    expect(updatedCandidate.enrichmentStatus).toBe("FAILED");
    expect(updatedAttempt.finishedAt).not.toBeNull();
    expect(updatedAttempt.errorMessage).toBe("job stalled");
    expect(statsAfter.enrichmentFailed - statsBefore.enrichmentFailed).toBe(1n);
  });

  it("closes an unfinished attempt before starting its retry", async () => {
    const candidate = await database.addressCandidate.findUniqueOrThrow({
      where: { sourceId_address: { address: seller, sourceId } },
    });
    const requestedFrom = new Date("2021-07-26T00:00:00.000Z");
    const requestedTo = new Date("2026-07-26T00:00:00.000Z");
    const first = await repository.beginEnrichment(candidate.id, requestedFrom, requestedTo);
    const second = await repository.beginEnrichment(candidate.id, requestedFrom, requestedTo);

    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    if (!first || !second) {
      throw new Error("Expected both enrichment attempts to start.");
    }
    const firstAttempt = await database.candidateEnrichmentAttempt.findUniqueOrThrow({
      where: { id: first.attemptId },
    });
    expect(firstAttempt).toMatchObject({
      errorMessage: "Superseded by a retried candidate enrichment attempt.",
      succeeded: false,
    });
    expect(firstAttempt.finishedAt).not.toBeNull();
    await repository.failEnrichment(candidate.id, second.attemptId, "test cleanup", false);
  });

  it("recovers unfinished attempts whose candidate is no longer running", async () => {
    const candidate = await database.addressCandidate.findUniqueOrThrow({
      where: { sourceId_address: { address: seller, sourceId } },
    });
    const attempt = await database.candidateEnrichmentAttempt.create({
      data: {
        candidateId: candidate.id,
        requestedFrom: new Date("2021-07-26T00:00:00.000Z"),
        requestedTo: new Date("2026-07-26T00:00:00.000Z"),
      },
    });
    await database.addressCandidate.update({
      data: { enrichmentStatus: "SUCCEEDED" },
      where: { id: candidate.id },
    });

    await expect(repository.closeOrphanedEnrichmentAttempts()).resolves.toBe(1);
    await expect(
      database.candidateEnrichmentAttempt.findUniqueOrThrow({ where: { id: attempt.id } }),
    ).resolves.toMatchObject({
      errorMessage: "Recovered unfinished attempt after Worker restart.",
      succeeded: false,
    });
  });

  it("fails a running candidate when startup recovers its unfinished attempt", async () => {
    const candidate = await database.addressCandidate.findUniqueOrThrow({
      where: { sourceId_address: { address: seller, sourceId } },
    });
    await database.candidateEnrichmentAttempt.create({
      data: {
        candidateId: candidate.id,
        requestedFrom: new Date("2021-07-26T00:00:00.000Z"),
        requestedTo: new Date("2026-07-26T00:00:00.000Z"),
      },
    });
    await database.addressCandidate.update({
      data: { enrichmentStatus: "RUNNING" },
      where: { id: candidate.id },
    });
    const statsBefore = await database.discoveryStats.findUniqueOrThrow({
      where: { sourceId },
    });

    await expect(repository.closeOrphanedEnrichmentAttempts()).resolves.toBe(1);

    const [updatedCandidate, statsAfter] = await Promise.all([
      database.addressCandidate.findUniqueOrThrow({ where: { id: candidate.id } }),
      database.discoveryStats.findUniqueOrThrow({ where: { sourceId } }),
    ]);
    expect(updatedCandidate.enrichmentStatus).toBe("FAILED");
    expect(statsAfter.enrichmentFailed - statsBefore.enrichmentFailed).toBe(1n);
  });

  it("promotes an eligible candidate idempotently into one watched wallet", async () => {
    const candidate = await database.addressCandidate.update({
      data: { filterStatus: "ELIGIBLE" },
      where: { sourceId_address: { address: buyer, sourceId } },
    });
    const first = await repository.promoteCandidate(candidate.id);
    const duplicate = await repository.promoteCandidate(candidate.id);

    expect(first.alreadyPromoted).toBe(false);
    expect(duplicate).toMatchObject({
      alreadyPromoted: true,
      walletAddressId: first.walletAddressId,
    });
    await expect(
      database.walletAddress.count({ where: { address: buyer, sourceId } }),
    ).resolves.toBe(1);
  });
});

async function createCandidate(
  suffix: string,
  data: Partial<{
    enrichmentStatus: "PENDING" | "QUEUED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "RATE_LIMITED";
    exclusionReasons: Array<string>;
    filterStatus:
      "PENDING" | "LIGHT_ELIGIBLE" | "INSUFFICIENT_HISTORY" | "ELIGIBLE" | "EXCLUDED" | "PROMOTED";
  }> = {},
) {
  return database.addressCandidate.create({
    data: {
      address: `0x${runId.replaceAll("-", "").slice(0, 32)}${suffix}`,
      firstSeenAt: new Date("2026-07-25T00:00:00.000Z"),
      lastSeenAt: new Date("2026-07-26T00:00:00.000Z"),
      sourceId,
      ...data,
    },
  });
}

function fullFilterResult(
  reasons: ReadonlyArray<string>,
  status: "ELIGIBLE" | "EXCLUDED" | "INSUFFICIENT_HISTORY",
) {
  return {
    activeDays: 30,
    activeMonths: 2,
    availableFrom: new Date("2026-06-01T00:00:00.000Z"),
    availableTo: new Date("2026-07-26T00:00:00.000Z"),
    completeness: "COMPLETE" as const,
    cumulativeNotionalUsd: "100000",
    dataQualityScore: 90,
    reasons,
    status,
  };
}

function marketTrade(input: {
  readonly buyerAddress: string;
  readonly coin: string;
  readonly externalTradeId: string;
  readonly fingerprint: string;
  readonly notionalUsd: string;
  readonly occurredAt: string;
  readonly sellerAddress: string;
  readonly side: "BUY" | "SELL";
  readonly tradeId: string;
}) {
  return {
    ...input,
    price: input.notionalUsd,
    rawPayload: "{}",
    size: "1",
    transactionHash: `0x${input.tradeId}`,
  };
}

function localServiceUrl(value: string): string {
  const url = new URL(value);
  if (url.hostname === "postgres") {
    url.hostname = "127.0.0.1";
  }
  return url.toString();
}
