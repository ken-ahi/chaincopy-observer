import { type PrismaClient } from "@chaincopy/database";
import { hyperliquidDiscoveryJobNames, type HyperliquidDiscoveryJobData } from "@chaincopy/domain";
import { type Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import {
  CandidateActionConflictError,
  CandidateNotFoundError,
  PrismaDiscoveryService,
} from "./discovery-service.js";

const address = "0x1111111111111111111111111111111111111111";

describe("PrismaDiscoveryService manual exclusion", () => {
  it.each(["PENDING", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED", "RATE_LIMITED"])(
    "excludes a candidate while enrichment is %s",
    async (enrichmentStatus) => {
      const fixture = createFixture({
        enrichmentStatus,
        exclusionReasons: ["INSUFFICIENT_HISTORY"],
        filterStatus: "INSUFFICIENT_HISTORY",
      });

      const result = await fixture.service.excludeCandidate(address);

      expect(fixture.candidate().exclusionReasons).toEqual([
        "INSUFFICIENT_HISTORY",
        "MANUALLY_EXCLUDED",
      ]);
      expect(fixture.candidate().filterStatus).toBe("EXCLUDED");
      expect(result).toMatchObject({
        candidate: {
          exclusionReasons: ["INSUFFICIENT_HISTORY", "MANUALLY_EXCLUDED"],
          filterStatus: "EXCLUDED",
        },
        status: "EXCLUDED",
      });
      expect(Object.keys(result).sort()).toEqual(["candidate", "status"]);
    },
  );

  it("treats an already manually excluded candidate idempotently", async () => {
    const fixture = createFixture({
      exclusionReasons: ["MANUALLY_EXCLUDED"],
      filterStatus: "EXCLUDED",
    });

    const result = await fixture.service.excludeCandidate(address);

    expect(fixture.updateMany).not.toHaveBeenCalled();
    expect(fixture.candidate().exclusionReasons).toEqual(["MANUALLY_EXCLUDED"]);
    expect(result).toMatchObject({
      candidate: {
        exclusionReasons: ["MANUALLY_EXCLUDED"],
        filterStatus: "EXCLUDED",
      },
      status: "EXCLUDED",
    });
  });

  it("restores EXCLUDED when an existing manual exclusion has a stale filter status", async () => {
    const fixture = createFixture({
      exclusionReasons: ["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"],
      filterStatus: "PENDING",
    });

    const result = await fixture.service.excludeCandidate(address);

    expect(fixture.candidate()).toMatchObject({
      exclusionReasons: ["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"],
      filterStatus: "EXCLUDED",
    });
    expect(result).toMatchObject({
      candidate: {
        exclusionReasons: ["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"],
        filterStatus: "EXCLUDED",
      },
      status: "EXCLUDED",
    });
  });

  it.each(["QUEUED", "RUNNING"])(
    "removes only MANUALLY_EXCLUDED and queues re-evaluation while enrichment is %s",
    async (enrichmentStatus) => {
      const fixture = createFixture({
        enrichmentStatus,
        exclusionReasons: ["INSUFFICIENT_HISTORY", "MANUALLY_EXCLUDED"],
        filterStatus: "EXCLUDED",
      });

      const result = await fixture.service.unexcludeCandidate(address);

      expect(fixture.candidate().exclusionReasons).toEqual(["INSUFFICIENT_HISTORY"]);
      expect(fixture.candidate().filterStatus).toBe("PENDING");
      expect(fixture.jobs).toHaveLength(1);
      expect(fixture.jobs[0]).toMatchObject({
        data: {
          address,
          automatic: false,
          candidateId: "candidate-1",
          kind: "candidate",
        },
        name: hyperliquidDiscoveryJobNames.candidateFilter,
      });
      expect(fixture.jobs[0]?.options.jobId).toBe(
        "filter-candidate-1-manual-unexclude-1785196800000",
      );
      expect(result).toMatchObject({
        candidate: {
          exclusionReasons: ["INSUFFICIENT_HISTORY"],
          filterStatus: "PENDING",
        },
        jobId: "filter-candidate-1-manual-unexclude-1785196800000",
        status: "QUEUED",
      });
      expect(Object.keys(result).sort()).toEqual(["candidate", "jobId", "status"]);
    },
  );

  it("restores the exclusion when filter queue registration fails", async () => {
    const fixture = createFixture(
      {
        exclusionReasons: ["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"],
        filterStatus: "EXCLUDED",
      },
      { queueFailure: true },
    );

    await expect(fixture.service.unexcludeCandidate(address)).rejects.toThrow(
      "candidate filter queue failed",
    );

    expect(fixture.candidate().exclusionReasons).toEqual(["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"]);
    expect(fixture.candidate().filterStatus).toBe("EXCLUDED");
    expect(fixture.updateMany).toHaveBeenCalledTimes(2);
  });

  it.each([
    { promotedAt: new Date("2026-07-27T00:00:00.000Z") },
    { promotedWalletId: "wallet-1" },
  ])("rejects exclusion changes for a promoted candidate", async (promotion) => {
    const fixture = createFixture({
      ...promotion,
      exclusionReasons: ["MANUALLY_EXCLUDED"],
      filterStatus: "EXCLUDED",
    });

    await expect(fixture.service.excludeCandidate(address)).rejects.toBeInstanceOf(
      CandidateActionConflictError,
    );
    await expect(fixture.service.unexcludeCandidate(address)).rejects.toBeInstanceOf(
      CandidateActionConflictError,
    );
    expect(fixture.updateMany).not.toHaveBeenCalled();
  });

  it("rejects exclusion changes for a candidate already added to monitoring", async () => {
    const fixture = createFixture(
      {
        exclusionReasons: ["MANUALLY_EXCLUDED"],
        filterStatus: "EXCLUDED",
      },
      { watched: true },
    );

    await expect(fixture.service.unexcludeCandidate(address)).rejects.toBeInstanceOf(
      CandidateActionConflictError,
    );
    expect(fixture.updateMany).not.toHaveBeenCalled();
    expect(fixture.jobs).toHaveLength(0);
  });

  it.each(["exclude", "unexclude"] as const)(
    "rejects an %s optimistic-lock conflict",
    async (action) => {
      const fixture = createFixture(
        {
          exclusionReasons:
            action === "unexclude" ? ["MANUALLY_EXCLUDED"] : ["AUTOMATIC_REASON"],
          filterStatus: action === "unexclude" ? "EXCLUDED" : "PENDING",
        },
        { updateConflict: true },
      );

      await expect(
        action === "exclude"
          ? fixture.service.excludeCandidate(address)
          : fixture.service.unexcludeCandidate(address),
      ).rejects.toMatchObject({
        code: "CANDIDATE_STATE_CHANGED",
        name: "CandidateActionConflictError",
      });
      expect(fixture.jobs).toHaveLength(0);
    },
  );

  it("does not roll back a newer concurrent state when queue registration fails", async () => {
    const fixture = createFixture(
      {
        exclusionReasons: ["AUTOMATIC_REASON", "MANUALLY_EXCLUDED"],
        filterStatus: "EXCLUDED",
      },
      { queueFailure: true, rollbackConflict: true },
    );

    await expect(fixture.service.unexcludeCandidate(address)).rejects.toMatchObject({
      code: "CANDIDATE_STATE_CHANGED",
      name: "CandidateActionConflictError",
    });
  });

  it("returns not found for an unknown candidate", async () => {
    const fixture = createFixture();
    fixture.findFirst.mockResolvedValueOnce(null);

    await expect(fixture.service.unexcludeCandidate(address)).rejects.toBeInstanceOf(
      CandidateNotFoundError,
    );
  });

  it("returns a stable conflict code when unexclude is requested without manual exclusion", async () => {
    const fixture = createFixture({
      exclusionReasons: ["AUTOMATIC_REASON"],
      filterStatus: "EXCLUDED",
    });

    await expect(fixture.service.unexcludeCandidate(address)).rejects.toMatchObject({
      code: "CANDIDATE_NOT_MANUALLY_EXCLUDED",
      name: "CandidateActionConflictError",
    });
  });
});

interface CandidateRow {
  activeDays: number;
  activeHours: number;
  address: string;
  availableFrom: Date | null;
  availableTo: Date | null;
  averageTradeUsd: DecimalStub;
  buyCount: number;
  dataQualityScore: number;
  discoverySource: string;
  distinctCoins: number;
  enrichmentStatus: string;
  estimatedNotionalUsd: DecimalStub;
  exclusionReasons: Array<string>;
  filterStatus: string;
  firstSeenAt: Date;
  historyCompleteness: string;
  historyTruncated: boolean;
  id: string;
  largestTradeUsd: DecimalStub;
  lastEnrichedAt: Date | null;
  lastSeenAt: Date;
  longRelatedCount: number;
  makerCount: number;
  nextEnrichmentAt: Date | null;
  promotedAt: Date | null;
  promotedWalletId: string | null;
  retrievedFillCount: number;
  sellCount: number;
  shortRelatedCount: number;
  sourceId: string;
  takerCount: number;
  tradeCount: number;
  truncationReason: string | null;
  updatedAt: Date;
}

interface DecimalStub {
  toFixed(): string;
}

function createFixture(
  overrides: Partial<CandidateRow> = {},
  options: {
    readonly queueFailure?: boolean;
    readonly rollbackConflict?: boolean;
    readonly updateConflict?: boolean;
    readonly watched?: boolean;
  } = {},
): {
  candidate: () => CandidateRow;
  findFirst: ReturnType<typeof vi.fn>;
  jobs: Array<{
    data: HyperliquidDiscoveryJobData;
    name: string;
    options: { jobId?: string };
  }>;
  service: PrismaDiscoveryService;
  updateMany: ReturnType<typeof vi.fn>;
} {
  let candidate = candidateRow(overrides);
  const findFirst = vi.fn(async () => candidate);
  let updateCall = 0;
  const updateMany = vi.fn(async ({ data }: { data: Partial<CandidateRow> }) => {
    updateCall += 1;
    if (
      (options.updateConflict && updateCall === 1) ||
      (options.rollbackConflict && updateCall === 2)
    ) {
      return { count: 0 };
    }
    candidate = {
      ...candidate,
      ...data,
      updatedAt: new Date(candidate.updatedAt.getTime() + 1),
    };
    return { count: 1 };
  });
  const database = {
    addressCandidate: {
      findFirst,
      findUniqueOrThrow: vi.fn(async () => candidate),
      updateMany,
    },
    walletAddress: {
      findFirst: vi.fn(async () => (options.watched ? { id: "wallet-1" } : null)),
    },
  } as unknown as PrismaClient;
  const jobs: Array<{
    data: HyperliquidDiscoveryJobData;
    name: string;
    options: { jobId?: string };
  }> = [];
  const queue = {
    add: vi.fn(
      async (name: string, data: HyperliquidDiscoveryJobData, jobOptions: { jobId?: string }) => {
        if (options.queueFailure) {
          throw new Error("candidate filter queue failed");
        }
        jobs.push({ data, name, options: jobOptions });
        return { id: jobOptions.jobId };
      },
    ),
  } as unknown as Queue<HyperliquidDiscoveryJobData>;

  return {
    candidate: () => candidate,
    findFirst,
    jobs,
    service: new PrismaDiscoveryService(database, queue, queue),
    updateMany,
  };
}

function candidateRow(overrides: Partial<CandidateRow>): CandidateRow {
  return {
    activeDays: 2,
    activeHours: 4,
    address,
    availableFrom: null,
    availableTo: null,
    averageTradeUsd: decimal("100"),
    buyCount: 5,
    dataQualityScore: 80,
    discoverySource: "HYPERLIQUID_MARKET_TRADES",
    distinctCoins: 2,
    enrichmentStatus: "PENDING",
    estimatedNotionalUsd: decimal("10000"),
    exclusionReasons: [],
    filterStatus: "LIGHT_ELIGIBLE",
    firstSeenAt: new Date("2026-07-26T00:00:00.000Z"),
    historyCompleteness: "UNKNOWN",
    historyTruncated: false,
    id: "candidate-1",
    largestTradeUsd: decimal("5000"),
    lastEnrichedAt: null,
    lastSeenAt: new Date("2026-07-27T00:00:00.000Z"),
    longRelatedCount: 3,
    makerCount: 4,
    nextEnrichmentAt: null,
    promotedAt: null,
    promotedWalletId: null,
    retrievedFillCount: 0,
    sellCount: 5,
    shortRelatedCount: 2,
    sourceId: "source-1",
    takerCount: 6,
    tradeCount: 10,
    truncationReason: null,
    updatedAt: new Date("2026-07-28T00:00:00.000Z"),
    ...overrides,
  };
}

function decimal(value: string): DecimalStub {
  return { toFixed: () => value };
}
