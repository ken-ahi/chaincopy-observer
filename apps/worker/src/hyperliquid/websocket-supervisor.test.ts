import { EventEmitter } from "node:events";

import { type HyperliquidJobData } from "@chaincopy/domain";
import { type JobsOptions, type Queue } from "bullmq";
import { type Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { type HyperliquidRepository } from "./repository.js";
import { HyperliquidWebSocketSupervisor } from "./websocket-supervisor.js";

const wallet = {
  address: "0x1111111111111111111111111111111111111111",
  id: "wallet-1",
};

class FakeWebSocket extends EventEmitter {
  public readyState = 0;
  public readonly send = vi.fn((_data: string) => undefined);

  public close(): void {
    this.readyState = 3;
    this.emit("close");
  }

  public open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  public terminate(): void {
    this.close();
  }
}

function createHarness(recordWebSocketGap: HyperliquidRepository["recordWebSocketGap"]): {
  readonly add: ReturnType<typeof vi.fn>;
  readonly error: ReturnType<typeof vi.fn>;
  readonly info: ReturnType<typeof vi.fn>;
  readonly sockets: FakeWebSocket[];
  readonly supervisor: HyperliquidWebSocketSupervisor;
} {
  const sockets: FakeWebSocket[] = [];
  const add = vi.fn(async (_name: string, _data: HyperliquidJobData, options: JobsOptions) => ({
    id: String(options.jobId),
  }));
  const repository = {
    beginCursor: vi.fn(async () => undefined),
    completeCursor: vi.fn(async () => undefined),
    failCursor: vi.fn(async () => undefined),
    markSourceFailure: vi.fn(async () => undefined),
    recordQualityIssue: vi.fn(async () => undefined),
    recordWebSocketGap,
  } as unknown as HyperliquidRepository;
  const error = vi.fn();
  const info = vi.fn();
  const logger = {
    error,
    info,
    warn: vi.fn(),
  } as unknown as Logger;
  const supervisor = new HyperliquidWebSocketSupervisor(
    "wss://example.test/ws",
    repository,
    { add } as unknown as Queue<HyperliquidJobData>,
    logger,
    {
      connectionTimeoutMs: 1_000,
      heartbeatMs: 60_000,
      maximumReconnectDelayMs: 1,
      reconnectBaseDelayMs: 1,
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as never;
      },
    },
  );
  return { add, error, info, sockets, supervisor };
}

async function start(harness: ReturnType<typeof createHarness>): Promise<void> {
  const started = harness.supervisor.ensureWallet(wallet);
  await vi.waitFor(() => expect(harness.sockets).toHaveLength(1));
  harness.sockets[0]!.open();
  await started;
}

async function reconnect(harness: ReturnType<typeof createHarness>): Promise<void> {
  harness.sockets[0]?.close();
  await vi.waitFor(() => expect(harness.sockets).toHaveLength(2));
  harness.sockets[1]?.open();
}

describe("HyperliquidWebSocketSupervisor gap recovery", () => {
  it("retries a failed gap cursor save on reconnect and queues only after it succeeds", async () => {
    const operations: string[] = [];
    let attempts = 0;
    const recordWebSocketGap = vi.fn(
      async (_walletAddressId: string, _disconnectedAt: string): Promise<boolean> => {
        operations.push("cursor");
        attempts += 1;
        if (attempts === 1) {
          throw new Error("database unavailable");
        }
        return true;
      },
    );
    const harness = createHarness(recordWebSocketGap);
    harness.add.mockImplementation(
      async (_name: string, _data: HyperliquidJobData, options: JobsOptions) => {
        operations.push("queue");
        return { id: String(options.jobId) };
      },
    );

    await start(harness);
    await reconnect(harness);
    await vi.waitFor(() => expect(harness.add).toHaveBeenCalledOnce());

    expect(recordWebSocketGap).toHaveBeenCalledTimes(2);
    expect(recordWebSocketGap.mock.calls[0]?.[1]).toBe(recordWebSocketGap.mock.calls[1]?.[1]);
    expect(operations).toEqual(["cursor", "cursor", "queue"]);
    const queuedData = harness.add.mock.calls[0]?.[1] as HyperliquidJobData | undefined;
    const queuedOptions = harness.add.mock.calls[0]?.[2] as JobsOptions | undefined;
    expect(queuedData?.startTime).toBe(recordWebSocketGap.mock.calls[1]?.[1]);
    expect(String(queuedOptions?.jobId)).toContain(
      `gap-${new Date(queuedData?.startTime ?? "").getTime()}-${new Date(
        queuedData?.endTime ?? "",
      ).getTime()}`,
    );
    await harness.supervisor.stop();
  });

  it("does not queue or report recovery success when the reconnect retry also fails", async () => {
    const recordWebSocketGap = vi.fn(
      async (_walletAddressId: string, _disconnectedAt: string): Promise<boolean> => {
        throw new Error("database unavailable");
      },
    );
    const harness = createHarness(recordWebSocketGap);

    await start(harness);
    await reconnect(harness);
    await vi.waitFor(() => expect(recordWebSocketGap).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(harness.error).toHaveBeenCalled());

    expect(harness.add).not.toHaveBeenCalled();
    expect(harness.info).not.toHaveBeenCalledWith(
      expect.objectContaining({ event: "hyperliquid_gap_recovery_queued" }),
      expect.any(String),
    );
    await harness.supervisor.stop();
  });

  it("does not queue an older gap when the cursor rejects a backward move", async () => {
    const recordWebSocketGap = vi.fn(
      async (_walletAddressId: string, _disconnectedAt: string): Promise<boolean> => false,
    );
    const harness = createHarness(recordWebSocketGap);

    await start(harness);
    await reconnect(harness);
    await vi.waitFor(() => expect(recordWebSocketGap).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(harness.error).toHaveBeenCalled());

    expect(harness.add).not.toHaveBeenCalled();
    await harness.supervisor.stop();
  });
});
