import { EventEmitter } from "node:events";

import WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";

import { HyperliquidMarketWebSocketClient } from "./market-websocket-client.js";
import { type HyperliquidWebSocketTrade } from "./schemas.js";

class FakeWebSocket extends EventEmitter {
  public readyState: number = WebSocket.CONNECTING;
  public readonly send = vi.fn((_data: string) => undefined);

  public open(): void {
    this.readyState = WebSocket.OPEN;
    this.emit("open");
  }

  public closeConnection(): void {
    this.readyState = WebSocket.CLOSED;
    this.emit("close");
  }

  public terminate(): void {
    this.closeConnection();
  }
}

describe("Hyperliquid market WebSocket", () => {
  it("reconnects with a bound and resubscribes to every selected market", async () => {
    const sockets: FakeWebSocket[] = [];
    const onReconnect = vi.fn(async () => undefined);
    const client = new HyperliquidMarketWebSocketClient("wss://example.test/ws", {
      enforceOfficialRateLimits: false,
      heartbeatMs: 60_000,
      maximumReconnectAttempts: 2,
      maximumReconnectDelayMs: 1,
      reconnectBaseDelayMs: 1,
      webSocketFactory: () => {
        const socket = new FakeWebSocket();
        sockets.push(socket);
        return socket as unknown as WebSocket;
      },
    });
    const started = client.start(["BTC", "ETH"], {
      onReconnect,
      onTrades: async () => undefined,
    });
    sockets[0]?.open();
    await started;

    sockets[0]?.closeConnection();
    await vi.waitFor(() => expect(sockets).toHaveLength(2));
    sockets[1]?.open();
    await vi.waitFor(() => expect(onReconnect).toHaveBeenCalledOnce());

    for (const socket of sockets) {
      const subscriptions = socket.send.mock.calls
        .map(([message]) => JSON.parse(message) as { subscription?: { coin?: string } })
        .map((message) => message.subscription?.coin)
        .filter(Boolean);
      expect(subscriptions).toEqual(["BTC", "ETH"]);
    }
    await client.stop();
  });

  it("parses WsTrade batches and ignores subscription acknowledgements", async () => {
    const socket = new FakeWebSocket();
    const onTrades = vi.fn(async (_trades: ReadonlyArray<HyperliquidWebSocketTrade>) => undefined);
    const client = new HyperliquidMarketWebSocketClient("wss://example.test/ws", {
      webSocketFactory: () => socket as unknown as WebSocket,
    });
    const started = client.start(["BTC"], { onTrades });
    socket.open();
    await started;
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          channel: "subscriptionResponse",
          data: { subscription: { coin: "BTC", type: "trades" } },
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          channel: "trades",
          data: [
            {
              coin: "BTC",
              hash: "0xhash",
              px: "100",
              side: "B",
              sz: "1",
              tid: 1,
              time: 1_721_862_400_000,
              users: [
                "0x1111111111111111111111111111111111111111",
                "0x2222222222222222222222222222222222222222",
              ],
            },
          ],
        }),
      ),
    );
    await vi.waitFor(() => expect(onTrades).toHaveBeenCalledOnce());
    expect(onTrades.mock.calls[0]?.[0]).toHaveLength(1);
    await client.stop();
  });
});
