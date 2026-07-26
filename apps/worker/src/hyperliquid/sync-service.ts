import type { HyperliquidClient, HyperliquidHttpResponse } from "@chaincopy/blockchain-adapters";
import { errorDetails } from "@chaincopy/config";
import { type HyperliquidJobData } from "@chaincopy/domain";
import { type Logger } from "pino";

import type { HyperliquidRepository } from "./repository.js";

const cursorType = "timestamp";

export class HyperliquidSyncService {
  public constructor(
    private readonly client: HyperliquidClient,
    private readonly repository: HyperliquidRepository,
    private readonly logger: Logger,
  ) {}

  public async syncFills(job: HyperliquidJobData): Promise<Readonly<Record<string, unknown>>> {
    const scope = "fills";
    await this.repository.beginCursor(job.walletAddressId, scope, cursorType);
    try {
      const startTime = await this.resolveStartTime(job, scope);
      const response = await this.client.allUserFillsByTime(
        job.walletAddress,
        startTime,
        resolveEndTime(job),
      );
      await this.repository.saveRawPages(
        job.walletAddressId,
        job.walletAddress,
        "userFillsByTime",
        response.pages,
      );
      const inserted = await this.repository.saveFills(
        job.walletAddressId,
        job.walletAddress,
        response.items,
      );
      const last = response.items.at(-1);
      await this.repository.completeCursor(
        job.walletAddressId,
        scope,
        cursorType,
        last ? new Date(last.time) : undefined,
        last ? `${last.time}:${last.coin}:${last.tid}` : undefined,
      );
      if (response.reachedHistoryLimit) {
        await this.repository.recordQualityIssue({
          details: { maximumAvailableFills: 10_000 },
          issueType: "HYPERLIQUID_FILL_HISTORY_LIMIT",
          message:
            "Hyperliquid公式APIの直近10,000約定上限に到達しました。それ以前の履歴は推測せず欠損として扱います。",
          severity: "WARNING",
          walletAddress: job.walletAddress,
          walletAddressId: job.walletAddressId,
        });
      }
      return {
        fetched: response.items.length,
        inserted,
        reachedHistoryLimit: response.reachedHistoryLimit,
      };
    } catch (error) {
      await this.fail(job, scope, error);
      throw error;
    }
  }

  public async syncFunding(job: HyperliquidJobData): Promise<Readonly<Record<string, unknown>>> {
    const scope = "funding";
    await this.repository.beginCursor(job.walletAddressId, scope, cursorType);
    try {
      const response = await this.client.allUserFunding(
        job.walletAddress,
        await this.resolveStartTime(job, scope),
        resolveEndTime(job),
      );
      await this.repository.saveRawPages(
        job.walletAddressId,
        job.walletAddress,
        "userFunding",
        response.pages,
      );
      const inserted = await this.repository.saveFunding(
        job.walletAddressId,
        job.walletAddress,
        response.items,
      );
      const last = response.items.at(-1);
      await this.repository.completeCursor(
        job.walletAddressId,
        scope,
        cursorType,
        last ? new Date(last.time) : undefined,
        last ? `${last.hash}:${last.time}:${last.delta.coin}` : undefined,
      );
      if (response.reachedHistoryLimit) {
        await this.repository.recordQualityIssue({
          details: { pageSize: 500 },
          issueType: "HYPERLIQUID_FUNDING_PAGINATION_LIMIT",
          message:
            "Funding履歴が同一timestampのAPIページ上限に到達したため、欠損の可能性を記録しました。",
          severity: "WARNING",
          walletAddress: job.walletAddress,
          walletAddressId: job.walletAddressId,
        });
      }
      return { fetched: response.items.length, inserted };
    } catch (error) {
      await this.fail(job, scope, error);
      throw error;
    }
  }

  public async syncLedger(job: HyperliquidJobData): Promise<Readonly<Record<string, unknown>>> {
    const scope = "ledger";
    await this.repository.beginCursor(job.walletAddressId, scope, cursorType);
    try {
      const response = await this.client.allUserLedgerUpdates(
        job.walletAddress,
        await this.resolveStartTime(job, scope),
        resolveEndTime(job),
      );
      await this.repository.saveRawPages(
        job.walletAddressId,
        job.walletAddress,
        "userNonFundingLedgerUpdates",
        response.pages,
      );
      const inserted = await this.repository.saveLedger(
        job.walletAddressId,
        job.walletAddress,
        response.items,
      );
      const last = response.items.at(-1);
      await this.repository.completeCursor(
        job.walletAddressId,
        scope,
        cursorType,
        last ? new Date(last.time) : undefined,
        last ? `${last.hash}:${last.time}:${last.delta.type}` : undefined,
      );
      if (response.reachedHistoryLimit) {
        await this.repository.recordQualityIssue({
          details: { pageSize: 500 },
          issueType: "HYPERLIQUID_LEDGER_PAGINATION_LIMIT",
          message:
            "Ledger履歴が同一timestampのAPIページ上限に到達したため、欠損の可能性を記録しました。",
          severity: "WARNING",
          walletAddress: job.walletAddress,
          walletAddressId: job.walletAddressId,
        });
      }
      return { fetched: response.items.length, inserted };
    } catch (error) {
      await this.fail(job, scope, error);
      throw error;
    }
  }

  public async snapshotPositions(
    job: HyperliquidJobData,
  ): Promise<Readonly<Record<string, unknown>>> {
    const scope = "account-snapshot";
    await this.repository.beginCursor(job.walletAddressId, scope, cursorType);
    const failures: string[] = [];
    let successes = 0;

    const runPart = async (part: string, operation: () => Promise<void>): Promise<void> => {
      try {
        await operation();
        successes += 1;
      } catch (error) {
        const message = errorDetails(error).message;
        failures.push(`${part}: ${message}`);
        this.logger.warn(
          { error: errorDetails(error), part, walletAddress: job.walletAddress },
          "Hyperliquid snapshot part failed",
        );
        await this.repository.recordQualityIssue({
          details: { part },
          issueType: "HYPERLIQUID_PARTIAL_API_FAILURE",
          message: `${part}の取得に失敗しました: ${message}`,
          severity: "WARNING",
          walletAddress: job.walletAddress,
          walletAddressId: job.walletAddressId,
        });
      }
    };

    await runPart("clearinghouseState", async () => {
      const response = await this.client.clearinghouseState(job.walletAddress);
      const capturedAt = new Date();
      await this.saveHttpRaw(job, "clearinghouseState", response);
      await this.repository.savePositions(
        job.walletAddressId,
        job.walletAddress,
        response.data,
        capturedAt,
      );
      await this.repository.saveClearinghouseSnapshot(
        job.walletAddressId,
        job.walletAddress,
        response.data,
        response.rawText,
        capturedAt,
      );
    });
    await runPart("spotClearinghouseState", async () => {
      const response = await this.client.spotClearinghouseState(job.walletAddress);
      const capturedAt = new Date();
      await this.saveHttpRaw(job, "spotClearinghouseState", response);
      await this.repository.saveSpotBalances(
        job.walletAddressId,
        job.walletAddress,
        response.data,
        capturedAt,
      );
    });
    await runPart("portfolio", async () => {
      const response = await this.client.portfolio(job.walletAddress);
      const capturedAt = new Date();
      await this.saveHttpRaw(job, "portfolio", response);
      await this.repository.savePortfolioHistory(
        job.walletAddressId,
        job.walletAddress,
        response.data,
        response.rawText,
        capturedAt,
      );
    });
    await runPart("openOrders", async () => {
      const response = await this.client.openOrders(job.walletAddress);
      await this.saveHttpRaw(job, "openOrders", response);
      await this.repository.saveOpenOrders(job.walletAddressId, job.walletAddress, response.data);
    });
    await runPart("frontendOpenOrders", async () => {
      const response = await this.client.frontendOpenOrders(job.walletAddress);
      await this.saveHttpRaw(job, "frontendOpenOrders", response);
      await this.repository.saveOpenOrders(job.walletAddressId, job.walletAddress, response.data);
    });
    await runPart("historicalOrders", async () => {
      const response = await this.client.historicalOrders(job.walletAddress);
      await this.saveHttpRaw(job, "historicalOrders", response);
      await this.repository.saveHistoricalOrders(
        job.walletAddressId,
        job.walletAddress,
        response.data,
      );
    });
    await runPart("userRateLimit", async () => {
      const response = await this.client.userRateLimit(job.walletAddress);
      await this.saveHttpRaw(job, "userRateLimit", response);
    });

    if (failures.length > 0) {
      const message = `Hyperliquid snapshot failure: ${failures.join("; ")}`;
      await this.repository.failCursor(job.walletAddressId, scope, cursorType, message);
      await this.repository.markSourceFailure(message);
      throw new Error(message);
    }

    const completedAt = new Date();
    await this.repository.completeCursor(
      job.walletAddressId,
      scope,
      cursorType,
      completedAt,
      completedAt.toISOString(),
    );
    await this.repository.markSourceSuccess("Hyperliquid snapshot completed.");
    return { failures, successes };
  }

  public async recoverGap(job: HyperliquidJobData): Promise<Readonly<Record<string, unknown>>> {
    if (!job.startTime || !job.endTime) {
      throw new RangeError("Hyperliquid gap recovery requires startTime and endTime.");
    }
    const logContext = {
      endTime: job.endTime,
      startTime: job.startTime,
      walletAddress: job.walletAddress,
      walletAddressId: job.walletAddressId,
    };
    this.logger.info(
      {
        event: "hyperliquid_gap_recovery_started",
        ...logContext,
      },
      "Hyperliquid gap recovery started",
    );

    try {
      const [fills, funding, ledger] = await Promise.all([
        this.syncFills(job),
        this.syncFunding(job),
        this.syncLedger(job),
      ]);
      const connectionCursorUpdated = await this.repository.completeWebSocketGap(
        job.walletAddressId,
        job.startTime,
        job.endTime,
      );
      if (!connectionCursorUpdated) {
        throw new Error(
          "Hyperliquid gap recovery could not complete the matching WebSocket cursor.",
        );
      }
      await this.repository.resolveQualityIssue({
        details: { disconnectedAt: job.startTime },
        issueType: "HYPERLIQUID_WEBSOCKET_GAP",
        walletAddress: job.walletAddress,
      });
      await this.repository.markSourceSuccess("Hyperliquid WebSocket gap recovery completed.");
      const result = { connectionCursorUpdated, fills, funding, ledger };
      this.logger.info(
        {
          event: "hyperliquid_gap_recovery_succeeded",
          ...logContext,
          result,
        },
        "Hyperliquid gap recovery succeeded",
      );
      return result;
    } catch (error) {
      this.logger.error(
        {
          error: errorDetails(error),
          event: "hyperliquid_gap_recovery_failed",
          ...logContext,
        },
        "Hyperliquid gap recovery failed",
      );
      throw error;
    }
  }

  public auditDataQuality(job: HyperliquidJobData): Promise<Readonly<Record<string, unknown>>> {
    return this.repository.auditWallet(job.walletAddressId, job.walletAddress);
  }

  private async saveHttpRaw<T>(
    job: HyperliquidJobData,
    eventType: string,
    response: HyperliquidHttpResponse<T>,
  ): Promise<void> {
    await this.repository.saveRawEvent({
      eventType,
      rawPayload: response.rawText,
      transport: "HTTP",
      walletAddress: job.walletAddress,
      walletAddressId: job.walletAddressId,
    });
  }

  private async resolveStartTime(job: HyperliquidJobData, scope: string): Promise<number> {
    if (job.startTime) {
      return parseJobTimestamp(job.startTime, "startTime");
    }
    const cursor = await this.repository.getCursor(job.walletAddressId, scope, cursorType);
    return cursor.lastTimestamp ? cursor.lastTimestamp.getTime() : 0;
  }

  private async fail(job: HyperliquidJobData, scope: string, error: unknown): Promise<void> {
    const message = errorDetails(error).message;
    await this.repository.failCursor(job.walletAddressId, scope, cursorType, message);
    await this.repository.markSourceFailure(message);
  }
}

function resolveEndTime(job: HyperliquidJobData): number {
  return job.endTime ? parseJobTimestamp(job.endTime, "endTime") : Date.now();
}

function parseJobTimestamp(value: string, field: "requestedAt" | "startTime" | "endTime"): number {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    throw new RangeError(`Hyperliquid job ${field} must be a valid date-time.`);
  }
  return timestamp;
}
