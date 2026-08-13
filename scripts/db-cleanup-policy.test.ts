import { describe, expect, it, vi } from "vitest";

import {
  createCleanupRules,
  executeCleanupRule,
  rejectOrderStatuses,
} from "./db-cleanup-policy.js";

describe("database cleanup policy", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");

  it("retains successful sync jobs for 7 days and failures for 30 days", () => {
    const rules = createCleanupRules(now, "sync_jobs");
    expect(rules).toEqual([
      { cutoff: new Date("2026-08-03T00:00:00.000Z"), status: "SUCCEEDED", table: "sync_jobs" },
      { cutoff: new Date("2026-07-11T00:00:00.000Z"), status: "FAILED", table: "sync_jobs" },
    ]);
    expect(rules.some((rule) => rule.status === "RUNNING" || rule.status === "QUEUED")).toBe(false);
  });

  it("only targets known reject statuses and preserves filled, open, canceled and unknown", () => {
    const rules = createCleanupRules(now, "order_history");
    expect(rules.map((rule) => rule.status)).toEqual(rejectOrderStatuses);
    expect(
      rules.some((rule) => ["filled", "open", "canceled", "unknown"].includes(rule.status ?? "")),
    ).toBe(false);
  });

  it("uses an exclusive retention boundary", () => {
    const [rule] = createCleanupRules(now, "raw_events");
    expect(rule?.cutoff.toISOString()).toBe("2026-07-11T00:00:00.000Z");
  });

  it("does not delete during dry-run", async () => {
    const deleteBatch = vi.fn(async () => 1);
    const [rule] = createCleanupRules(now, "raw_events");
    const result = await executeCleanupRule({
      adapter: { count: async () => 12n, deleteBatch },
      batchSize: 5,
      dryRun: true,
      rule: rule!,
    });
    expect(result).toEqual({ deleted: 0, planned: 12n });
    expect(deleteBatch).not.toHaveBeenCalled();
  });

  it("deletes in bounded batches including the zero-row boundary", async () => {
    const deleteBatch = vi
      .fn()
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(3)
      .mockResolvedValueOnce(1);
    const [rule] = createCleanupRules(now, "raw_events");
    const result = await executeCleanupRule({
      adapter: { count: async () => 7n, deleteBatch },
      batchSize: 3,
      dryRun: false,
      rule: rule!,
    });
    expect(result.deleted).toBe(7);
    expect(deleteBatch).toHaveBeenCalledTimes(3);
    expect(deleteBatch.mock.calls.every((call) => call[1] === 3)).toBe(true);
  });

  it("can resume safely after an interrupted batch", async () => {
    const [rule] = createCleanupRules(now, "raw_events");
    const failing = vi.fn().mockResolvedValueOnce(2).mockRejectedValueOnce(new Error("stopped"));
    await expect(
      executeCleanupRule({
        adapter: { count: async () => 4n, deleteBatch: failing },
        batchSize: 2,
        dryRun: false,
        rule: rule!,
      }),
    ).rejects.toThrow("stopped");
    const resumed = await executeCleanupRule({
      adapter: {
        count: async () => 2n,
        deleteBatch: vi.fn().mockResolvedValueOnce(2).mockResolvedValueOnce(0),
      },
      batchSize: 2,
      dryRun: false,
      rule: rule!,
    });
    expect(resumed.deleted).toBe(2);
  });
});
