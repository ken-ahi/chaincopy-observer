import { describe, expect, it, vi } from "vitest";

import type { Queue } from "bullmq";
import type { BehaviorJobData } from "@chaincopy/domain";

import { BEHAVIOR_BACKLOG_LIMIT, enqueueBehaviorJob } from "./queue.js";

function queue(count = 0) {
  return {
    add: vi.fn().mockResolvedValue({ id: "queued" }),
    getJobCounts: vi
      .fn()
      .mockResolvedValue({ active: count, delayed: 0, prioritized: 0, waiting: 0 }),
  } as unknown as Queue<BehaviorJobData>;
}

describe("behavior queue", () => {
  it("uses stable deduplication for one request but permits a later continuation", async () => {
    const target = queue();
    const first = {
      coin: "BTC",
      kind: "wallet-coin",
      requestedAt: "2026-08-23T00:00:00Z",
      walletAddressId: "wallet-1",
    } as const;
    await enqueueBehaviorJob(target, first);
    await enqueueBehaviorJob(target, first);
    await enqueueBehaviorJob(target, {
      ...first,
      continuationAfter: "2026-08-23T00:01:00Z",
      requestedAt: "2026-08-23T00:01:01Z",
    });
    const ids = (target.add as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[2].jobId);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("suppresses enqueue when the bounded backlog is full", async () => {
    const target = queue(BEHAVIOR_BACKLOG_LIMIT);
    await expect(
      enqueueBehaviorJob(target, { kind: "control", requestedAt: "2026-08-23T00:00:00Z" }),
    ).resolves.toBeNull();
    expect(target.add).not.toHaveBeenCalled();
  });
});
