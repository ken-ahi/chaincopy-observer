import { hyperliquidJobNames, type HyperliquidJobData } from "@chaincopy/domain";
import { type JobsOptions, type Queue } from "bullmq";
import { describe, expect, it } from "vitest";

import {
  enqueueHyperliquidGapRecovery,
  enqueueHyperliquidJob,
  enqueueWalletBackfillChildren,
  hyperliquidJobOptions,
} from "./queue.js";

class RecordingQueue {
  public readonly jobs: Array<{
    readonly data: HyperliquidJobData;
    readonly name: string;
    readonly options: JobsOptions;
  }> = [];

  public async add(
    name: string,
    data: HyperliquidJobData,
    options: JobsOptions,
  ): Promise<{ readonly id: string }> {
    this.jobs.push({ data, name, options });
    return { id: String(options.jobId) };
  }
}

describe("Hyperliquid queue", () => {
  it("uses a deterministic time-bucket job ID and bounded exponential retries", async () => {
    const queue = new RecordingQueue();
    const data: HyperliquidJobData = {
      requestedAt: "2026-07-25T12:34:56.000Z",
      walletAddress: "0x1111111111111111111111111111111111111111",
      walletAddressId: "wallet-1",
    };

    const first = await enqueueHyperliquidJob(
      queue as unknown as Queue<HyperliquidJobData>,
      hyperliquidJobNames.fillSync,
      data,
    );
    const duplicate = await enqueueHyperliquidJob(
      queue as unknown as Queue<HyperliquidJobData>,
      hyperliquidJobNames.fillSync,
      data,
    );

    expect(first).toBe(duplicate);
    expect(queue.jobs[0]?.options.jobId).toBe(first);
    expect(hyperliquidJobOptions.attempts).toBe(5);
    expect(hyperliquidJobOptions.backoff).toEqual({
      delay: 1_000,
      type: "exponential",
    });
  });

  it("rejects invalid scheduling timestamps", async () => {
    const queue = new RecordingQueue();
    await expect(
      enqueueHyperliquidJob(
        queue as unknown as Queue<HyperliquidJobData>,
        hyperliquidJobNames.fillSync,
        {
          requestedAt: "invalid",
          walletAddress: "0x1111111111111111111111111111111111111111",
          walletAddressId: "wallet-1",
        },
      ),
    ).rejects.toThrow("requestedAt");
    expect(queue.jobs).toHaveLength(0);
  });

  it("uses the exact gap interval to suppress duplicate recovery jobs", async () => {
    const queue = new RecordingQueue();
    const data: HyperliquidJobData = {
      endTime: "2026-07-25T12:35:56.789Z",
      requestedAt: "2026-07-25T12:35:56.789Z",
      startTime: "2026-07-25T12:34:56.123Z",
      walletAddress: "0x1111111111111111111111111111111111111111",
      walletAddressId: "wallet-1",
    };

    const first = await enqueueHyperliquidGapRecovery(
      queue as unknown as Queue<HyperliquidJobData>,
      data,
    );
    const duplicate = await enqueueHyperliquidGapRecovery(
      queue as unknown as Queue<HyperliquidJobData>,
      data,
    );
    const adjacent = await enqueueHyperliquidGapRecovery(
      queue as unknown as Queue<HyperliquidJobData>,
      {
        ...data,
        startTime: "2026-07-25T12:34:56.124Z",
      },
    );

    expect(duplicate).toBe(first);
    expect(adjacent).not.toBe(first);
  });

  it("keeps manual backfill children stable per parent and distinct across requests", async () => {
    const queue = new RecordingQueue();
    const data: HyperliquidJobData = {
      requestedAt: "2026-07-25T12:34:56.000Z",
      walletAddress: "0x1111111111111111111111111111111111111111",
      walletAddressId: "wallet-1",
    };

    const first = await enqueueWalletBackfillChildren(
      queue as unknown as Queue<HyperliquidJobData>,
      data,
      "manual-parent-1",
    );
    const retriedParent = await enqueueWalletBackfillChildren(
      queue as unknown as Queue<HyperliquidJobData>,
      data,
      "manual-parent-1",
    );
    const secondRequest = await enqueueWalletBackfillChildren(
      queue as unknown as Queue<HyperliquidJobData>,
      data,
      "manual-parent-2",
    );

    expect(first).toEqual(retriedParent);
    expect(secondRequest).not.toEqual(first);
    expect(first.every((id) => id.endsWith("manual-parent-1"))).toBe(true);
  });
});
