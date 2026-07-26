import {
  HyperliquidValidationError,
  HyperliquidWebSocketClient,
  fillSchema,
  websocketClearinghouseStateSchema,
  websocketLedgerUpdatesSchema,
  websocketOpenOrdersSchema,
  websocketOrderUpdatesSchema,
  websocketUserEventSchema,
  websocketUserFillsSchema,
  websocketUserFundingsSchema,
  websocketFundingSchema,
  type HyperliquidWebSocketEvent,
} from "@chaincopy/blockchain-adapters";
import { errorDetails } from "@chaincopy/config";
import { type HyperliquidJobData } from "@chaincopy/domain";
import { type Queue } from "bullmq";
import { type Logger } from "pino";

import { enqueueHyperliquidGapRecovery } from "./queue.js";
import type { HyperliquidRepository } from "./repository.js";

const maximumWebSocketUsers = 10;

export interface WatchedWallet {
  readonly address: string;
  readonly id: string;
}

export class HyperliquidWebSocketSupervisor {
  private readonly clients = new Map<string, HyperliquidWebSocketClient>();

  public constructor(
    private readonly webSocketUrl: string,
    private readonly repository: HyperliquidRepository,
    private readonly queue: Queue<HyperliquidJobData>,
    private readonly logger: Logger,
    private readonly clientOptions: ConstructorParameters<
      typeof HyperliquidWebSocketClient
    >[1] = {},
  ) {}

  public async reconcile(wallets: ReadonlyArray<WatchedWallet>): Promise<void> {
    const allowed = wallets.slice(0, maximumWebSocketUsers);
    const allowedIds = new Set(allowed.map((wallet) => wallet.id));
    await Promise.all(
      [...this.clients.entries()]
        .filter(([walletAddressId]) => !allowedIds.has(walletAddressId))
        .map(async ([walletAddressId, client]) => {
          await client.stop();
          this.clients.delete(walletAddressId);
        }),
    );
    await Promise.all(allowed.map((wallet) => this.ensureWallet(wallet)));

    for (const wallet of wallets.slice(maximumWebSocketUsers)) {
      await this.repository.recordQualityIssue({
        details: { maximumWebSocketUsers },
        issueType: "HYPERLIQUID_WEBSOCKET_USER_LIMIT",
        message:
          "Hyperliquid公式上限によりWebSocket監視は先頭10アドレスまでです。このアドレスはHTTP欠損補完のみで同期します。",
        severity: "WARNING",
        walletAddress: wallet.address,
        walletAddressId: wallet.id,
      });
    }
  }

  public async ensureWallet(wallet: WatchedWallet): Promise<void> {
    if (this.clients.has(wallet.id)) {
      return;
    }
    const client = new HyperliquidWebSocketClient(this.webSocketUrl, this.clientOptions);
    this.clients.set(wallet.id, client);
    await this.repository.beginCursor(wallet.id, "websocket", "connection");

    try {
      await client.start(wallet.address, {
        onDisconnect: async (disconnectedAt) => {
          try {
            const gapCursorRecorded = await this.repository.recordWebSocketGap(
              wallet.id,
              disconnectedAt.toISOString(),
            );
            if (!gapCursorRecorded) {
              throw new Error(
                "Hyperliquid WebSocket gap cursor was not recorded because a newer cursor exists.",
              );
            }
            await this.repository.recordQualityIssue({
              details: { disconnectedAt: disconnectedAt.toISOString() },
              issueType: "HYPERLIQUID_WEBSOCKET_GAP",
              message: "WebSocketが切断されました。再接続後にHTTPで欠損補完します。",
              severity: "WARNING",
              walletAddress: wallet.address,
              walletAddressId: wallet.id,
            });
            await this.repository.markSourceFailure(
              `Hyperliquid WebSocket disconnected at ${disconnectedAt.toISOString()}.`,
            );
            this.logger.warn(
              {
                disconnectedAt: disconnectedAt.toISOString(),
                event: "hyperliquid_websocket_disconnected",
                walletAddress: wallet.address,
                walletAddressId: wallet.id,
              },
              "Hyperliquid WebSocket disconnected; awaiting reconnect",
            );
          } catch (error) {
            this.logger.error(
              {
                disconnectedAt: disconnectedAt.toISOString(),
                error: errorDetails(error),
                event: "hyperliquid_gap_cursor_persist_failed",
                walletAddress: wallet.address,
                walletAddressId: wallet.id,
              },
              "Failed to record Hyperliquid WebSocket disconnection",
            );
          }
        },
        onError: async (error) => {
          const details = errorDetails(error);
          this.logger.warn(
            { error: details, walletAddress: wallet.address },
            "Hyperliquid WebSocket error",
          );
          try {
            await this.repository.recordQualityIssue({
              details: { error: details.message },
              issueType: "HYPERLIQUID_WEBSOCKET_ERROR",
              message: details.message,
              severity: "WARNING",
              walletAddress: wallet.address,
              walletAddressId: wallet.id,
            });
          } catch (recordingError) {
            this.logger.error(
              {
                error: errorDetails(recordingError),
                originalError: details,
                walletAddress: wallet.address,
              },
              "Failed to record Hyperliquid WebSocket error",
            );
          }
        },
        onEvent: async (event) => this.handleEvent(wallet, event),
        onReconnect: async (disconnectedAt, reconnectedAt) => {
          const gapCursorRecorded = await this.repository.recordWebSocketGap(
            wallet.id,
            disconnectedAt.toISOString(),
          );
          if (!gapCursorRecorded) {
            throw new Error(
              "Hyperliquid WebSocket gap cursor was not recorded because a newer cursor exists.",
            );
          }
          await this.repository.recordQualityIssue({
            details: { disconnectedAt: disconnectedAt.toISOString() },
            issueType: "HYPERLIQUID_WEBSOCKET_GAP",
            message: "WebSocket切断区間をHTTPで欠損補完します。",
            severity: "WARNING",
            walletAddress: wallet.address,
            walletAddressId: wallet.id,
          });
          const jobData = {
            endTime: reconnectedAt.toISOString(),
            requestedAt: reconnectedAt.toISOString(),
            startTime: disconnectedAt.toISOString(),
            walletAddress: wallet.address,
            walletAddressId: wallet.id,
          };
          const jobId = await enqueueHyperliquidGapRecovery(this.queue, jobData);
          this.logger.info(
            {
              disconnectedAt: disconnectedAt.toISOString(),
              event: "hyperliquid_gap_recovery_queued",
              jobId,
              reconnectedAt: reconnectedAt.toISOString(),
              walletAddress: wallet.address,
              walletAddressId: wallet.id,
            },
            "Hyperliquid WebSocket reconnected and gap recovery queued",
          );
        },
      });
      await this.repository.completeCursor(
        wallet.id,
        "websocket",
        "connection",
        new Date(),
        "connected",
      );
    } catch (error) {
      this.clients.delete(wallet.id);
      try {
        await client.stop();
      } catch (stopError) {
        this.logger.warn(
          {
            error: errorDetails(stopError),
            walletAddress: wallet.address,
          },
          "Failed to stop an uninitialized Hyperliquid WebSocket client",
        );
      }
      await this.repository.failCursor(
        wallet.id,
        "websocket",
        "connection",
        errorDetails(error).message,
      );
      throw error;
    }
  }

  public async stop(): Promise<void> {
    await Promise.all([...this.clients.values()].map((client) => client.stop()));
    this.clients.clear();
  }

  private async handleEvent(
    wallet: WatchedWallet,
    event: HyperliquidWebSocketEvent,
  ): Promise<void> {
    await this.repository.saveRawEvent({
      eventTime: event.receivedAt,
      eventType: event.channel,
      rawPayload: event.rawText,
      transport: "WEBSOCKET",
      walletAddress: wallet.address,
      walletAddressId: wallet.id,
    });

    switch (event.channel) {
      case "userFills": {
        const parsed = parseOrThrow("userFills", websocketUserFillsSchema, event.data);
        await this.repository.saveFills(wallet.id, wallet.address, parsed.fills);
        break;
      }
      case "userFundings": {
        const parsed = parseOrThrow("userFundings", websocketUserFundingsSchema, event.data);
        await this.repository.saveWebSocketFunding(wallet.id, wallet.address, parsed.fundings);
        break;
      }
      case "userNonFundingLedgerUpdates": {
        const parsed = parseOrThrow(
          "userNonFundingLedgerUpdates",
          websocketLedgerUpdatesSchema,
          event.data,
        );
        await this.repository.saveLedger(wallet.id, wallet.address, parsed.nonFundingLedgerUpdates);
        break;
      }
      case "orderUpdates": {
        const parsed = parseOrThrow("orderUpdates", websocketOrderUpdatesSchema, event.data);
        await this.repository.saveHistoricalOrders(wallet.id, wallet.address, parsed);
        break;
      }
      case "clearinghouseState": {
        const parsed = parseOrThrow(
          "clearinghouseState",
          websocketClearinghouseStateSchema,
          event.data,
        );
        await this.repository.savePositions(wallet.id, wallet.address, parsed, event.receivedAt);
        await this.repository.saveClearinghouseSnapshot(
          wallet.id,
          wallet.address,
          parsed,
          event.rawText,
          event.receivedAt,
        );
        break;
      }
      case "openOrders": {
        const parsed = parseOrThrow("openOrders", websocketOpenOrdersSchema, event.data);
        await this.repository.saveOpenOrders(wallet.id, wallet.address, parsed);
        break;
      }
      case "userEvents": {
        const parsed = parseOrThrow("userEvents", websocketUserEventSchema, event.data);
        if ("fills" in parsed) {
          const fills = parseOrThrow(
            "userEvents.fills",
            { safeParse: (value: unknown) => fillSchema.array().safeParse(value) },
            parsed.fills,
          );
          await this.repository.saveFills(wallet.id, wallet.address, fills);
        } else if ("funding" in parsed) {
          const funding = parseOrThrow(
            "userEvents.funding",
            websocketFundingSchema,
            parsed.funding,
          );
          await this.repository.saveWebSocketFunding(wallet.id, wallet.address, [funding]);
        }
        break;
      }
      default:
        break;
    }

    await this.repository.completeCursor(
      wallet.id,
      `websocket:${event.channel}`,
      "event-time",
      event.receivedAt,
      null,
    );
  }
}

function parseOrThrow<Output>(
  endpointType: string,
  schema: {
    safeParse(value: unknown):
      | { readonly success: true; readonly data: Output }
      | {
          readonly success: false;
          readonly error: ConstructorParameters<typeof HyperliquidValidationError>[1];
        };
  },
  value: unknown,
): Output {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new HyperliquidValidationError(endpointType, result.error);
  }
  return result.data;
}
