import { parse as parseLossless } from "lossless-json";
import WebSocket, { type RawData } from "ws";

import { normalizeHyperliquidAddress } from "./address.js";
import { HyperliquidValidationError } from "./errors.js";
import { websocketEnvelopeSchema } from "./schemas.js";

export const hyperliquidUserSubscriptions = [
  "userEvents",
  "userFills",
  "userFundings",
  "userNonFundingLedgerUpdates",
  "orderUpdates",
  "clearinghouseState",
  "openOrders",
] as const;

export type HyperliquidUserSubscription = (typeof hyperliquidUserSubscriptions)[number];

export interface HyperliquidWebSocketEvent {
  readonly channel: string;
  readonly data: unknown;
  readonly rawText: string;
  readonly receivedAt: Date;
}

export interface HyperliquidWebSocketHandlers {
  readonly onDisconnect?: (disconnectedAt: Date) => Promise<void> | void;
  readonly onError?: (error: unknown) => Promise<void> | void;
  readonly onEvent: (event: HyperliquidWebSocketEvent) => Promise<void> | void;
  readonly onReconnect?: (disconnectedAt: Date, reconnectedAt: Date) => Promise<void> | void;
}

export interface HyperliquidWebSocketClientOptions {
  readonly connectionTimeoutMs?: number;
  readonly heartbeatMs?: number;
  readonly maximumReconnectDelayMs?: number;
  readonly reconnectBaseDelayMs?: number;
  readonly webSocketFactory?: (url: string) => WebSocket;
}

export class HyperliquidWebSocketClient {
  private connection: WebSocket | null = null;
  private disconnectedAt: Date | null = null;
  private hasConnected = false;
  private heartbeat: NodeJS.Timeout | null = null;
  private lastActivityAt = 0;
  private reconnectAttempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private walletAddress: string | null = null;
  private handlers: HyperliquidWebSocketHandlers | null = null;
  private lifecycleQueue: Promise<void> = Promise.resolve();
  private messageQueue: Promise<void> = Promise.resolve();
  private readonly connectionTimeoutMs: number;
  private readonly heartbeatMs: number;
  private readonly maximumReconnectDelayMs: number;
  private readonly reconnectBaseDelayMs: number;
  private readonly webSocketFactory: (url: string) => WebSocket;

  public constructor(
    private readonly webSocketUrl: string,
    options: HyperliquidWebSocketClientOptions = {},
  ) {
    this.connectionTimeoutMs = options.connectionTimeoutMs ?? 10_000;
    this.heartbeatMs = options.heartbeatMs ?? 30_000;
    this.maximumReconnectDelayMs = options.maximumReconnectDelayMs ?? 30_000;
    this.reconnectBaseDelayMs = options.reconnectBaseDelayMs ?? 500;
    this.webSocketFactory = options.webSocketFactory ?? ((url) => new WebSocket(url));
  }

  public async start(
    walletAddressInput: string,
    handlers: HyperliquidWebSocketHandlers,
  ): Promise<void> {
    if (!this.stopped) {
      throw new Error("Hyperliquid WebSocket client is already running.");
    }
    this.walletAddress = normalizeHyperliquidAddress(walletAddressInput);
    this.handlers = handlers;
    this.disconnectedAt = null;
    this.hasConnected = false;
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
      await Promise.all([this.lifecycleQueue, this.messageQueue]);
      return;
    }
    if (connection.readyState === WebSocket.CONNECTING) {
      connection.terminate();
      await Promise.all([this.lifecycleQueue, this.messageQueue]);
      return;
    }

    await new Promise<void>((resolve) => {
      connection.once("close", () => resolve());
      connection.close(1000, "client shutdown");
      setTimeout(resolve, 1_000).unref();
    });
    await Promise.all([this.lifecycleQueue, this.messageQueue]);
  }

  private async connect(): Promise<void> {
    const walletAddress = this.walletAddress;
    const handlers = this.handlers;
    if (!walletAddress || !handlers || this.stopped) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const connection = this.webSocketFactory(this.webSocketUrl);
      this.connection = connection;
      let settled = false;
      const connectionTimeout = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        connection.terminate();
        reject(
          new Error(
            `Hyperliquid WebSocket connection timed out after ${this.connectionTimeoutMs}ms.`,
          ),
        );
      }, this.connectionTimeoutMs);
      connectionTimeout.unref();

      connection.once("open", () => {
        settled = true;
        clearTimeout(connectionTimeout);
        this.hasConnected = true;
        this.reconnectAttempt = 0;
        for (const type of hyperliquidUserSubscriptions) {
          connection.send(
            JSON.stringify({
              method: "subscribe",
              subscription: subscriptionFor(type, walletAddress),
            }),
          );
        }
        this.startHeartbeat(connection);
        const reconnectedAt = new Date();
        const disconnectedAt = this.disconnectedAt;
        this.disconnectedAt = null;
        if (disconnectedAt) {
          this.enqueueLifecycle(() =>
            Promise.resolve(handlers.onReconnect?.(disconnectedAt, reconnectedAt)),
          );
        }
        resolve();
      });

      connection.on("message", (data: RawData) => {
        this.lastActivityAt = Date.now();
        const rawText = data.toString();
        this.messageQueue = this.messageQueue
          .then(() => this.handleMessage(rawText))
          .catch((error: unknown) => this.reportHandlerError(error));
      });

      connection.once("error", (error) => {
        void Promise.resolve(handlers.onError?.(error));
        if (!settled) {
          settled = true;
          clearTimeout(connectionTimeout);
          reject(error);
        }
      });

      connection.once("close", () => {
        clearTimeout(connectionTimeout);
        this.clearHeartbeat();
        if (this.connection === connection) {
          this.connection = null;
        }
        if (!this.stopped && this.hasConnected) {
          const disconnectedAt = new Date();
          if (!this.disconnectedAt) {
            this.disconnectedAt = disconnectedAt;
            this.enqueueLifecycle(() => Promise.resolve(handlers.onDisconnect?.(disconnectedAt)));
          }
          this.scheduleReconnect();
        }
        if (!settled) {
          settled = true;
          reject(new Error("Hyperliquid WebSocket closed before the connection opened."));
        }
      });
    });
  }

  private async handleMessage(rawText: string): Promise<void> {
    const handlers = this.handlers;
    if (!handlers) {
      return;
    }
    try {
      const parsed = websocketEnvelopeSchema.safeParse(parseLossless(rawText));
      if (!parsed.success) {
        throw new HyperliquidValidationError("websocket", parsed.error);
      }
      if (parsed.data.channel === "pong" || parsed.data.channel === "subscriptionResponse") {
        return;
      }
      await handlers.onEvent({
        channel: parsed.data.channel,
        data: parsed.data.data,
        rawText,
        receivedAt: new Date(),
      });
    } catch (error) {
      await handlers.onError?.(error);
    }
  }

  private enqueueLifecycle(operation: () => Promise<void>): void {
    this.lifecycleQueue = this.lifecycleQueue
      .then(operation)
      .catch((error: unknown) => this.reportHandlerError(error));
  }

  private async reportHandlerError(error: unknown): Promise<void> {
    try {
      await this.handlers?.onError?.(error);
    } catch (reportingError) {
      console.error(
        JSON.stringify({
          event: "hyperliquid_websocket_error_handler_failed",
          message:
            reportingError instanceof Error ? reportingError.message : String(reportingError),
        }),
      );
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    const delay = Math.min(
      this.maximumReconnectDelayMs,
      this.reconnectBaseDelayMs * 2 ** this.reconnectAttempt,
    );
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect().catch((error: unknown) => {
        void Promise.resolve(this.handlers?.onError?.(error));
        this.scheduleReconnect();
      });
    }, delay);
  }

  private startHeartbeat(connection: WebSocket): void {
    this.clearHeartbeat();
    this.lastActivityAt = Date.now();
    this.heartbeat = setInterval(() => {
      if (connection.readyState === WebSocket.OPEN) {
        if (Date.now() - this.lastActivityAt > this.heartbeatMs * 2) {
          connection.terminate();
          return;
        }
        connection.send(JSON.stringify({ method: "ping" }));
      }
    }, this.heartbeatMs);
    this.heartbeat.unref();
  }

  private clearHeartbeat(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }
}

function subscriptionFor(
  type: HyperliquidUserSubscription,
  user: string,
): Readonly<Record<string, unknown>> {
  if (type === "clearinghouseState" || type === "openOrders") {
    return { dex: "", type, user };
  }
  if (type === "userFills") {
    return { aggregateByTime: false, type, user };
  }
  return { type, user };
}
