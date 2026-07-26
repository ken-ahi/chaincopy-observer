import { EventEmitter } from "node:events";

import {
  type HyperliquidClient,
  type HyperliquidMarketWebSocketClientOptions,
} from "@chaincopy/blockchain-adapters";
import { type HyperliquidDiscoveryJobData } from "@chaincopy/domain";
import { type Queue } from "bullmq";
import { type Logger } from "pino";
import { describe, expect, it, vi } from "vitest";

import { type HyperliquidDiscoveryRepository } from "./repository.js";
import { HyperliquidDiscoveryWebSocketSupervisor } from "./websocket-supervisor.js";

class FakeWebSocket extends EventEmitter {
  public readyState = 0;
  public readonly send = vi.fn();

  public open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  public terminate(): void {
    this.readyState = 3;
    this.emit("close");
  }
}

describe("Hyperliquid discovery WebSocket supervisor", () => {
  it("does not reconnect from stale settings when discovery is stopped during meta lookup", async () => {
    const repository = repositoryStub([settings(true), settings(false)]);
    const socketFactory = vi.fn(() => new FakeWebSocket());
    const supervisor = createSupervisor(
      repository,
      socketFactory as unknown as NonNullable<
        HyperliquidMarketWebSocketClientOptions["webSocketFactory"]
      >,
    );

    await expect(supervisor.ensureRunning()).resolves.toMatchObject({
      listening: false,
      reason: "disabled",
    });

    expect(socketFactory).not.toHaveBeenCalled();
    expect(repository.setWebSocketStatus).toHaveBeenLastCalledWith("STOPPED", { coins: [] });
  });

  it("shares one connection attempt across concurrent control jobs", async () => {
    const repository = repositoryStub([settings(true), settings(true)]);
    const sockets: FakeWebSocket[] = [];
    const socketFactory = vi.fn(() => {
      const socket = new FakeWebSocket();
      sockets.push(socket);
      queueMicrotask(() => socket.open());
      return socket;
    });
    const supervisor = createSupervisor(
      repository,
      socketFactory as unknown as NonNullable<
        HyperliquidMarketWebSocketClientOptions["webSocketFactory"]
      >,
    );

    const first = supervisor.ensureRunning();
    const second = supervisor.ensureRunning();
    await expect(Promise.all([first, second])).resolves.toHaveLength(2);

    expect(socketFactory).toHaveBeenCalledTimes(1);
    expect(sockets[0]?.send).toHaveBeenCalledTimes(2);
    await supervisor.stop();
  });
});

function createSupervisor(
  repository: ReturnType<typeof repositoryStub>,
  webSocketFactory: NonNullable<HyperliquidMarketWebSocketClientOptions["webSocketFactory"]>,
): HyperliquidDiscoveryWebSocketSupervisor {
  const httpClient = {
    meta: vi.fn(async () => ({
      data: {
        universe: [
          { name: "BTC", szDecimals: 5 },
          { name: "ETH", szDecimals: 4 },
        ],
      },
      rawText: "{}",
    })),
  } as unknown as HyperliquidClient;
  const queue = {} as Queue<HyperliquidDiscoveryJobData>;
  const logger = {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  } as unknown as Logger;
  return new HyperliquidDiscoveryWebSocketSupervisor(
    "wss://example.test/ws",
    httpClient,
    repository as unknown as HyperliquidDiscoveryRepository,
    queue,
    logger,
    {
      enforceOfficialRateLimits: false,
      webSocketFactory,
    },
  );
}

function repositoryStub(settingsSequence: ReadonlyArray<ReturnType<typeof settings>>) {
  let index = 0;
  return {
    getSettings: vi.fn(async () => {
      const value = settingsSequence[index] ?? settingsSequence.at(-1) ?? settings(false);
      index += 1;
      return value;
    }),
    recordDiscoveryStartupGap: vi.fn(async () => null),
    setWebSocketStatus: vi.fn(async () => undefined),
  };
}

function settings(enabled: boolean) {
  return {
    enabled,
    mode: "MAJOR" as const,
    priorityCoins: ["BTC", "ETH"],
  };
}
