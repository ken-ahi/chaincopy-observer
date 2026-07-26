import { randomUUID } from "node:crypto";

import { normalizeHyperliquidAddress } from "@chaincopy/blockchain-adapters";
import {
  type DataQualityIssueStatus,
  Prisma,
  type PrismaClient,
  type SyncCursorStatus,
} from "@chaincopy/database";
import {
  hyperliquidJobNames,
  hyperliquidQueueName,
  type HyperliquidJobData,
  type HyperliquidJobName,
} from "@chaincopy/domain";
import { type Queue } from "bullmq";

export class AddressNotFoundError extends Error {
  public constructor(address: string) {
    super(`Hyperliquid address ${address} is not registered.`);
    this.name = "AddressNotFoundError";
  }
}

export class AddressConflictError extends Error {
  public constructor(address: string) {
    super(`Hyperliquid address ${address} is already registered.`);
    this.name = "AddressConflictError";
  }
}

export interface CreateAddressInput {
  readonly address: string;
  readonly displayName?: string | null;
  readonly isWatched: boolean;
}

export interface UpdateAddressInput {
  readonly displayName?: string | null;
  readonly isWatched?: boolean;
}

export interface AddressSummary {
  readonly address: string;
  readonly displayName: string | null;
  readonly isWatched: boolean;
  readonly lastSyncAt: string | null;
  readonly syncStatus: SyncCursorStatus | null;
  readonly fillCount: number;
  readonly fundingCount: number;
  readonly ledgerCount: number;
  readonly currentPositionCount: number;
  readonly openDataQualityIssues: number;
  readonly lastSuccessfulAt: string | null;
  readonly lastError: string | null;
}

export interface AddressDetail {
  readonly address: AddressSummary;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly spotBalances: ReadonlyArray<{
    readonly coin: string;
    readonly total: string;
    readonly hold: string;
    readonly entryNotional: string;
    readonly capturedAt: string;
  }>;
  readonly portfolioSnapshots: ReadonlyArray<{
    readonly id: string;
    readonly snapshotType: string;
    readonly accountValue: string | null;
    readonly totalNotionalPosition: string | null;
    readonly totalMarginUsed: string | null;
    readonly withdrawable: string | null;
    readonly capturedAt: string;
  }>;
}

export interface CreateAddressResult {
  readonly address: AddressSummary;
  readonly syncJob: {
    readonly jobId: string;
    readonly status: "QUEUED";
  } | null;
}

export interface Page<T> {
  readonly items: ReadonlyArray<T>;
  readonly nextCursor: string | null;
}

export interface AddressListQuery {
  readonly cursor?: string;
  readonly limit: number;
  readonly search?: string;
  readonly syncStatus?: SyncCursorStatus;
  readonly isWatched?: boolean;
}

export interface HistoryListQuery {
  readonly cursor?: string;
  readonly limit: number;
}

export interface DataQualityListQuery extends HistoryListQuery {
  readonly status?: DataQualityIssueStatus;
}

export interface AddressSyncStatus {
  readonly address: string;
  readonly cursors: ReadonlyArray<{
    readonly cursorType: string;
    readonly scope: string;
    readonly status: SyncCursorStatus;
    readonly lastTimestamp: string | null;
    readonly lastExternalId: string | null;
    readonly lastSuccessfulAt: string | null;
    readonly lastAttemptedAt: string | null;
    readonly errorMessage: string | null;
  }>;
  readonly jobs: ReadonlyArray<{
    readonly id: string;
    readonly jobName: string;
    readonly status: string;
    readonly attempt: number;
    readonly createdAt: string;
    readonly startedAt: string | null;
    readonly finishedAt: string | null;
    readonly errorMessage: string | null;
  }>;
}

export interface AddressService {
  listAddresses(query: AddressListQuery): Promise<Page<AddressSummary>>;
  createAddress(input: CreateAddressInput): Promise<CreateAddressResult>;
  getAddress(address: string): Promise<AddressDetail>;
  updateAddress(address: string, input: UpdateAddressInput): Promise<AddressSummary>;
  setWatch(address: string, isWatched: boolean): Promise<AddressSummary>;
  enqueueSync(address: string): Promise<{ readonly jobId: string; readonly status: string }>;
  listFills(address: string, query: HistoryListQuery): Promise<Page<unknown>>;
  listFunding(address: string, query: HistoryListQuery): Promise<Page<unknown>>;
  listLedger(address: string, query: HistoryListQuery): Promise<Page<unknown>>;
  listPositions(address: string): Promise<ReadonlyArray<unknown>>;
  listOrders(address: string, query: HistoryListQuery): Promise<Page<unknown>>;
  listDataQuality(address: string, query: DataQualityListQuery): Promise<Page<unknown>>;
  getSyncStatus(address: string): Promise<AddressSyncStatus>;
  getHyperliquidHealth(): Promise<Readonly<Record<string, unknown>>>;
}

export class PrismaAddressService implements AddressService {
  public constructor(
    private readonly database: PrismaClient,
    private readonly queue: Queue<HyperliquidJobData>,
  ) {}

  public async listAddresses(query: AddressListQuery): Promise<Page<AddressSummary>> {
    const rows = await this.database.walletAddress.findMany({
      include: {
        _count: {
          select: {
            dataQualityIssues: {
              where: { status: "OPEN" },
            },
            cashFlows: true,
            fundingPayments: true,
            normalizedTrades: true,
            perpPositions: true,
          },
        },
        syncCursors: {
          orderBy: { lastAttemptedAt: "desc" },
          select: {
            errorMessage: true,
            lastAttemptedAt: true,
            lastSuccessfulAt: true,
            status: true,
          },
        },
      },
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      where: {
        source: { kind: "HYPERLIQUID" },
        ...(query.isWatched !== undefined ? { isWatched: query.isWatched } : {}),
        ...(query.search
          ? {
              OR: [
                { address: { contains: query.search, mode: "insensitive" as const } },
                {
                  displayName: {
                    contains: query.search,
                    mode: "insensitive" as const,
                  },
                },
              ],
            }
          : {}),
        ...(query.syncStatus ? { syncCursors: { some: { status: query.syncStatus } } } : {}),
      },
    });

    return toPage(rows, query.limit, (row) => toAddressSummary(row, row.syncCursors));
  }

  public async createAddress(input: CreateAddressInput): Promise<CreateAddressResult> {
    const address = normalizeHyperliquidAddress(input.address);
    const source = await this.ensureDataSource();
    try {
      const row = await this.database.walletAddress.create({
        data: {
          address,
          displayName: normalizeDisplayName(input.displayName),
          isWatched: input.isWatched,
          sourceId: source.id,
        },
        include: {
          _count: {
            select: {
              dataQualityIssues: true,
              cashFlows: true,
              fundingPayments: true,
              normalizedTrades: true,
              perpPositions: true,
            },
          },
        },
      });
      const jobId = input.isWatched
        ? await this.enqueueJob(row.id, address, hyperliquidJobNames.walletBackfill)
        : null;
      return {
        address: toAddressSummary(row, []),
        syncJob: jobId ? { jobId, status: "QUEUED" } : null,
      };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AddressConflictError(address);
      }
      throw error;
    }
  }

  public async getAddress(addressInput: string): Promise<AddressDetail> {
    const address = normalizeHyperliquidAddress(addressInput);
    const row = await this.database.walletAddress.findFirst({
      include: {
        _count: {
          select: {
            dataQualityIssues: {
              where: { status: "OPEN" },
            },
            cashFlows: true,
            fundingPayments: true,
            normalizedTrades: true,
            perpPositions: true,
          },
        },
        portfolioSnapshots: {
          orderBy: { capturedAt: "desc" },
          select: {
            accountValue: true,
            capturedAt: true,
            id: true,
            snapshotType: true,
            totalMarginUsed: true,
            totalNotionalPosition: true,
            withdrawable: true,
          },
          take: 50,
        },
        spotBalanceSnapshots: {
          distinct: ["coin"],
          orderBy: [{ coin: "asc" }, { capturedAt: "desc" }],
          select: {
            capturedAt: true,
            coin: true,
            entryNotional: true,
            hold: true,
            total: true,
          },
        },
        syncCursors: {
          orderBy: { lastAttemptedAt: "desc" },
          select: {
            errorMessage: true,
            lastAttemptedAt: true,
            lastSuccessfulAt: true,
            status: true,
          },
        },
      },
      where: {
        address,
        source: { kind: "HYPERLIQUID" },
      },
    });
    if (!row) {
      throw new AddressNotFoundError(address);
    }

    return {
      address: toAddressSummary(row, row.syncCursors),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      spotBalances: row.spotBalanceSnapshots.map((balance) => ({
        coin: balance.coin,
        total: balance.total.toString(),
        hold: balance.hold.toString(),
        entryNotional: balance.entryNotional.toString(),
        capturedAt: balance.capturedAt.toISOString(),
      })),
      portfolioSnapshots: row.portfolioSnapshots.map((snapshot) => ({
        id: snapshot.id,
        snapshotType: snapshot.snapshotType,
        accountValue: snapshot.accountValue?.toString() ?? null,
        totalNotionalPosition: snapshot.totalNotionalPosition?.toString() ?? null,
        totalMarginUsed: snapshot.totalMarginUsed?.toString() ?? null,
        withdrawable: snapshot.withdrawable?.toString() ?? null,
        capturedAt: snapshot.capturedAt.toISOString(),
      })),
    };
  }

  public async updateAddress(
    addressInput: string,
    input: UpdateAddressInput,
  ): Promise<AddressSummary> {
    const address = normalizeHyperliquidAddress(addressInput);
    const existing = await this.findAddress(address);
    const row = await this.database.walletAddress.update({
      data: {
        ...(input.displayName !== undefined
          ? { displayName: normalizeDisplayName(input.displayName) }
          : {}),
        ...(input.isWatched !== undefined ? { isWatched: input.isWatched } : {}),
      },
      include: {
        _count: {
          select: {
            dataQualityIssues: {
              where: { status: "OPEN" },
            },
            cashFlows: true,
            fundingPayments: true,
            normalizedTrades: true,
            perpPositions: true,
          },
        },
        syncCursors: {
          orderBy: { lastAttemptedAt: "desc" },
          select: {
            errorMessage: true,
            lastAttemptedAt: true,
            lastSuccessfulAt: true,
            status: true,
          },
        },
      },
      where: { id: existing.id },
    });
    if (input.isWatched === true && !existing.isWatched) {
      await this.enqueueJob(row.id, address, hyperliquidJobNames.walletBackfill);
    }
    return toAddressSummary(row, row.syncCursors);
  }

  public setWatch(address: string, isWatched: boolean): Promise<AddressSummary> {
    return this.updateAddress(address, { isWatched });
  }

  public async enqueueSync(
    addressInput: string,
  ): Promise<{ readonly jobId: string; readonly status: string }> {
    const address = normalizeHyperliquidAddress(addressInput);
    const row = await this.findAddress(address);
    const jobId = await this.enqueueJob(row.id, address, hyperliquidJobNames.walletBackfill);
    return { jobId, status: "QUEUED" };
  }

  public async listFills(addressInput: string, query: HistoryListQuery) {
    const row = await this.findAddress(normalizeHyperliquidAddress(addressInput));
    const fills = await this.database.normalizedTrade.findMany({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      where: { walletAddressId: row.id },
    });
    return toPage(fills, query.limit, (fill) => ({
      ...fill,
      price: fill.price.toString(),
      size: fill.size.toString(),
      fee: fill.fee.toString(),
      closedPnl: fill.closedPnl.toString(),
      startPosition: fill.startPosition.toString(),
      occurredAt: fill.occurredAt.toISOString(),
      createdAt: fill.createdAt.toISOString(),
    }));
  }

  public async listFunding(addressInput: string, query: HistoryListQuery) {
    const row = await this.findAddress(normalizeHyperliquidAddress(addressInput));
    const funding = await this.database.fundingPayment.findMany({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      where: { walletAddressId: row.id },
    });
    return toPage(funding, query.limit, (payment) => ({
      ...payment,
      amount: payment.amount.toString(),
      positionSize: payment.positionSize.toString(),
      fundingRate: payment.fundingRate.toString(),
      occurredAt: payment.occurredAt.toISOString(),
      createdAt: payment.createdAt.toISOString(),
    }));
  }

  public async listLedger(addressInput: string, query: HistoryListQuery) {
    const row = await this.findAddress(normalizeHyperliquidAddress(addressInput));
    const flows = await this.database.cashFlow.findMany({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      where: { walletAddressId: row.id },
    });
    return toPage(flows, query.limit, (flow) => ({
      ...flow,
      amount: flow.amount?.toString() ?? null,
      usdValue: flow.usdValue?.toString() ?? null,
      fee: flow.fee?.toString() ?? null,
      occurredAt: flow.occurredAt.toISOString(),
      createdAt: flow.createdAt.toISOString(),
    }));
  }

  public async listPositions(addressInput: string) {
    const row = await this.findAddress(normalizeHyperliquidAddress(addressInput));
    const positions = await this.database.perpPosition.findMany({
      orderBy: { coin: "asc" },
      where: { walletAddressId: row.id },
    });
    return positions.map((position) => ({
      ...position,
      size: position.size.toString(),
      entryPrice: position.entryPrice?.toString() ?? null,
      positionValue: position.positionValue.toString(),
      unrealizedPnl: position.unrealizedPnl.toString(),
      returnOnEquity: position.returnOnEquity.toString(),
      marginUsed: position.marginUsed.toString(),
      liquidationPrice: position.liquidationPrice?.toString() ?? null,
      leverageValue: position.leverageValue.toString(),
      maxLeverage: position.maxLeverage.toString(),
      updatedExternalAt: position.updatedExternalAt.toISOString(),
      createdAt: position.createdAt.toISOString(),
      updatedAt: position.updatedAt.toISOString(),
    }));
  }

  public async listOrders(addressInput: string, query: HistoryListQuery) {
    const row = await this.findAddress(normalizeHyperliquidAddress(addressInput));
    const orders = await this.database.orderHistory.findMany({
      orderBy: [{ statusTimestamp: "desc" }, { id: "desc" }],
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      take: query.limit + 1,
      where: { walletAddressId: row.id },
    });
    return toPage(orders, query.limit, (order) => ({
      ...order,
      limitPrice: order.limitPrice.toString(),
      size: order.size.toString(),
      originalSize: order.originalSize.toString(),
      statusTimestamp: order.statusTimestamp.toISOString(),
      createdAt: order.createdAt.toISOString(),
    }));
  }

  public async listDataQuality(
    addressInput: string,
    query: DataQualityListQuery,
  ): Promise<Page<unknown>> {
    const row = await this.findAddress(normalizeHyperliquidAddress(addressInput));
    const issues = await this.database.dataQualityIssue.findMany({
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ lastDetectedAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
      where: {
        walletAddressId: row.id,
        ...(query.status ? { status: query.status } : {}),
      },
    });
    return toPage(issues, query.limit, (issue) => ({
      id: issue.id,
      issueType: issue.issueType,
      severity: issue.severity,
      status: issue.status,
      message: issue.message,
      details: issue.details,
      firstDetectedAt: issue.firstDetectedAt.toISOString(),
      lastDetectedAt: issue.lastDetectedAt.toISOString(),
      resolvedAt: issue.resolvedAt?.toISOString() ?? null,
    }));
  }

  public async getSyncStatus(addressInput: string): Promise<AddressSyncStatus> {
    const address = normalizeHyperliquidAddress(addressInput);
    const row = await this.findAddress(address);
    const [cursors, jobs] = await Promise.all([
      this.database.syncCursor.findMany({
        orderBy: [{ scope: "asc" }, { cursorType: "asc" }],
        where: { walletAddressId: row.id },
      }),
      this.database.syncJob.findMany({
        orderBy: { createdAt: "desc" },
        take: 50,
        where: { walletAddressId: row.id },
      }),
    ]);

    return {
      address,
      cursors: cursors.map((cursor) => ({
        cursorType: cursor.cursorType,
        scope: cursor.scope,
        status: cursor.status,
        lastTimestamp: cursor.lastTimestamp?.toISOString() ?? null,
        lastExternalId: cursor.lastExternalId,
        lastSuccessfulAt: cursor.lastSuccessfulAt?.toISOString() ?? null,
        lastAttemptedAt: cursor.lastAttemptedAt?.toISOString() ?? null,
        errorMessage: cursor.errorMessage,
      })),
      jobs: jobs.map((job) => ({
        id: job.id,
        jobName: job.jobName,
        status: job.status,
        attempt: job.attempt,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
        errorMessage: job.errorMessage,
      })),
    };
  }

  public async getHyperliquidHealth(): Promise<Readonly<Record<string, unknown>>> {
    const source = await this.ensureDataSource();
    const [watchedAddresses, openIssues, runningJobs] = await Promise.all([
      this.database.walletAddress.count({
        where: { isWatched: true, sourceId: source.id },
      }),
      this.database.dataQualityIssue.count({
        where: { sourceId: source.id, status: "OPEN" },
      }),
      this.database.syncJob.count({
        where: { sourceId: source.id, status: "RUNNING" },
      }),
    ]);
    return {
      checkedAt: new Date().toISOString(),
      source: source.key,
      status: source.status,
      enabled: source.enabled,
      lastSuccessAt: source.lastSuccessAt?.toISOString() ?? null,
      lastFailureAt: source.lastFailureAt?.toISOString() ?? null,
      statusMessage: source.statusMessage,
      watchedAddresses,
      openIssues,
      runningJobs,
    };
  }

  private async ensureDataSource() {
    return this.database.dataSource.upsert({
      create: {
        enabled: true,
        key: "hyperliquid-mainnet",
        kind: "HYPERLIQUID",
        name: "Hyperliquid Mainnet",
      },
      update: {
        enabled: true,
      },
      where: { key: "hyperliquid-mainnet" },
    });
  }

  private async findAddress(address: string) {
    const row = await this.database.walletAddress.findFirst({
      where: {
        address,
        source: { kind: "HYPERLIQUID" },
      },
    });
    if (!row) {
      throw new AddressNotFoundError(address);
    }
    return row;
  }

  private async enqueueJob(
    walletAddressId: string,
    walletAddress: string,
    jobName: HyperliquidJobName,
  ): Promise<string> {
    const now = new Date();
    const queueJobId = `${jobName}-${walletAddressId}-${randomUUID()}`;
    const idempotencyKey = `${hyperliquidQueueName}:${queueJobId}`;
    await this.database.syncJob.upsert({
      create: {
        idempotencyKey,
        jobName,
        queueJobId,
        queueName: hyperliquidQueueName,
        status: "QUEUED",
        walletAddressId,
        sourceId: (await this.ensureDataSource()).id,
      },
      update: {},
      where: { idempotencyKey },
    });
    await this.queue.add(
      jobName,
      {
        requestedAt: now.toISOString(),
        walletAddress,
        walletAddressId,
      },
      {
        attempts: 5,
        backoff: { delay: 1_000, type: "exponential" },
        jobId: queueJobId,
        removeOnComplete: { age: 86_400, count: 2_000 },
        removeOnFail: { age: 604_800, count: 5_000 },
      },
    );
    return queueJobId;
  }
}

function normalizeDisplayName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

function toAddressSummary(
  row: {
    readonly address: string;
    readonly displayName: string | null;
    readonly isWatched: boolean;
    readonly lastSyncAt: Date | null;
    readonly _count: {
      readonly dataQualityIssues: number;
      readonly cashFlows: number;
      readonly fundingPayments: number;
      readonly normalizedTrades: number;
      readonly perpPositions: number;
    };
  },
  cursors: ReadonlyArray<{
    readonly errorMessage: string | null;
    readonly lastAttemptedAt: Date | null;
    readonly lastSuccessfulAt: Date | null;
    readonly status: SyncCursorStatus;
  }>,
): AddressSummary {
  const latestCursor = cursors[0];
  const lastSuccessfulAt = cursors.reduce<Date | null>((latest, cursor) => {
    if (!cursor.lastSuccessfulAt || (latest && latest >= cursor.lastSuccessfulAt)) {
      return latest;
    }
    return cursor.lastSuccessfulAt;
  }, null);
  const lastError = cursors.find((cursor) => cursor.errorMessage !== null)?.errorMessage ?? null;
  return {
    address: row.address,
    displayName: row.displayName,
    isWatched: row.isWatched,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    syncStatus: latestCursor?.status ?? null,
    fillCount: row._count.normalizedTrades,
    fundingCount: row._count.fundingPayments,
    ledgerCount: row._count.cashFlows,
    currentPositionCount: row._count.perpPositions,
    openDataQualityIssues: row._count.dataQualityIssues,
    lastSuccessfulAt: lastSuccessfulAt?.toISOString() ?? null,
    lastError,
  };
}

function toPage<Row extends { readonly id: string }, Item>(
  rows: ReadonlyArray<Row>,
  limit: number,
  map: (row: Row) => Item,
): Page<Item> {
  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;
  return {
    items: pageRows.map(map),
    nextCursor: hasNextPage ? (pageRows.at(-1)?.id ?? null) : null,
  };
}
