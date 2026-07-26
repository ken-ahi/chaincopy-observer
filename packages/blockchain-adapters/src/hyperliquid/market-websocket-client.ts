import { parse as parseLossless } from "lossless-json";
import WebSocket, { type RawData } from "ws";

import { HyperliquidValidationError } from "./errors.js";
import {
  websocketEnvelopeSchema,
  websocketTradesSchema,
  type HyperliquidWebSocketTrade,
} from "./schemas.js";

export interface HyperliquidMarketWebSocketHandlers {
  readonly onConnected?: (connectedAt: Date) => Promise<void> | void;
  readonly onDisconnect?: (disconnectedAt: Date) => Promise<void> | void;
  readonly onError?: (error: unknown) => Promise<void> | void;
  readonly onReconnect?: (disconnectedAt: Date, reconnectedAt: Date) => Promise<void> | void;
  readonly onReconnectExhausted?: (attempts: number) => Promise<void> | void;
  readonly onTrades: (
    trades: ReadonlyArray<HyperliquidWebSocketTrade>,
    receivedAt: Date,
  ) => Promise<void> | void;
}

export interface HyperliquidMarketWebSocketClientOptions {
  readonly connectionTimeoutMs?: number;
  readonly enforceOfficialRateLimits?: boolean;
  readonly heartbeatMs?: number;
  readonly maximumReconnectAttempts?: number;
  readonly maximumReconnectDelayMs?: number;
  readonly reconnectBaseDelayMs?: number;
  readonly webSocketFactory?: (url: string) => WebSocket;
}

export class HyperliquidMarketWebSocketClient {
  private connection: WebSocket | null = null;
  private disconnectedAt: Date | null = null;
  private handlers: HyperliquidMarketWebSocketHandlers | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastActivityAt = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private subscriptions: ReadonlyArray<string> = [];
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private messageQueue: Promise<void> = Promise.resolve();
  private readonly connectionTimeoutMs: number;
  private readonly enforceOfficialRateLimits: boolean;
  private readonly heartbeatMs: number;
  private readonly maximumReconnectAttempts: number;
  private readonly maximumReconnectDelayMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly webSocketFactory: (url: string) => WebSocket;

  public constructor(
    private readonly webSocketUrl: string,
    options: HyperliquidMarketWebSocketClientOptions = {},
  ) {
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 10_000;
    this.enforceOfficialRateLimits = options.enforceOfficialRateLimits ?? true;
    this.heartbeatMs = options.heartbeatMs ?? 30_000;
    this.maximumReconnectAttempts = options.maximumReconnectAttempts ?? 12;
    this.maximumReconnectDelayMs = options.maximumReconnectDelayMs ?? 30_000;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 500;
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  public async start(
    coins: ReadonlyArray<string>,
    handlers: HyperliquidMarketWebSocketHandlers,
  ): Promise<void> {
    if (!this.stopped) {
      throw new Error("Hyperliquid market WebSocket client is already running.");
    }
    const subscriptions = [...new Set(coins.map((coin) => coin.trim()).filter(Boolean))];
    if (subscriptions.length === 0) {
      throw new RangeError("At least one market subscription is required.");
    }
    if (subscriptions.length > 1_000) {
      throw new RangeError("Hyperliquid permits at most 1000 WebSocket subscriptions.");
    }
    this.subscriptions = subscriptions;
    this.handlers = handlers;
    this.disconnectedAt = null;
    this.reconnectAttempt = 0;
    this.stopped = false;
    await this.connect();
  }

  public async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.clearHeartbeat();
    const connection = this.connection;
    this.connection = null;
    if (!connection || connection.readyState === WebSocket.CLOSED) {
      await Promise.all([this.messageQueue, this.lifecycleQueue]);
      return;
    }
    connection.terminate();
    await Promise.all([this.messageQueue, this.lifecycleQueue]);
  }

  private async connect(): Promise<void> {
    const handlers = this.handlers;
    if (!handlers || this.stopped) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      const connection = this.webSocketFactory(this.webSocketUrl);
      this.connection = connection;
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) {
          settled = true;
          connection.terminate();
          reject(
            new Error(`Market WebSocket connection timed out after ${this.connectionTimeoutMs}ms.`),
          );
        }
      }, this.connectionTimeoutMs);
      timeout.unref();

      connection.once("open", () => {
        settled = true;
        clearTimeout(timeout);
        for (const coin of this.subscriptions) {
          connection.send(
            JSON.stringify({
              method: "subscribe",
              subscription: { coin, type: "trades" },
            }),
          );
        }
        this.startHeartbeat(connection);
        const connectedAt = new Date();
        const disconnectedAt = this.disconnectedAt;
        this.disconnectedAt = null;
        this.reconnectAttempt = 0;
        this.enqueueLifecycle(() =>
          disconnectedAt
            ? handlers.onReconnect?.(disconnectedAt, connectedAt)
            : handlers.onConnected?.(connectedAt),
        );
        resolve();
      });

      connection.on("message", (data: RawData) => {
        this.lastActivityAt = Date.now();
        this.messageQueue = this.messageQueue
          .then(() => this.handleMessage(data.toString()))
          .catch((error: unknown) => this.reportError(error));
      });

      connection.once("error", (error) => {
        void this.reportError(error);
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          reject(error);
        }
      });

      connection.once("close", () => {
        clearTimeout(timeout);
        this.clearHeartbeat();
        if (this.connection === connection) {
          this.connection = null;
        }
        if (!this.stopped) {
          const disconnectedAt = new Date();
          this.disconnectedAt ??= disconnectedAt;
          this.enqueueLifecycle(() => handlers.onDisconnect?.(disconnectedAt));
          this.scheduleReconnect();
        }
        if (!settled) {
          settled = true;
          reject(new Error("Market WebSocket closed before the connection opened."));
        }
      });
    });
  }

  private async handleMessage(rawText: string): Promise<void> {
    const handlers = this.handlers;
    if (!handlers) {
      return;
    }
    const envelope = websocketEnvelopeSchema.safeParse(parseLossless(rawText));
    if (!envelope.success) {
      throw new HyperliquidValidationError("market websocket", envelope.error);
    }
    if (envelope.data.channel === "pong" || envelope.data.channel === "subscriptionResponse") {
      return;
    }
    if (envelope.data.channel !== "trades") {
      return;
    }
    const trades = websocketTradesSchema.safeParse(envelope.data.data);
    if (!trades.success) {
      throw new HyperliquidValidationError("market trades websocket", trades.error);
    }
    await handlers.onTrades(trades.data, new Date());
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    if (this.reconnectAttempt >= this.maximumReconnectAttempts) {
      this.stopped = true;
      this.enqueueLifecycle(() => this.handlers?.onReconnectExhausted?.(this.reconnectAttempt));
      return;
    }
    const delay = Math.min(
      this.maximumReconnectDelayMs,
      this.reconnectBaseDelayMs * 2 ** this.reconnectAttempt,
    );
    const officialFloor = this.enforceOfficialRateLimits
      ? officialReconnectFloor(this.subscriptions.length)
      : 0;
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(
      () => {
        this.reconnectTimer = null;
        void this.connect().catch((error: unknown) => {
          void this.reportError(error);
          this.scheduleReconnect();
        });
      },
      Math.max(delay, officialFloor),
    );
    this.reconnectTimer.unref();
  }

  private startHeartbeat(connection: WebSocket): void {
    this.clearHeartbeat();
    this.lastActivityAt = Date.now();
    this.heartbeat = setInterval(() => {
      if (connection.readyState !== WebSocket.OPEN) {
        return;
      }
      if (Date.now() - this.lastActivityAt > this.heartbeatMs * 2) {
        connection.terminate();
        return;
      }
      connection.send(JSON.stringify({ method: "ping" }));
    }, this.heartbeatMs);
    this.heartbeat.unref();
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private enqueueLifecycle(callback: () => Promise<void> | void | undefined): void {
    this.lifecycleQueue = this.lifecycleQueue
      .then(() => callback())
      .catch((error: unknown) => this.reportError(error));
  }

  private async reportError(error: unknown): Promise<void> {
    try {
      await this.handlers?.onError?.(error);
    } catch (reportingError) {
      console.error(
        JSON.stringify({
          event: "hyperliquid_market_websocket_error_handler_failed",
          message:
            reportingError instanceof Error ? reportingError.message : String(reportingError),
        }),
      );
    }
  }
}

function officialReconnectFloor(subscriptionCount: number): number {
  const messageBudgetPerMinute = 1_900;
  const connectionBudgetPerMinute = 28;
  const connectionsAllowedByMessages = Math.max(
    1,
    Math.floor(messageBudgetPerMinute / subscriptionCount),
  );
  const connectionsPerMinute = Math.min(connectionBudgetPerMinute, connectionsAllowedByMessages);
  return Math.ceil(60_000 / connectionsPerMinute);
}
