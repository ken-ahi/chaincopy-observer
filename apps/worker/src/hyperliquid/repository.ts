import {
  createEventFingerprint,
  mapFill,
  mapFundingPayment,
  mapHistoricalOrder,
  mapLedgerUpdate,
  mapOpenOrder,
  mapPositions,
  mapSpotBalances,
  mapWebSocketFunding,
  stringifyHyperliquidPayload,
  type HyperliquidClearinghouseState,
  type HyperliquidFill,
  type HyperliquidFundingPayment,
  type HyperliquidHistoricalOrder,
  type HyperliquidLedgerUpdate,
  type HyperliquidOrder,
  type HyperliquidPortfolio,
  type HyperliquidSpotState,
  type HyperliquidWebSocketFunding,
  type NormalizedFundingPayment,
} from "@chaincopy/blockchain-adapters";
import { type PrismaClient, type SyncCursorStatus } from "@chaincopy/database";

export interface CursorPosition {
  readonly lastExternalId: string | null;
  readonly lastTimestamp: Date | null;
}

export class HyperliquidRepository {
  private sourceIdPromise: Promise<string> | null = null;

  public constructor(
    private readonly database: PrismaClient,
    private readonly sourceKey: string,
    private readonly sourceName: string,
  ) {}

  public ensureSource(): Promise<string> {
    return this.sourceId();
  }

  public async getCursor(
    walletAddressId: string,
    scope: string,
    cursorType: string,
  ): Promise<CursorPosition> {
    const cursor = await this.database.syncCursor.findUnique({
      select: { lastExternalId: true, lastTimestamp: true },
      where: {
        sourceId_walletAddressId_scope_cursorType: {
          cursorType,
          scope,
          sourceId: await this.sourceId(),
          walletAddressId,
        },
      },
    });
    return {
      lastExternalId: cursor?.lastExternalId ?? null,
      lastTimestamp: cursor?.lastTimestamp ?? null,
    };
  }

  public async beginCursor(
    walletAddressId: string,
    scope: string,
    cursorType: string,
  ): Promise<void> {
    await this.updateCursor(walletAddressId, scope, cursorType, "RUNNING", {
      errorMessage: null,
      lastAttemptedAt: new Date(),
    });
  }

  public async completeCursor(
    walletAddressId: string,
    scope: string,
    cursorType: string,
    lastTimestamp: Date | null | undefined,
    lastExternalId: string | null | undefined,
  ): Promise<void> {
    const now = new Date();
    const current =
      lastTimestamp === undefined ? null : await this.getCursor(walletAddressId, scope, cursorType);
    const advancesCursor =
      lastTimestamp === undefined ||
      lastTimestamp === null ||
      current?.lastTimestamp === null ||
      current?.lastTimestamp === undefined ||
      lastTimestamp >= current.lastTimestamp;
    await this.updateCursor(walletAddressId, scope, cursorType, "SUCCEEDED", {
      errorMessage: null,
      lastAttemptedAt: now,
      ...(advancesCursor && lastExternalId !== undefined ? { lastExternalId } : {}),
      lastSuccessfulAt: now,
      ...(advancesCursor && lastTimestamp !== undefined ? { lastTimestamp } : {}),
    });
    await this.database.walletAddress.update({
      data: { lastSyncAt: now },
      where: { id: walletAddressId },
    });
  }

  public async failCursor(
    walletAddressId: string,
    scope: string,
    cursorType: string,
    errorMessage: string,
    status: SyncCursorStatus = "FAILED",
    lastExternalId?: string | null,
  ): Promise<void> {
    await this.updateCursor(walletAddressId, scope, cursorType, status, {
      errorMessage,
      lastAttemptedAt: new Date(),
      ...(lastExternalId !== undefined ? { lastExternalId } : {}),
    });
  }

  public async recordWebSocketGap(
    walletAddressId: string,
    disconnectedAt: string,
  ): Promise<boolean> {
    const disconnectedAtDate = new Date(disconnectedAt);
    if (!Number.isFinite(disconnectedAtDate.getTime())) {
      throw new RangeError("Hyperliquid WebSocket gap cursor requires a valid date-time.");
    }
    const result = await this.database.syncCursor.updateMany({
      data: {
        errorMessage: `Disconnected at ${disconnectedAt}`,
        lastAttemptedAt: new Date(),
        lastExternalId: disconnectedAt,
        status: "GAP_DETECTED",
      },
      where: {
        AND: [
          {
            OR: [{ lastTimestamp: null }, { lastTimestamp: { lte: disconnectedAtDate } }],
          },
          {
            OR: [
              { status: { not: "GAP_DETECTED" } },
              { lastExternalId: null },
              { lastExternalId: { lte: disconnectedAt } },
            ],
          },
        ],
        cursorType: "connection",
        scope: "websocket",
        sourceId: await this.sourceId(),
        walletAddressId,
      },
    });
    return result.count > 0;
  }

  public async completeWebSocketGap(
    walletAddressId: string,
    disconnectedAt: string,
    reconnectedAt: string,
  ): Promise<boolean> {
    const completedAt = new Date();
    const result = await this.database.syncCursor.updateMany({
      data: {
        errorMessage: null,
        lastAttemptedAt: completedAt,
        lastExternalId: `recovered:${disconnectedAt}:${reconnectedAt}`,
        lastSuccessfulAt: completedAt,
        lastTimestamp: new Date(reconnectedAt),
        status: "SUCCEEDED",
      },
      where: {
        cursorType: "connection",
        lastExternalId: disconnectedAt,
        scope: "websocket",
        sourceId: await this.sourceId(),
        status: "GAP_DETECTED",
        walletAddressId,
      },
    });
    if (result.count === 0) {
      return false;
    }
    await this.database.walletAddress.update({
      data: { lastSyncAt: completedAt },
      where: { id: walletAddressId },
    });
    return true;
  }

  public async saveRawEvent(input: {
    readonly eventType: string;
    readonly externalEventId?: string | null;
    readonly rawPayload: string;
    readonly transport: "HTTP" | "WEBSOCKET";
    readonly walletAddress: string;
    readonly walletAddressId: string;
    readonly eventTime?: Date | null;
  }): Promise<void> {
    const fingerprint = createEventFingerprint(
      `raw:${input.eventType}`,
      input.walletAddress,
      input.rawPayload,
    );
    await this.database.rawEvent.createMany({
      data: [
        {
          eventTime: input.eventTime ?? null,
          eventType: input.eventType,
          externalEventId: input.externalEventId ?? null,
          fingerprint,
          rawPayload: input.rawPayload,
          sourceId: await this.sourceId(),
          transport: input.transport,
          walletAddressId: input.walletAddressId,
        },
      ],
      skipDuplicates: true,
    });
  }

  public async saveRawPages(
    walletAddressId: string,
    walletAddress: string,
    eventType: string,
    pages: ReadonlyArray<string>,
  ): Promise<void> {
    await Promise.all(
      pages.map((rawPayload, index) =>
        this.saveRawEvent({
          eventType: `${eventType}:page`,
          externalEventId: `${eventType}:${createEventFingerprint(
            `page:${index}`,
            walletAddress,
            rawPayload,
          )}`,
          rawPayload,
          transport: "HTTP",
          walletAddress,
          walletAddressId,
        }),
      ),
    );
  }

  public async saveFills(
    walletAddressId: string,
    walletAddress: string,
    fills: ReadonlyArray<HyperliquidFill>,
  ): Promise<number> {
    const sourceId = await this.sourceId();
    const normalized = fills.map((fill) => mapFill(walletAddress, fill));
    const result = await this.database.normalizedTrade.createMany({
      data: normalized.map((fill) => ({
        closedPnl: fill.closedPnl,
        coin: fill.coin,
        crossed: fill.crossed,
        direction: fill.direction,
        externalTradeId: fill.externalTradeId,
        fee: fill.fee,
        feeToken: fill.feeToken,
        fingerprint: fill.fingerprint,
        occurredAt: fill.occurredAt,
        orderId: fill.orderId,
        price: fill.price,
        side: fill.side,
        size: fill.size,
        sourceId,
        startPosition: fill.startPosition,
        transactionHash: fill.transactionHash,
        walletAddressId,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  public async saveFunding(
    walletAddressId: string,
    walletAddress: string,
    payments: ReadonlyArray<HyperliquidFundingPayment>,
  ): Promise<number> {
    return this.saveNormalizedFunding(
      walletAddressId,
      payments.map((payment) => mapFundingPayment(walletAddress, payment)),
    );
  }

  public async saveWebSocketFunding(
    walletAddressId: string,
    walletAddress: string,
    payments: ReadonlyArray<HyperliquidWebSocketFunding>,
  ): Promise<number> {
    return this.saveNormalizedFunding(
      walletAddressId,
      payments.map((payment) => mapWebSocketFunding(walletAddress, payment)),
    );
  }

  public async saveLedger(
    walletAddressId: string,
    walletAddress: string,
    updates: ReadonlyArray<HyperliquidLedgerUpdate>,
  ): Promise<number> {
    const sourceId = await this.sourceId();
    const normalized = updates.map((update) => mapLedgerUpdate(walletAddress, update));
    const result = await this.database.cashFlow.createMany({
      data: normalized.map((flow) => ({
        amount: flow.amount,
        asset: flow.asset,
        counterparty: flow.counterparty,
        externalFlowId: flow.externalFlowId,
        fee: flow.fee,
        fingerprint: flow.fingerprint,
        flowType: flow.flowType,
        occurredAt: flow.occurredAt,
        rawPayload: flow.rawPayload,
        sourceId,
        usdValue: flow.usdValue,
        walletAddressId,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  public async savePositions(
    walletAddressId: string,
    walletAddress: string,
    state: HyperliquidClearinghouseState,
    capturedAt: Date,
  ): Promise<void> {
    const sourceId = await this.sourceId();
    const positions = mapPositions(walletAddress, state, capturedAt);
    const latestPosition = await this.database.perpPosition.findFirst({
      orderBy: { updatedExternalAt: "desc" },
      select: { updatedExternalAt: true },
      where: { walletAddressId },
    });
    if (latestPosition && latestPosition.updatedExternalAt.getTime() > capturedAt.getTime()) {
      await this.recordQualityIssue({
        details: {
          ignoredSnapshotAt: capturedAt.toISOString(),
          latestPositionAt: latestPosition.updatedExternalAt.toISOString(),
        },
        issueType: "HYPERLIQUID_OUT_OF_ORDER_POSITION_SNAPSHOT",
        message:
          "現在ポジションより古いスナップショットを検出したため、状態の巻き戻しを防止しました。",
        severity: "WARNING",
        walletAddress,
        walletAddressId,
      });
      return;
    }
    await this.database.$transaction(async (transaction) => {
      const activeCoins = positions.map((position) => position.coin);
      await transaction.perpPosition.deleteMany({
        where: {
          walletAddressId,
          ...(activeCoins.length > 0 ? { coin: { notIn: activeCoins } } : {}),
        },
      });
      for (const position of positions) {
        await transaction.perpPosition.upsert({
          create: {
            coin: position.coin,
            entryPrice: position.entryPrice,
            leverageType: position.leverageType,
            leverageValue: position.leverageValue,
            liquidationPrice: position.liquidationPrice,
            marginUsed: position.marginUsed,
            maxLeverage: position.maxLeverage,
            positionValue: position.positionValue,
            returnOnEquity: position.returnOnEquity,
            side: position.side,
            size: position.size,
            sourceId,
            unrealizedPnl: position.unrealizedPnl,
            updatedExternalAt: position.occurredAt,
            walletAddressId,
          },
          update: {
            entryPrice: position.entryPrice,
            leverageType: position.leverageType,
            leverageValue: position.leverageValue,
            liquidationPrice: position.liquidationPrice,
            marginUsed: position.marginUsed,
            maxLeverage: position.maxLeverage,
            positionValue: position.positionValue,
            returnOnEquity: position.returnOnEquity,
            side: position.side,
            size: position.size,
            unrealizedPnl: position.unrealizedPnl,
            updatedExternalAt: position.occurredAt,
          },
          where: {
            walletAddressId_coin: {
              coin: position.coin,
              walletAddressId,
            },
          },
        });
      }
      await transaction.perpPositionEvent.createMany({
        data: positions.map((position) => ({
          coin: position.coin,
          entryPrice: position.entryPrice,
          fingerprint: position.fingerprint,
          occurredAt: position.occurredAt,
          positionValue: position.positionValue,
          side: position.side,
          size: position.size,
          sourceId,
          unrealizedPnl: position.unrealizedPnl,
          walletAddressId,
        })),
        skipDuplicates: true,
      });
    });
  }

  public async saveClearinghouseSnapshot(
    walletAddressId: string,
    walletAddress: string,
    state: HyperliquidClearinghouseState,
    rawPayload: string,
    capturedAt: Date,
  ): Promise<void> {
    const fingerprint = createEventFingerprint("clearinghouse-snapshot", walletAddress, {
      capturedAt: capturedAt.toISOString(),
      state,
    });
    await this.database.portfolioSnapshot.createMany({
      data: [
        {
          accountValue: state.marginSummary.accountValue,
          capturedAt,
          fingerprint,
          rawPayload,
          snapshotType: "clearinghouseState",
          sourceId: await this.sourceId(),
          totalMarginUsed: state.marginSummary.totalMarginUsed,
          totalNotionalPosition: state.marginSummary.totalNtlPos,
          walletAddressId,
          withdrawable: state.withdrawable,
        },
      ],
      skipDuplicates: true,
    });
  }

  public async savePortfolioHistory(
    walletAddressId: string,
    walletAddress: string,
    portfolio: HyperliquidPortfolio,
    rawPayload: string,
    capturedAt: Date,
  ): Promise<void> {
    const fingerprint = createEventFingerprint("portfolio-history", walletAddress, portfolio);
    await this.database.portfolioSnapshot.createMany({
      data: [
        {
          capturedAt,
          fingerprint,
          rawPayload,
          snapshotType: "portfolio",
          sourceId: await this.sourceId(),
          walletAddressId,
        },
      ],
      skipDuplicates: true,
    });
  }

  public async saveSpotBalances(
    walletAddressId: string,
    walletAddress: string,
    state: HyperliquidSpotState,
    capturedAt: Date,
  ): Promise<void> {
    const sourceId = await this.sourceId();
    const balances = mapSpotBalances(walletAddress, state, capturedAt);
    await this.database.spotBalanceSnapshot.createMany({
      data: balances.map((balance) => ({
        capturedAt: balance.capturedAt,
        coin: balance.coin,
        entryNotional: balance.entryNotional,
        fingerprint: balance.fingerprint,
        hold: balance.hold,
        sourceId,
        tokenIndex: balance.tokenIndex,
        total: balance.total,
        walletAddressId,
      })),
      skipDuplicates: true,
    });
  }

  public async saveHistoricalOrders(
    walletAddressId: string,
    walletAddress: string,
    orders: ReadonlyArray<HyperliquidHistoricalOrder>,
  ): Promise<number> {
    return this.saveNormalizedOrders(
      walletAddressId,
      orders.map((order) => mapHistoricalOrder(walletAddress, order)),
    );
  }

  public async saveOpenOrders(
    walletAddressId: string,
    walletAddress: string,
    orders: ReadonlyArray<HyperliquidOrder>,
  ): Promise<number> {
    return this.saveNormalizedOrders(
      walletAddressId,
      orders.map((order) => mapOpenOrder(walletAddress, order)),
    );
  }

  public async recordQualityIssue(input: {
    readonly issueType: string;
    readonly message: string;
    readonly severity: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
    readonly walletAddress: string;
    readonly walletAddressId: string;
    readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  }): Promise<void> {
    const fingerprint = createEventFingerprint(
      `quality:${input.issueType}`,
      input.walletAddress,
      input.details ?? {},
    );
    await this.database.dataQualityIssue.upsert({
      create: {
        ...(input.details ? { details: input.details } : {}),
        fingerprint,
        issueType: input.issueType,
        message: input.message,
        severity: input.severity,
        sourceId: await this.sourceId(),
        walletAddressId: input.walletAddressId,
      },
      update: {
        ...(input.details ? { details: input.details } : {}),
        lastDetectedAt: new Date(),
        message: input.message,
        resolvedAt: null,
        severity: input.severity,
        status: "OPEN",
      },
      where: { fingerprint },
    });
  }

  public async resolveQualityIssue(input: {
    readonly details: Readonly<Record<string, string | number | boolean | null>>;
    readonly issueType: string;
    readonly walletAddress: string;
  }): Promise<void> {
    const fingerprint = createEventFingerprint(
      `quality:${input.issueType}`,
      input.walletAddress,
      input.details,
    );
    await this.database.dataQualityIssue.updateMany({
      data: {
        resolvedAt: new Date(),
        status: "RESOLVED",
      },
      where: {
        fingerprint,
        status: "OPEN",
      },
    });
  }

  public async markSourceSuccess(message: string): Promise<void> {
    await this.database.dataSource.update({
      data: {
        lastSuccessAt: new Date(),
        status: "HEALTHY",
        statusMessage: message,
      },
      where: { id: await this.sourceId() },
    });
  }

  public async markSourceFailure(message: string): Promise<void> {
    await this.database.dataSource.update({
      data: {
        lastFailureAt: new Date(),
        status: "DEGRADED",
        statusMessage: message,
      },
      where: { id: await this.sourceId() },
    });
  }

  public async auditWallet(
    walletAddressId: string,
    walletAddress: string,
  ): Promise<Readonly<Record<string, unknown>>> {
    const requiredScopes = ["fills", "funding", "ledger", "account-snapshot"];
    const cursors = await this.database.syncCursor.findMany({
      select: {
        lastSuccessfulAt: true,
        scope: true,
        status: true,
      },
      where: { walletAddressId },
    });
    const successfulScopes = new Set(
      cursors
        .filter((cursor) => cursor.status === "SUCCEEDED" && cursor.lastSuccessfulAt)
        .map((cursor) => cursor.scope),
    );
    const missingScopes = requiredScopes.filter((scope) => !successfulScopes.has(scope));
    if (missingScopes.length > 0) {
      await this.recordQualityIssue({
        details: { missingScopes: missingScopes.join(",") },
        issueType: "HYPERLIQUID_INCOMPLETE_INITIAL_SYNC",
        message: `同期未完了のデータ領域があります: ${missingScopes.join(", ")}`,
        severity: "WARNING",
        walletAddress,
        walletAddressId,
      });
    }
    const [fills, funding, ledger, positions, openIssues] = await Promise.all([
      this.database.normalizedTrade.count({ where: { walletAddressId } }),
      this.database.fundingPayment.count({ where: { walletAddressId } }),
      this.database.cashFlow.count({ where: { walletAddressId } }),
      this.database.perpPosition.count({ where: { walletAddressId } }),
      this.database.dataQualityIssue.count({
        where: { status: "OPEN", walletAddressId },
      }),
    ]);
    return {
      fills,
      funding,
      ledger,
      missingScopes,
      openIssues,
      positions,
    };
  }

  public stringifyRaw(value: unknown): string {
    return stringifyHyperliquidPayload(value);
  }

  private async saveNormalizedFunding(
    walletAddressId: string,
    payments: ReadonlyArray<NormalizedFundingPayment>,
  ): Promise<number> {
    const sourceId = await this.sourceId();
    const result = await this.database.fundingPayment.createMany({
      data: payments.map((payment) => ({
        amount: payment.amount,
        coin: payment.coin,
        externalPaymentId: payment.externalPaymentId,
        fingerprint: payment.fingerprint,
        fundingRate: payment.fundingRate,
        occurredAt: payment.occurredAt,
        positionSize: payment.positionSize,
        sourceId,
        walletAddressId,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  private async saveNormalizedOrders(
    walletAddressId: string,
    orders: ReadonlyArray<ReturnType<typeof mapOpenOrder>>,
  ): Promise<number> {
    const sourceId = await this.sourceId();
    const result = await this.database.orderHistory.createMany({
      data: orders.map((order) => ({
        clientOrderId: order.clientOrderId,
        coin: order.coin,
        fingerprint: order.fingerprint,
        limitPrice: order.limitPrice,
        orderId: order.orderId,
        orderType: order.orderType,
        originalSize: order.originalSize,
        reduceOnly: order.reduceOnly,
        side: order.side,
        size: order.size,
        sourceId,
        status: order.status,
        statusTimestamp: order.statusTimestamp,
        walletAddressId,
      })),
      skipDuplicates: true,
    });
    return result.count;
  }

  private async updateCursor(
    walletAddressId: string,
    scope: string,
    cursorType: string,
    status: SyncCursorStatus,
    data: {
      readonly errorMessage?: string | null;
      readonly lastAttemptedAt?: Date;
      readonly lastExternalId?: string | null;
      readonly lastSuccessfulAt?: Date;
      readonly lastTimestamp?: Date | null;
    },
  ): Promise<void> {
    const sourceId = await this.sourceId();
    const cursorData = {
      ...(data.errorMessage !== undefined ? { errorMessage: data.errorMessage } : {}),
      ...(data.lastAttemptedAt ? { lastAttemptedAt: data.lastAttemptedAt } : {}),
      ...(data.lastExternalId !== undefined ? { lastExternalId: data.lastExternalId } : {}),
      ...(data.lastSuccessfulAt ? { lastSuccessfulAt: data.lastSuccessfulAt } : {}),
      ...(data.lastTimestamp !== undefined ? { lastTimestamp: data.lastTimestamp } : {}),
    };
    await this.database.syncCursor.upsert({
      create: {
        cursorType,
        ...cursorData,
        scope,
        sourceId,
        status,
        walletAddressId,
      },
      update: {
        ...cursorData,
        status,
      },
      where: {
        sourceId_walletAddressId_scope_cursorType: {
          cursorType,
          scope,
          sourceId,
          walletAddressId,
        },
      },
    });
  }

  private sourceId(): Promise<string> {
    this.sourceIdPromise ??= this.database.dataSource
      .upsert({
        create: {
          enabled: true,
          key: this.sourceKey,
          kind: "HYPERLIQUID",
          name: this.sourceName,
        },
        update: { enabled: true },
        where: { key: this.sourceKey },
      })
      .then((source) => source.id);
    return this.sourceIdPromise;
  }
}
