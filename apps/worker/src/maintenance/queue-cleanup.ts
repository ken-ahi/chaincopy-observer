import type { Job, Queue } from "bullmq";

const states = ["prioritized", "waiting", "delayed", "failed", "active"] as const;
const removableStates = new Set<string>(["prioritized", "waiting", "delayed", "failed"]);

type CleanupState = (typeof states)[number];
type CleanupData = {
  readonly address?: unknown;
  readonly candidateId?: unknown;
  readonly requestedAt?: unknown;
  readonly walletAddressId?: unknown;
};
type CleanupJob = Pick<Job<CleanupData>, "data" | "getState" | "id" | "name" | "remove">;

export interface QueueCleanupAdapter {
  getJobCounts(...states: CleanupState[]): Promise<Record<string, number>>;
  getJobs(states: CleanupState[], start: number, end: number, asc: boolean): Promise<CleanupJob[]>;
}

export interface QueueCleanupLog {
  readonly action: string;
  readonly [key: string]: unknown;
}

export interface QueueCleanupResult {
  readonly deleted: number;
  readonly eligible: number;
  readonly protectedActive: number;
  readonly protectedLatest: number;
}

function seriesKey(job: CleanupJob): string {
  const identity = [job.data.walletAddressId, job.data.candidateId, job.data.address].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return `${job.name}\u0000${identity ?? "<queue-wide>"}`;
}

function requestedAtMs(job: CleanupJob): number | undefined {
  if (typeof job.data.requestedAt !== "string") return undefined;
  const value = new Date(job.data.requestedAt).getTime();
  return Number.isFinite(value) ? value : undefined;
}

async function visitJobs(
  queue: QueueCleanupAdapter,
  batchSize: number,
  visitor: (state: CleanupState, job: CleanupJob) => Promise<void> | void,
): Promise<void> {
  for (const state of states) {
    let start = 0;
    while (true) {
      const jobs = await queue.getJobs([state], start, start + batchSize - 1, true);
      for (const job of jobs) await visitor(state, job);
      if (jobs.length < batchSize) break;
      start += jobs.length;
    }
  }
}

export async function cleanupQueue(input: {
  readonly batchSize: number;
  readonly before: Date;
  readonly dryRun: boolean;
  readonly log: (event: QueueCleanupLog) => void;
  readonly queue: QueueCleanupAdapter;
}): Promise<QueueCleanupResult> {
  const before = input.before.getTime();
  const latestBySeries = new Map<string, number>();
  const byName: Record<string, Record<string, number>> = {};
  let invalidRequestedAt = 0;
  await visitJobs(input.queue, input.batchSize, (state, job) => {
    const names = (byName[job.name] ??= {});
    names[state] = (names[state] ?? 0) + 1;
    const timestamp = requestedAtMs(job);
    if (timestamp === undefined) {
      invalidRequestedAt += 1;
      return;
    }
    const key = seriesKey(job);
    latestBySeries.set(
      key,
      Math.max(latestBySeries.get(key) ?? Number.NEGATIVE_INFINITY, timestamp),
    );
  });

  const beforeCounts = await input.queue.getJobCounts(...states);
  input.log({ action: "inventory", byName, counts: beforeCounts, invalidRequestedAt });

  let deleted = 0;
  let eligible = 0;
  let protectedActive = 0;
  let protectedLatest = 0;
  for (const state of states) {
    let start = 0;
    while (true) {
      const jobs = await input.queue.getJobs([state], start, start + input.batchSize - 1, true);
      let retained = 0;
      for (const job of jobs) {
        const timestamp = requestedAtMs(job);
        if (timestamp === undefined || timestamp > before) {
          retained += 1;
          continue;
        }
        if (state === "active") {
          protectedActive += 1;
          retained += 1;
          continue;
        }
        if (timestamp === latestBySeries.get(seriesKey(job))) {
          protectedLatest += 1;
          retained += 1;
          continue;
        }
        eligible += 1;
        if (input.dryRun) {
          retained += 1;
          continue;
        }
        const currentState = await job.getState();
        if (!removableStates.has(currentState)) {
          if (currentState === "active") protectedActive += 1;
          retained += 1;
          continue;
        }
        try {
          await job.remove();
          deleted += 1;
        } catch (error) {
          if ((await job.getState()) === "active") {
            protectedActive += 1;
            retained += 1;
            continue;
          }
          throw error;
        }
      }
      input.log({
        action: input.dryRun ? "scan_batch" : "delete_batch",
        deleted,
        eligible,
        fetched: jobs.length,
        state,
      });
      if (jobs.length < input.batchSize) break;
      start += retained;
    }
  }

  const afterCounts = await input.queue.getJobCounts(...states);
  input.log({
    action: "summary",
    afterCounts,
    beforeCounts,
    deleted,
    dryRun: input.dryRun,
    eligible,
    protectedActive,
    protectedLatest,
  });
  return { deleted, eligible, protectedActive, protectedLatest };
}

export function asCleanupAdapter(queue: Queue<CleanupData>): QueueCleanupAdapter {
  return queue;
}
