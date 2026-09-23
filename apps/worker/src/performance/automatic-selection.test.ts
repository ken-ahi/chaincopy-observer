import type { WalletSelectionService } from "../../../api/src/wallet-selection-service.js";
import type { BehaviorJobData } from "@chaincopy/domain";
import type { Queue } from "bullmq";
import { describe, expect, it, vi } from "vitest";

import { AutomaticSelectionCoordinator } from "./automatic-selection.js";
import type { PerformanceProcessResult } from "./types.js";

const succeeded: PerformanceProcessResult = {
  calculationRunId: "performance-run-1",
  inputFingerprint: "performance-fingerprint",
  metricCount: 8,
  reused: false,
  status: "SUCCEEDED",
};

function selectionService() {
  return {
    evaluate: vi.fn(async () => ({
      items: [],
      reused: false,
      run: {
        evaluatedAt: "2026-09-23T00:00:00.000Z",
        excludedCount: 0,
        id: "selection-run-1",
        inputFingerprint: "selection-fingerprint",
        policyVersion: "wallet-selection-v1",
        qualifiedCount: 0,
        reviewCount: 0,
        selectedCount: 0,
        universeCount: 0,
      },
    })),
  } satisfies Pick<WalletSelectionService, "evaluate">;
}

function behaviorQueue() {
  return {
    add: vi.fn(
      async (_name: string, _data: BehaviorJobData, options: { readonly jobId: string }) => ({
        id: options.jobId,
      }),
    ),
    getJobCounts: vi.fn(async () => ({ active: 0, delayed: 0, prioritized: 0, waiting: 0 })),
  };
}

describe("AutomaticSelectionCoordinator", () => {
  it("evaluates Selection and enqueues Behavior after successful Performance", async () => {
    const selection = selectionService();
    const queue = behaviorQueue();
    const coordinator = new AutomaticSelectionCoordinator(
      selection,
      queue as unknown as Queue<BehaviorJobData>,
    );

    const result = await coordinator.afterPerformance(succeeded);

    expect(selection.evaluate).toHaveBeenCalledOnce();
    expect(queue.add).toHaveBeenCalledWith(
      "behavior-backfill-selected",
      { kind: "control", requestedAt: "2026-09-23T00:00:00.000Z" },
      expect.objectContaining({ jobId: expect.any(String) }),
    );
    expect(result.selection?.run?.id).toBe("selection-run-1");
  });

  it("does not advance Selection or Behavior after a failed Performance result", async () => {
    const selection = selectionService();
    const queue = behaviorQueue();
    const coordinator = new AutomaticSelectionCoordinator(
      selection,
      queue as unknown as Queue<BehaviorJobData>,
    );

    await expect(coordinator.afterPerformance({ ...succeeded, status: "FAILED" })).resolves.toEqual(
      { behaviorJobId: null, selection: null },
    );
    expect(selection.evaluate).not.toHaveBeenCalled();
    expect(queue.add).not.toHaveBeenCalled();
  });

  it("fails closed when Behavior backpressure suppresses enqueue", async () => {
    const selection = selectionService();
    const queue = behaviorQueue();
    queue.getJobCounts.mockResolvedValue({ active: 1_000, delayed: 0, prioritized: 0, waiting: 0 });
    const coordinator = new AutomaticSelectionCoordinator(
      selection,
      queue as unknown as Queue<BehaviorJobData>,
    );

    await expect(coordinator.afterPerformance(succeeded)).rejects.toThrow(
      "Behavior enqueue was suppressed",
    );
  });
});
