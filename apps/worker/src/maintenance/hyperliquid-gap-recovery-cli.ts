import { loadRootEnvironment } from "@chaincopy/config";
import { disconnectDatabase, prisma } from "@chaincopy/database";
import { hyperliquidQueueName, type HyperliquidJobData } from "@chaincopy/domain";
import { Queue, type Job } from "bullmq";
import { Redis } from "ioredis";

import { enqueueHyperliquidGapRecovery } from "../hyperliquid/queue.js";
import {
  createGapRecoveryManifest,
  gapRecoveryJobId,
  isDeterministicGapCoverageFailure,
  type GapRecoveryManifestInput,
  type GapRecoveryManifestRow,
} from "./hyperliquid-gap-recovery-policy.js";

interface Options {
  readonly enqueue: boolean;
  readonly expectedCount: number | undefined;
  readonly expectedSha256: string | undefined;
}

type ExistingState =
  | "absent"
  | "active"
  | "completed"
  | "delayed"
  | "failed"
  | "failedDeterministic"
  | "prioritized"
  | "waiting";

async function main(): Promise<void> {
  loadRootEnvironment();
  const options = parseOptions(process.argv.slice(2));
  const rows = await prisma.$queryRaw<GapRecoveryManifestInput[]>`
    SELECT
      d.id AS "dataQualityIssueId",
      d.fingerprint,
      d.wallet_address_id AS "walletAddressId",
      w.address AS "walletAddress",
      (d.details->>'disconnectedAt')::timestamptz AS "startTime",
      boundary.id AS "boundaryRawEventId",
      boundary.event_time AS "endTime"
    FROM data_quality_issues d
    JOIN wallet_addresses w ON w.id = d.wallet_address_id
    JOIN data_sources s ON s.id = w.source_id
    LEFT JOIN LATERAL (
      SELECT re.id, re.event_time
      FROM raw_events re
      WHERE re.wallet_address_id = d.wallet_address_id
        AND re.transport = 'WEBSOCKET'
        AND re.event_time > (d.details->>'disconnectedAt')::timestamptz
      ORDER BY re.event_time ASC, re.id ASC
      LIMIT 1
    ) boundary ON true
    WHERE d.status = 'OPEN'
      AND d.issue_type = 'HYPERLIQUID_WEBSOCKET_GAP'
      AND w.is_watched = true
      AND s.key = 'hyperliquid-mainnet'
  `;
  const manifest = createGapRecoveryManifest(rows);
  const summary = {
    count: manifest.count,
    dryRun: !options.enqueue,
    sha256: manifest.sha256,
    version: manifest.version,
    walletCount: manifest.walletCount,
  };
  if (!options.enqueue) {
    console.info(JSON.stringify(summary, null, 2));
    return;
  }
  if (options.expectedCount !== manifest.count || options.expectedSha256 !== manifest.sha256) {
    throw new Error(
      `Manifest approval mismatch: expected count/hash ${String(options.expectedCount)}/${String(options.expectedSha256)}, actual ${manifest.count}/${manifest.sha256}.`,
    );
  }
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl?.startsWith("redis://")) throw new Error("REDIS_URL must be a redis:// URL.");
  const redis = new Redis(redisUrl, { enableReadyCheck: true, maxRetriesPerRequest: null });
  const queue = new Queue<HyperliquidJobData>(hyperliquidQueueName, { connection: redis });
  try {
    const existing = await inspectExisting(queue, manifest.rows);
    if (existing.completed > 0) {
      throw new Error(
        `${existing.completed} completed recovery jobs still have OPEN DQ records; refusing to enqueue.`,
      );
    }
    const counts = await queue.getJobCounts("waiting", "active", "delayed", "prioritized");
    const backlog = Object.values(counts).reduce((sum, count) => sum + count, 0);
    const addedBacklog = existing.absent + existing.failed;
    if (backlog + addedBacklog > 500) {
      throw new Error(
        `Gap recovery would exceed the 500-job backlog limit (${backlog} + ${addedBacklog}).`,
      );
    }
    let enqueued = 0;
    let retried = 0;
    let alreadyPending = 0;
    let deterministicFailures = 0;
    for (const row of manifest.rows) {
      const jobId = gapRecoveryJobId(row);
      const job = await queue.getJob(jobId);
      const state = await normalizedState(job);
      if (state === "failed") {
        await job!.retry("failed");
        retried += 1;
      } else if (state === "failedDeterministic") {
        deterministicFailures += 1;
      } else if (state === "absent") {
        await enqueueHyperliquidGapRecovery(queue, toJobData(row));
        enqueued += 1;
      } else if (["active", "delayed", "prioritized", "waiting"].includes(state)) {
        alreadyPending += 1;
      } else {
        throw new Error(`Unexpected job state ${state} for ${jobId}.`);
      }
    }
    console.info(
      JSON.stringify(
        { ...summary, alreadyPending, deterministicFailures, enqueued, retried },
        null,
        2,
      ),
    );
  } finally {
    await queue.close();
    await redis.quit();
  }
}

async function inspectExisting(
  queue: Queue<HyperliquidJobData>,
  rows: ReadonlyArray<GapRecoveryManifestRow>,
): Promise<Record<ExistingState, number>> {
  const counts: Record<ExistingState, number> = {
    absent: 0,
    active: 0,
    completed: 0,
    delayed: 0,
    failed: 0,
    failedDeterministic: 0,
    prioritized: 0,
    waiting: 0,
  };
  for (const row of rows) {
    const state = await normalizedState(await queue.getJob(gapRecoveryJobId(row)));
    counts[state] += 1;
  }
  return counts;
}

async function normalizedState(job: Job<HyperliquidJobData> | undefined): Promise<ExistingState> {
  if (!job) return "absent";
  const state = await job.getState();
  if (state === "failed" && isDeterministicGapCoverageFailure(job.failedReason)) {
    return "failedDeterministic";
  }
  if (state === "unknown") return "absent";
  if (
    state === "active" ||
    state === "completed" ||
    state === "delayed" ||
    state === "failed" ||
    state === "prioritized" ||
    state === "waiting"
  ) {
    return state;
  }
  throw new Error(`Unsupported BullMQ job state ${state}.`);
}

function toJobData(row: GapRecoveryManifestRow): HyperliquidJobData {
  return {
    endTime: row.endTime,
    requestedAt: row.endTime,
    startTime: row.startTime,
    walletAddress: row.walletAddress,
    walletAddressId: row.walletAddressId,
  };
}

function parseOptions(arguments_: ReadonlyArray<string>): Options {
  const enqueue = arguments_.includes("--enqueue");
  const expectedCountArgument = arguments_.find((value) => value.startsWith("--expected-count="));
  const expectedShaArgument = arguments_.find((value) => value.startsWith("--expected-sha256="));
  const expectedCount = expectedCountArgument
    ? Number(expectedCountArgument.slice("--expected-count=".length))
    : undefined;
  const expectedSha256 = expectedShaArgument?.slice("--expected-sha256=".length);
  if (
    enqueue &&
    (!Number.isSafeInteger(expectedCount) || !expectedSha256?.match(/^[a-f0-9]{64}$/))
  ) {
    throw new Error(
      "--enqueue requires --expected-count=<integer> and --expected-sha256=<64 hex>.",
    );
  }
  return { enqueue, expectedCount, expectedSha256 };
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => disconnectDatabase());
