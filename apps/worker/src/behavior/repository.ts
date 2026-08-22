import { createHash } from "node:crypto";

import {
  effectiveWalletSelectionStatus,
  type SelectedWalletBehaviorEventValue,
} from "@chaincopy/analytics";
import type { BehaviorDataQualityReason, Prisma, PrismaClient } from "@chaincopy/database";

export const BEHAVIOR_READ_BATCH_SIZE = 5_000;
export const BEHAVIOR_WRITE_BATCH_SIZE = 1_000;
export const MAX_TIMESTAMP_GROUP_SIZE = 20_000;
export const MAX_LATE_REBUILD_EVENTS = 50_000;
export const MAX_LATE_REBUILD_MILLISECONDS = 30 * 24 * 60 * 60 * 1_000;

export interface EffectiveBehaviorWallet {
  readonly performanceRunId: string | null;
  readonly selectionRunId: string;
  readonly evaluatedAt: Date;
  readonly walletAddressId: string;
}

export interface BehaviorFillRow {
  readonly id: string;
  readonly sourceTradeId: string | null;
  readonly coin: string;
  readonly side: "BUY" | "SELL";
  readonly size: string;
  readonly price: string;
  readonly startPosition: string;
  readonly occurredAt: Date;
}

export interface BehaviorFillPage {
  readonly fills: readonly BehaviorFillRow[];
  readonly hasMore: boolean;
  readonly incompleteTimestampGroupAt: Date | null;
}

export class BehaviorRepository {
  public constructor(
    private readonly database: PrismaClient,
    private readonly sourceId: string,
  ) {}

  /** Consumes the persisted current Selection Run; never creates one and never falls back to watched wallets. */
  public async listEffectiveSelectedWallets(): Promise<readonly EffectiveBehaviorWallet[]> {
    const settings = await this.database.walletSelectionSettings.findUnique({
      select: { currentSelectionRunId: true },
      where: { sourceId: this.sourceId },
    });
    if (!settings?.currentSelectionRunId) return [];
    const run = await this.database.walletSelectionRun.findFirst({
      select: {
        evaluatedAt: true,
        id: true,
        results: {
          select: {
            automaticStatus: true,
            performanceRunId: true,
            walletAddressId: true,
            walletAddress: { select: { walletSelectionOverride: { select: { decision: true } } } },
          },
        },
      },
      where: { id: settings.currentSelectionRunId, sourceId: this.sourceId },
    });
    if (!run) return [];
    return run.results
      .filter(
        (result) =>
          effectiveWalletSelectionStatus(
            result.automaticStatus,
            result.walletAddress.walletSelectionOverride?.decision ?? "AUTO",
          ) === "SELECTED",
      )
      .map((result) => ({
        evaluatedAt: run.evaluatedAt,
        performanceRunId: result.performanceRunId,
        selectionRunId: run.id,
        walletAddressId: result.walletAddressId,
      }));
  }

  public async listCoins(walletAddressId: string): Promise<readonly string[]> {
    const rows = await this.database.normalizedTrade.findMany({
      distinct: ["coin"],
      orderBy: { coin: "asc" },
      select: { coin: true },
      where: { sourceId: this.sourceId, walletAddressId },
    });
    return rows.map((row) => row.coin);
  }

  public async loadFillPage(
    walletAddressId: string,
    coin: string,
    after: Date | null,
  ): Promise<BehaviorFillPage> {
    const baseWhere = {
      coin,
      sourceId: this.sourceId,
      walletAddressId,
      ...(after ? { occurredAt: { gt: after } } : {}),
    };
    const rows = await this.database.normalizedTrade.findMany({
      orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
      select: {
        coin: true,
        id: true,
        occurredAt: true,
        price: true,
        side: true,
        size: true,
        sourceTradeId: true,
        startPosition: true,
      },
      take: BEHAVIOR_READ_BATCH_SIZE + 1,
      where: baseWhere,
    });
    if (rows.length <= BEHAVIOR_READ_BATCH_SIZE)
      return { fills: rows.map(toFillRow), hasMore: false, incompleteTimestampGroupAt: null };
    const boundaryAt = rows[BEHAVIOR_READ_BATCH_SIZE - 1]!.occurredAt;
    const lookahead = rows[BEHAVIOR_READ_BATCH_SIZE]!;
    if (lookahead.occurredAt.getTime() !== boundaryAt.getTime()) {
      return {
        fills: rows.slice(0, BEHAVIOR_READ_BATCH_SIZE).map(toFillRow),
        hasMore: true,
        incompleteTimestampGroupAt: null,
      };
    }
    const prefix = rows
      .slice(0, BEHAVIOR_READ_BATCH_SIZE)
      .filter((row) => row.occurredAt.getTime() < boundaryAt.getTime());
    const completeGroup = await this.database.normalizedTrade.findMany({
      orderBy: { id: "asc" },
      select: {
        coin: true,
        id: true,
        occurredAt: true,
        price: true,
        side: true,
        size: true,
        sourceTradeId: true,
        startPosition: true,
      },
      take: MAX_TIMESTAMP_GROUP_SIZE + 1,
      where: { coin, occurredAt: boundaryAt, sourceId: this.sourceId, walletAddressId },
    });
    if (completeGroup.length > MAX_TIMESTAMP_GROUP_SIZE)
      return {
        fills: prefix.map(toFillRow),
        hasMore: true,
        incompleteTimestampGroupAt: boundaryAt,
      };
    return {
      fills: [...prefix, ...completeGroup].map(toFillRow),
      hasMore: true,
      incompleteTimestampGroupAt: null,
    };
  }

  public async hasHistoryGap(walletAddressId: string): Promise<boolean> {
    return (
      (await this.database.syncCursor.count({
        where: { sourceId: this.sourceId, status: "GAP_DETECTED", walletAddressId },
      })) > 0
    );
  }

  public loadCursor(walletAddressId: string, coin: string, behaviorVersion: string) {
    return this.database.behaviorNormalizationCursor.findUnique({
      where: { walletAddressId_coin_behaviorVersion: { behaviorVersion, coin, walletAddressId } },
    });
  }

  public async rewindForLateFill(
    walletAddressId: string,
    coin: string,
    behaviorVersion: string,
    rebuildFrom: Date,
  ): Promise<void> {
    const cursor = await this.loadCursor(walletAddressId, coin, behaviorVersion);
    if (
      cursor?.lastCompletedTimestamp &&
      cursor.lastCompletedTimestamp.getTime() - rebuildFrom.getTime() >
        MAX_LATE_REBUILD_MILLISECONDS
    ) {
      throw new RangeError("Late-fill rebuild exceeds the 30-day bounded window.");
    }
    const affected = await this.database.selectedWalletBehaviorEvent.findMany({
      select: { id: true },
      take: MAX_LATE_REBUILD_EVENTS + 1,
      where: {
        behaviorVersion,
        coin,
        occurredAt: {
          gte: rebuildFrom,
          ...(cursor?.lastCompletedTimestamp ? { lte: cursor.lastCompletedTimestamp } : {}),
        },
        walletAddressId,
      },
    });
    if (affected.length > MAX_LATE_REBUILD_EVENTS) {
      throw new RangeError("Late-fill rebuild exceeds the 50,000-event bounded window.");
    }
    await this.database.$transaction(async (transaction) => {
      const previous = await transaction.selectedWalletBehaviorEvent.findFirst({
        orderBy: [{ occurredAt: "desc" }, { sourceOrdinal: "desc" }, { id: "desc" }],
        select: { afterPosition: true, occurredAt: true, sourceEventId: true },
        where: { behaviorVersion, coin, occurredAt: { lt: rebuildFrom }, walletAddressId },
      });
      await transaction.selectedWalletBehaviorEvent.deleteMany({
        where: { id: { in: affected.map((event) => event.id) } },
      });
      await transaction.behaviorNormalizationCursor.upsert({
        create: {
          behaviorVersion,
          boundaryAfterPosition: previous?.afterPosition ?? null,
          coin,
          lastCompletedTimestamp: previous?.occurredAt ?? null,
          lastSourceEventId: previous?.sourceEventId ?? null,
          walletAddressId,
        },
        update: {
          boundaryAfterPosition: previous?.afterPosition ?? null,
          lastCompletedTimestamp: previous?.occurredAt ?? null,
          lastSourceEventId: previous?.sourceEventId ?? null,
          normalizationRunId: null,
        },
        where: { walletAddressId_coin_behaviorVersion: { behaviorVersion, coin, walletAddressId } },
      });
    });
  }

  public async createRun(input: {
    behaviorVersion: string;
    walletAddressId: string;
    coin: string;
    calculationFrom: Date;
    calculationTo: Date;
    inputFingerprint: string;
  }) {
    return this.database.behaviorNormalizationRun.upsert({
      create: { ...input, sourceId: this.sourceId, startedAt: new Date(), status: "RUNNING" },
      update: { errorCode: null, errorMessage: null, startedAt: new Date(), status: "RUNNING" },
      where: {
        behaviorVersion_walletAddressId_coin_calculationFrom_calculationTo_inputFingerprint: input,
      },
    });
  }

  public async saveSuccessfulGroup(input: {
    walletAddressId: string;
    coin: string;
    behaviorVersion: string;
    runId: string;
    completedAt: Date;
    afterPosition: string;
    events: readonly SelectedWalletBehaviorEventValue[];
  }): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      for (let offset = 0; offset < input.events.length; offset += BEHAVIOR_WRITE_BATCH_SIZE) {
        await transaction.selectedWalletBehaviorEvent.createMany({
          data: input.events.slice(offset, offset + BEHAVIOR_WRITE_BATCH_SIZE).map((event) => ({
            ...event,
            normalizationRunId: input.runId,
            sourceId: this.sourceId,
            walletAddressId: input.walletAddressId,
          })),
          skipDuplicates: true,
        });
      }
      await transaction.behaviorNormalizationCursor.upsert({
        create: {
          behaviorVersion: input.behaviorVersion,
          boundaryAfterPosition: input.afterPosition,
          coin: input.coin,
          lastCompletedTimestamp: input.completedAt,
          lastSourceEventId: input.events.at(-1)?.sourceEventId ?? null,
          normalizationRunId: input.runId,
          walletAddressId: input.walletAddressId,
        },
        update: {
          boundaryAfterPosition: input.afterPosition,
          lastCompletedTimestamp: input.completedAt,
          lastSourceEventId: input.events.at(-1)?.sourceEventId ?? null,
          normalizationRunId: input.runId,
        },
        where: {
          walletAddressId_coin_behaviorVersion: {
            behaviorVersion: input.behaviorVersion,
            coin: input.coin,
            walletAddressId: input.walletAddressId,
          },
        },
      });
      await transaction.behaviorDataQualityIssue.updateMany({
        data: { resolvedAt: new Date(), status: "RESOLVED" },
        where: {
          coin: input.coin,
          sourceGroupAt: input.completedAt,
          status: "OPEN",
          walletAddressId: input.walletAddressId,
        },
      });
    });
  }

  public async recordIssue(input: {
    walletAddressId: string;
    coin: string;
    runId: string;
    reason: BehaviorDataQualityReason;
    detail: string;
    sourceGroupAt: Date | null;
  }): Promise<void> {
    const fingerprint = createHash("sha256")
      .update(
        [
          input.walletAddressId,
          input.coin,
          input.sourceGroupAt?.toISOString() ?? "none",
          input.reason,
          "behavior-v1",
        ].join("\u0000"),
      )
      .digest("hex");
    await this.database.behaviorDataQualityIssue.upsert({
      create: {
        behaviorVersion: "behavior-v1",
        coin: input.coin,
        detail: input.detail,
        fingerprint,
        normalizationRunId: input.runId,
        reason: input.reason,
        sourceGroupAt: input.sourceGroupAt,
        sourceId: this.sourceId,
        walletAddressId: input.walletAddressId,
      },
      update: {
        detail: input.detail,
        lastObservedAt: new Date(),
        normalizationRunId: input.runId,
        reevaluationCount: { increment: 1 },
        resolvedAt: null,
        status: "OPEN",
      },
      where: { fingerprint },
    });
    await this.database.behaviorNormalizationRun.update({
      data: { errorCode: input.reason, errorMessage: input.detail, status: "BLOCKED" },
      where: { id: input.runId },
    });
  }

  public async completeRun(runId: string): Promise<void> {
    await this.database.behaviorNormalizationRun.update({
      data: { completedAt: new Date(), status: "SUCCEEDED" },
      where: { id: runId },
    });
  }

  public async addSelectionScope(runId: string, wallet: EffectiveBehaviorWallet): Promise<void> {
    await this.database.behaviorSelectionScope.upsert({
      create: {
        behaviorNormalizationRunId: runId,
        evaluatedAt: wallet.evaluatedAt,
        performanceRunId: wallet.performanceRunId,
        processedAt: new Date(),
        selectionRunId: wallet.selectionRunId,
        walletAddressId: wallet.walletAddressId,
      },
      update: { performanceRunId: wallet.performanceRunId, processedAt: new Date() },
      where: {
        selectionRunId_walletAddressId_behaviorNormalizationRunId: {
          behaviorNormalizationRunId: runId,
          selectionRunId: wallet.selectionRunId,
          walletAddressId: wallet.walletAddressId,
        },
      },
    });
  }
}

function toFillRow(row: {
  id: string;
  sourceTradeId: string | null;
  coin: string;
  side: "BUY" | "SELL";
  size: Prisma.Decimal;
  price: Prisma.Decimal;
  startPosition: Prisma.Decimal;
  occurredAt: Date;
}): BehaviorFillRow {
  return {
    ...row,
    price: row.price.toString(),
    size: row.size.toString(),
    startPosition: row.startPosition.toString(),
  };
}
