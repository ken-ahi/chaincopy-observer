import {
  HyperliquidMarketWebSocketClient,
  mapMarketTrade,
  type HyperliquidClient,
  type HyperliquidMarketWebSocketClientOptions,
} from "@chaincopy/blockchain-adapters";
import { errorDetails } from "@chaincopy/config";
import { type HyperliquidDiscoveryJobData } from "@chaincopy/domain";
import { type Queue } from "bullmq";
import { type Logger } from "pino";

import { discoveryTradeJobId, enqueueCandidateUpsert } from "./queue.js";
import { type HyperliquidDiscoveryRepository } from "./repository.js";

export class HyperliquidDiscoveryWebSocketSupervisor {
  private activeCoins: ReadonlyArray<string> = [];
  private client: HyperliquidMarketWebSocketClient | null = null;
  private ensureOperation: Promise<Readonly<Record<string, unknown>>> | null = null;

  public constructor(
    private readonly webSocketUrl: string,
    private readonly httpClient: HyperliquidClient,
    private readonly repository: HyperliquidDiscoveryRepository,
    private readonly queue: Queue<HyperliquidDiscoveryJobData>,
    private readonly logger: Logger,
    private readonly clientOptions: HyperliquidMarketWebSocketClientOptions = {},
  ) {}

  public ensureRunning(): Promise<Readonly<Record<string, unknown>>> {
    if (this.ensureOperation) {
      return this.ensureOperation;
    }
    const operation = this.ensureRunningExclusive();
    const trackedOperation = operation.finally(() => {
      if (this.ensureOperation === trackedOperation) {
        this.ensureOperation = null;
      }
    });
    this.ensureOperation = trackedOperation;
    return trackedOperation;
  }

  public async stop(): Promise<void> {
    const ensureOperation = this.ensureOperation;
    if (ensureOperation) {
      await ensureOperation.catch(() => undefined);
    }
    await this.stopClient();
  }

  private async ensureRunningExclusive(): Promise<Readonly<Record<string, unknown>>> {
    const settings = await this.repository.getSettings();
    if (!settings.enabled) {
      await this.stopClient();
      return { listening: false, reason: "disabled" };
    }
    let coins = await this.resolveCoins(settings.mode, settings.priorityCoins);
    const latestSettings = await this.repository.getSettings();
    if (!latestSettings.enabled) {
      await this.stopClient();
      return { listening: false, reason: "disabled" };
    }
    if (
      latestSettings.mode !== settings.mode ||
      !sameCoins(latestSettings.priorityCoins, settings.priorityCoins)
    ) {
      coins = await this.resolveCoins(latestSettings.mode, latestSettings.priorityCoins);
    }
    if (
      this.client &&
      coins.length === this.activeCoins.length &&
      coins.every((coin, index) => coin === this.activeCoins[index])
    ) {
      return { coins, listening: true };
    }

    await this.restart(coins);
    return { coins, listening: true };
  }

  private async stopClient(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.activeCoins = [];
    if (client) {
      await client.stop();
    }
    await this.repository.setWebSocketStatus("STOPPED", { coins: [] });
  }

  private async restart(coins: ReadonlyArray<string>): Promise<void> {
    if (this.client) {
      await this.client.stop();
    }
    await this.repository.setWebSocketStatus("STARTING", { coins });
    const client = new HyperliquidMarketWebSocketClient(this.webSocketUrl, this.clientOptions);
    this.client = client;
    this.activeCoins = coins;
    await client.start(coins, {
      onConnected: async (connectedAt) => {
        const resumedFrom = await this.repository.recordDiscoveryStartupGap(connectedAt);
        await this.repository.setWebSocketStatus("CONNECTED", { coins, connectedAt });
        this.logger.info(
          {
            coinCount: coins.length,
            coins,
            resumedFrom: resumedFrom?.toISOString() ?? null,
          },
          "Market discovery WebSocket connected",
        );
      },
      onDisconnect: async (disconnectedAt) => {
        await this.repository.setWebSocketStatus("RECONNECTING", {
          coins,
          disconnectedAt,
        });
        await this.repository.recordDiscoveryGap(disconnectedAt);
        this.logger.warn(
          { coinCount: coins.length, disconnectedAt: disconnectedAt.toISOString() },
          "Market discovery WebSocket disconnected",
        );
      },
      onError: async (error) => {
        this.logger.error(
          { error: errorDetails(error) },
          "Market discovery WebSocket processing error",
        );
      },
      onReconnect: async (disconnectedAt, reconnectedAt) => {
        await this.repository.recordDiscoveryGap(disconnectedAt, reconnectedAt);
        await this.repository.setWebSocketStatus("CONNECTED", {
          coins,
          connectedAt: reconnectedAt,
        });
        this.logger.info(
          {
            coinCount: coins.length,
            disconnectedAt: disconnectedAt.toISOString(),
            reconnectedAt: reconnectedAt.toISOString(),
          },
          "Market discovery WebSocket reconnected and resubscribed",
        );
      },
      onReconnectExhausted: async (attempts) => {
        await this.repository.setWebSocketStatus("DEGRADED", { coins });
        this.logger.error(
          { attempts, coinCount: coins.length },
          "Market discovery WebSocket exhausted reconnect attempts",
        );
      },
      onTrades: async (trades, receivedAt) => {
        const mappedTrades = trades.map(mapMarketTrade);
        await this.repository.recordReceivedTradeEvents(mappedTrades.length);
        const uniqueTrades = new Map(mappedTrades.map((trade) => [trade.fingerprint, trade]));
        let duplicateCount = mappedTrades.length - uniqueTrades.size;
        for (const trade of uniqueTrades.values()) {
          const existing = await this.queue.getJob(discoveryTradeJobId(trade.fingerprint));
          if (existing) {
            duplicateCount += 1;
          } else {
            await enqueueCandidateUpsert(this.queue, {
              kind: "trade",
              requestedAt: receivedAt.toISOString(),
              trade,
            });
          }
        }
        await this.repository.recordDuplicateTradeEvents(duplicateCount);
      },
    });
  }

  private async resolveCoins(
    mode: "MAJOR" | "ALL",
    priorityCoins: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<string>> {
    const metadata = await this.httpClient.meta();
    const activeCoins = metadata.data.universe
      .filter((asset) => asset.isDelisted !== true)
      .map((asset) => asset.name);
    const activeSet = new Set(activeCoins);
    const selected =
      mode === "ALL" ? activeCoins : priorityCoins.filter((coin) => activeSet.has(coin));
    if (selected.length === 0) {
      throw new Error("No configured Hyperliquid perpetual market is active.");
    }
    if (selected.length > 1_000) {
      throw new Error("Active market subscriptions exceed the official limit of 1000.");
    }
    return [...new Set(selected)].sort();
  }
}

function sameCoins(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
  return left.length === right.length && left.every((coin, index) => coin === right[index]);
}
