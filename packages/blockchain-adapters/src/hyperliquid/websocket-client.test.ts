import { EventEmitter } from "node:events";

import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";

import { HyperliquidWebSocketClient } from "./websocket-client.js";

class FakeWebSocket extends EventEmitter {
  public readyState: number = WebSocket.CONNECTING;
  public readonly send = vi.fn((_data: string) => undefined);

  public close(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }

  public open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }

  public terminate(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }
}

describe("HyperliquidWebSocketClient", () => {
  it("serializes disconnect handling before reconnect gap recovery", async () => {
    const sockets: FakeWebSocket[] = [];
    const order: string[] = [];
    let releaseDisconnect = (): void => {
      throw new Error("Disconnect handler was not initialized.");
    };
    const disconnectGate = new Promise<void>((resolve) => {
      releaseDisconnect = resolve;
    });
    const client = new HyperliquidWebSocketClient("wss://example.test/ws", {
      connectionTimeoutMs: 1_000,
      heartbeatMs: 60_000,
      maximumReconnectDelayMs: 1,
      reconnectBaseDelayMs: 1,
      webSocketFactory: (_url) => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });
    const onReconnect = vi.fn(async () => {
      order.push("reconnect");
    });

    const started = client.start("0x1111111111111111111111111111111111111111", {
      onDisconnect: async () => {
        order.push("disconnect");
        await disconnectGate;
      },
      onEvent: async () => undefined,
      onReconnect,
    });
    sockets[0]?.open();
    await started;

    sockets[0]?.close();
    await vi.waitFor(() => {
      expect(sockets).toHaveLength(2);
    });
    sockets[1]?.open();
    await Promise.resolve();

    expect(order).toEqual(["disconnect"]);
    expect(onReconnect).not.toHaveBeenCalled();

    releaseDisconnect();
    await vi.waitFor(() => {
      expect(order).toEqual(["disconnect", "reconnect"]);
    });
    await client.stop();
  });

  it("times out an initial connection without reporting a data gap", async () => {
    const onDisconnect = vi.fn(async () => undefined);
    const client = new HyperliquidWebSocketClient("wss://example.test/ws", {
      connectionTimeoutMs: 5,
      webSocketFactory: (_url) => new FakeWebSocket() as unknown as WebSocket,
    });

    await expect(
      client.start("0x1111111111111111111111111111111111111111", {
        onDisconnect,
        onEvent: async () => undefined,
      }),
    ).rejects.toThrow("timed out");
    expect(onDisconnect).not.toHaveBeenCalled();
    await client.stop();
  });

  it("subscribes only to documented user channels", async () => {
    const socket = new FakeWebSocket();
    const client = new HyperliquidWebSocketClient("wss://example.test/ws", {
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const started = client.start("0x1111111111111111111111111111111111111111", {
      onEvent: async () => undefined,
    });
    socket.open();
    await started;

    const channels = socket.send.mock.calls.map(([message]) => {
      const parsed = JSON.parse(message) as {
        subscription: { type: string };
      };
      return parsed.subscription.type;
    });
    expect(channels).toEqual([
      "userEvents",
      "userFills",
      "userFundings",
      "userNonFundingLedgerUpdates",
      "orderUpdates",
      "clearinghouseState",
      "openOrders",
    ]);
    expect(channels).not.toContain("spotState");
    await client.stop();
  });

  it("continues processing after an error observer throws", async () => {
    const socket = new FakeWebSocket();
    const onEvent = vi.fn(async () => undefined);
    const onError = vi.fn(async () => {
      throw new Error("observer failed");
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const client = new HyperliquidWebSocketClient("wss://example.test/ws", {
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const started = client.start("0x1111111111111111111111111111111111111111", {
      onError,
      onEvent,
    });
    socket.open();
    await started;

    socket.emit("message", Buffer.from("not-json"));
    socket.emit("message", Buffer.from('{"channel":"custom","data":{"ok":true}}'));

    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledOnce());
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
    await client.stop();
  });

  it("accepts the documented pong control message without a data field", async () => {
    const socket = new FakeWebSocket();
    const onError = vi.fn(async () => undefined);
    const onEvent = vi.fn(async () => undefined);
    const client = new HyperliquidWebSocketClient("wss://example.test/ws", {
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const started = client.start("0x1111111111111111111111111111111111111111", {
      onError,
      onEvent,
    });
    socket.open();
    await started;

    socket.emit("message", Buffer.from('{"channel":"pong"}'));
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onError).not.toHaveBeenCalled();
    expect(onEvent).not.toHaveBeenCalled();
    await client.stop();
  });
});
