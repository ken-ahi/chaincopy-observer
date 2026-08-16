import { describe, expect, it } from "vitest";

import { cleanupQueue, type QueueCleanupAdapter } from "./queue-cleanup.js";

type State = "prioritized" | "waiting" | "delayed" | "failed" | "active";

class FakeJob {
  public removed = false;
  public constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly data: { requestedAt?: unknown; walletAddressId?: unknown },
    public state: State,
  ) {}
  public async getState(): Promise<State> {
    return this.state;
  }
  public async remove(): Promise<void> {
    this.removed = true;
  }
}

class FakeQueue implements QueueCleanupAdapter {
  public constructor(private readonly jobs: FakeJob[]) {}
  public async getJobCounts(...states: State[]): Promise<Record<string, number>> {
    return Object.fromEntries(
      states.map((state) => [
        state,
        this.jobs.filter((job) => !job.removed && job.state === state).length,
      ]),
    );
  }
  public async getJobs(states: State[], start: number, end: number): Promise<FakeJob[]> {
    return this.jobs
      .filter((job) => !job.removed && states.includes(job.state))
      .slice(start, end + 1);
  }
}

function fixture(): FakeJob[] {
  return [
    new FakeJob(
      "old-a",
      "fill",
      { requestedAt: "2026-07-29T00:00:00Z", walletAddressId: "a" },
      "prioritized",
    ),
    new FakeJob(
      "new-a",
      "fill",
      { requestedAt: "2026-07-31T00:00:00Z", walletAddressId: "a" },
      "waiting",
    ),
    new FakeJob(
      "old-b",
      "fill",
      { requestedAt: "2026-07-28T00:00:00Z", walletAddressId: "b" },
      "delayed",
    ),
    new FakeJob(
      "new-b",
      "fill",
      { requestedAt: "2026-08-02T00:00:00Z", walletAddressId: "b" },
      "failed",
    ),
    new FakeJob(
      "active",
      "funding",
      { requestedAt: "2026-07-20T00:00:00Z", walletAddressId: "c" },
      "active",
    ),
    new FakeJob("invalid", "ledger", { requestedAt: "not-a-date", walletAddressId: "d" }, "failed"),
  ];
}

describe("queue cleanup", () => {
  it("dry-runs cutoff eligibility without removing and reports state/name inventory", async () => {
    const jobs = fixture();
    const events: Array<Record<string, unknown>> = [];
    const result = await cleanupQueue({
      batchSize: 2,
      before: new Date("2026-08-01T00:00:00Z"),
      dryRun: true,
      log: (event) => events.push(event),
      queue: new FakeQueue(jobs),
    });
    expect(result).toEqual({ deleted: 0, eligible: 2, protectedActive: 1, protectedLatest: 1 });
    expect(jobs.every((job) => !job.removed)).toBe(true);
    expect(events[0]).toMatchObject({
      action: "inventory",
      counts: { active: 1, delayed: 1, failed: 2, prioritized: 1, waiting: 1 },
      invalidRequestedAt: 1,
    });
    expect(events[0]?.byName).toMatchObject({
      fill: { delayed: 1, failed: 1, prioritized: 1, waiting: 1 },
    });
  });

  it("removes only old non-active non-latest jobs and is retry safe", async () => {
    const jobs = fixture();
    const queue = new FakeQueue(jobs);
    const input = {
      batchSize: 1,
      before: new Date("2026-08-01T00:00:00Z"),
      dryRun: false,
      log: () => undefined,
      queue,
    };
    expect(await cleanupQueue(input)).toMatchObject({ deleted: 2, eligible: 2 });
    expect(jobs.find((job) => job.id === "old-a")?.removed).toBe(true);
    expect(jobs.find((job) => job.id === "old-b")?.removed).toBe(true);
    expect(jobs.find((job) => job.id === "active")?.removed).toBe(false);
    expect(await cleanupQueue(input)).toMatchObject({ deleted: 0, eligible: 0 });
  });
});
