import { loadRootEnvironment } from "@chaincopy/config";
import { disconnectDatabase, prisma } from "@chaincopy/database";
import {
  hyperliquidCandidateQueueName,
  hyperliquidDiscoveryQueueName,
  type HyperliquidDiscoveryJobData,
} from "@chaincopy/domain";
import { Queue } from "bullmq";
import { Redis } from "ioredis";

import { PrismaDiscoveryService } from "../../../api/src/discovery-service.js";
import {
  createFreeCandidateManifest,
  type FreeCandidateManifestRow,
} from "./hyperliquid-free-candidate-policy.js";

interface Options {
  readonly enqueue: boolean;
  readonly expectedCount: number | undefined;
  readonly expectedSha256: string | undefined;
  readonly limit: number;
  readonly maximumFillCount: number;
}

async function main(): Promise<void> {
  loadRootEnvironment();
  const options = parseOptions(process.argv.slice(2));
  const source = await prisma.dataSource.findUniqueOrThrow({
    where: { key: "hyperliquid-mainnet" },
  });
  const [discoverySettings, selectionSettings] = await Promise.all([
    prisma.discoverySettings.findUniqueOrThrow({ where: { sourceId: source.id } }),
    prisma.walletSelectionSettings.findUniqueOrThrow({ where: { sourceId: source.id } }),
  ]);
  const now = new Date();
  const evaluationBoundary = new Date(
    now.getTime() - selectionSettings.minimumEvaluationDays * 24 * 60 * 60 * 1_000,
  );
  const recentBoundary = new Date(
    now.getTime() - discoverySettings.fullRecentActivityDays * 24 * 60 * 60 * 1_000,
  );
  const candidates = await prisma.addressCandidate.findMany({
    orderBy: [{ availableFrom: "asc" }, { retrievedFillCount: "asc" }, { id: "asc" }],
    select: {
      address: true,
      availableFrom: true,
      availableTo: true,
      dataQualityScore: true,
      id: true,
      retrievedFillCount: true,
    },
    take: options.limit,
    where: {
      availableFrom: { lte: evaluationBoundary },
      availableTo: { gte: recentBoundary },
      dataQualityScore: 100,
      enrichmentStatus: "SUCCEEDED",
      filterStatus: "ELIGIBLE",
      historyCompleteness: "COMPLETE",
      historyTruncated: false,
      promotedAt: null,
      qualityIssues: { none: { status: "OPEN" } },
      retrievedFillCount: {
        gte: discoverySettings.fullMinimumTradeCount,
        lte: options.maximumFillCount,
      },
      sourceId: source.id,
    },
  });
  const rows: FreeCandidateManifestRow[] = candidates.map((candidate) => {
    if (!candidate.availableFrom || !candidate.availableTo) {
      throw new Error(`Candidate ${candidate.id} has no availability boundary.`);
    }
    return {
      address: candidate.address,
      availableFrom: candidate.availableFrom.toISOString(),
      availableTo: candidate.availableTo.toISOString(),
      candidateId: candidate.id,
      dataQualityScore: candidate.dataQualityScore,
      retrievedFillCount: candidate.retrievedFillCount,
    };
  });
  const manifest = createFreeCandidateManifest(rows);
  const summary = {
    count: manifest.count,
    dryRun: !options.enqueue,
    rows: manifest.rows,
    sha256: manifest.sha256,
    version: manifest.version,
  };
  if (!options.enqueue) {
    console.info(JSON.stringify(summary, null, 2));
    return;
  }
  if (
    manifest.count !== options.limit ||
    options.expectedCount !== manifest.count ||
    options.expectedSha256 !== manifest.sha256
  ) {
    throw new Error(
      `Candidate manifest approval mismatch: expected count/hash ${String(options.expectedCount)}/${String(options.expectedSha256)}, actual ${manifest.count}/${manifest.sha256}.`,
    );
  }
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl?.startsWith("redis://")) throw new Error("REDIS_URL must be a redis:// URL.");
  const redis = new Redis(redisUrl, { enableReadyCheck: true, maxRetriesPerRequest: null });
  const discoveryQueue = new Queue<HyperliquidDiscoveryJobData>(hyperliquidDiscoveryQueueName, {
    connection: redis,
  });
  const candidateQueue = new Queue<HyperliquidDiscoveryJobData>(hyperliquidCandidateQueueName, {
    connection: redis,
  });
  try {
    const service = new PrismaDiscoveryService(prisma, discoveryQueue, candidateQueue);
    const queueCounts = await discoveryQueue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "prioritized",
    );
    const queueBacklog = Object.values(queueCounts).reduce((sum, count) => sum + count, 0);
    if (queueBacklog + manifest.count > 100) {
      throw new Error(
        `Candidate promotion would exceed the bounded 100-job discovery backlog (${queueBacklog} + ${manifest.count}).`,
      );
    }
    const jobs = [];
    for (const row of manifest.rows) {
      jobs.push({ candidateId: row.candidateId, ...(await service.enqueuePromotion(row.address)) });
    }
    console.info(JSON.stringify({ ...summary, jobs, queueBacklogBefore: queueBacklog }, null, 2));
  } finally {
    await candidateQueue.close();
    await discoveryQueue.close();
    await redis.quit();
  }
}

function parseOptions(arguments_: ReadonlyArray<string>): Options {
  const enqueue = arguments_.includes("--enqueue");
  const limit = numericArgument(arguments_, "--limit=", 10);
  const maximumFillCount = numericArgument(arguments_, "--maximum-fill-count=", 2_500);
  const expectedCount = optionalNumericArgument(arguments_, "--expected-count=");
  const expectedSha256 = arguments_
    .find((value) => value.startsWith("--expected-sha256="))
    ?.slice("--expected-sha256=".length);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("--limit must be an integer from 1 to 25.");
  }
  if (
    !Number.isSafeInteger(maximumFillCount) ||
    maximumFillCount < 1 ||
    maximumFillCount >= 10_000
  ) {
    throw new Error("--maximum-fill-count must be an integer from 1 to 9999.");
  }
  if (
    enqueue &&
    (!Number.isSafeInteger(expectedCount) || !expectedSha256?.match(/^[a-f0-9]{64}$/))
  ) {
    throw new Error(
      "--enqueue requires --expected-count=<integer> and --expected-sha256=<64 hex>.",
    );
  }
  return { enqueue, expectedCount, expectedSha256, limit, maximumFillCount };
}

function numericArgument(
  arguments_: ReadonlyArray<string>,
  prefix: string,
  fallback: number,
): number {
  return optionalNumericArgument(arguments_, prefix) ?? fallback;
}

function optionalNumericArgument(
  arguments_: ReadonlyArray<string>,
  prefix: string,
): number | undefined {
  const value = arguments_.find((argument) => argument.startsWith(prefix));
  return value ? Number(value.slice(prefix.length)) : undefined;
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => disconnectDatabase());
