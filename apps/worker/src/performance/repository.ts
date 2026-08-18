import { classifyStoredCashFlowInput } from "@chaincopy/analytics";
import {
  type MetricCalculationStatus,
  type PerformanceHistoryCompleteness,
  type PrismaClient,
} from "@chaincopy/database";

import type {
  CreateRunInput,
  PerformanceCalculationInput,
  PerformanceRunRecord,
  SuccessfulPerformanceResult,
} from "./types.js";

const inputPageSize = 5_000;
const maximumPositionSnapshotSize = 1_000;
const resultWriteBatchSize = 1_000;

async function loadMappedPages<Row extends { readonly id: string }, Output>(
  load: (cursor: string | undefined) => Promise<readonly Row[]>,
  map: (row: Row) => Output,
): Promise<Output[]> {
  const output: Output[] = [];
  let cursor: string | undefined;
  while (true) {
    const rows = await load(cursor);
    for (const row of rows) output.push(map(row));
    if (rows.length < inputPageSize) return output;
    cursor = rows.at(-1)?.id;
    if (!cursor) throw new Error("Performance input pagination did not return a cursor.");
  }
}

export interface PerformanceRepositoryPort {
  loadInput(
    walletAddressId: string,
    calculationFrom: Date,
    calculationTo: Date,
  ): Promise<PerformanceCalculationInput>;
  findReusableRun(
    walletAddressId: string,
    calculationVersion: string,
    inputFingerprint: string,
  ): Promise<PerformanceRunRecord | null>;
  createOrResumeRun(input: CreateRunInput): Promise<PerformanceRunRecord>;
  markRunning(runId: string): Promise<void>;
  markInsufficient(
    run: PerformanceRunRecord,
    errorCode: string,
    errorMessage: string,
    warningCodes: readonly string[],
  ): Promise<void>;
  markFailed(run: PerformanceRunRecord, errorCode: string, errorMessage: string): Promise<void>;
  saveSuccessful(
    run: PerformanceRunRecord,
    historyCompleteness: PerformanceHistoryCompleteness,
    result: SuccessfulPerformanceResult,
    calculationFrom: Date,
    calculationTo: Date,
  ): Promise<void>;
}

export class PerformanceRepository implements PerformanceRepositoryPort {
  public constructor(private readonly database: PrismaClient) {}

  public async loadInput(
    walletAddressId: string,
    calculationFrom: Date,
    calculationTo: Date,
  ): Promise<PerformanceCalculationInput> {
    const range = { gte: calculationFrom, lte: calculationTo };
    const wallet = await this.database.walletAddress.findUnique({
      select: { address: true, id: true },
      where: { id: walletAddressId },
    });

    if (!wallet) {
      throw new Error(`Wallet address ${walletAddressId} was not found.`);
    }

    const fills = await loadMappedPages(
      (cursor) =>
        this.database.normalizedTrade.findMany({
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          select: {
            closedPnl: true,
            coin: true,
            externalTradeId: true,
            fee: true,
            id: true,
            occurredAt: true,
            price: true,
            side: true,
            size: true,
            startPosition: true,
          },
          take: inputPageSize,
          where: { occurredAt: range, walletAddressId },
        }),
      (fill) => ({
        closedPnl: fill.closedPnl.toString(),
        coin: fill.coin,
        externalId: fill.externalTradeId,
        fee: fill.fee.toString(),
        occurredAt: fill.occurredAt.toISOString(),
        price: fill.price.toString(),
        side: fill.side,
        size: fill.size.toString(),
        startPosition: fill.startPosition.toString(),
      }),
    );
    const funding = await loadMappedPages(
      (cursor) =>
        this.database.fundingPayment.findMany({
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          select: {
            amount: true,
            coin: true,
            externalPaymentId: true,
            id: true,
            occurredAt: true,
          },
          take: inputPageSize,
          where: { occurredAt: range, walletAddressId },
        }),
      (payment) => ({
        amount: payment.amount.toString(),
        coin: payment.coin,
        externalId: payment.externalPaymentId,
        occurredAt: payment.occurredAt.toISOString(),
      }),
    );
    const cashFlows = await loadMappedPages(
      (cursor) =>
        this.database.cashFlow.findMany({
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ occurredAt: "asc" }, { id: "asc" }],
          select: {
            amount: true,
            asset: true,
            counterparty: true,
            externalFlowId: true,
            fee: true,
            flowType: true,
            id: true,
            occurredAt: true,
            rawPayload: true,
            usdValue: true,
          },
          take: inputPageSize,
          where: { occurredAt: range, walletAddressId },
        }),
      (cashFlow) => {
        const classification = classifyStoredCashFlowInput({
          amount: cashFlow.usdValue?.toString() ?? cashFlow.amount?.toString() ?? null,
          rawPayload: cashFlow.rawPayload,
          type: cashFlow.flowType,
          walletAddress: wallet.address,
        });
        return {
          amount: classification.amount,
          asset: cashFlow.asset,
          boundary: classification.boundary,
          counterparty: cashFlow.counterparty,
          externalId: cashFlow.externalFlowId,
          fee: cashFlow.fee?.toString() ?? null,
          occurredAt: cashFlow.occurredAt.toISOString(),
          rawPayload: cashFlow.rawPayload,
          type: cashFlow.flowType,
        };
      },
    );
    const snapshots = await loadMappedPages(
      (cursor) =>
        this.database.portfolioSnapshot.findMany({
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
          orderBy: [{ capturedAt: "asc" }, { id: "asc" }],
          select: {
            accountValue: true,
            capturedAt: true,
            fingerprint: true,
            id: true,
            totalNotionalPosition: true,
          },
          take: inputPageSize,
          where: {
            accountValue: { not: null },
            capturedAt: range,
            walletAddressId,
          },
        }),
      (snapshot) => snapshot,
    );
    const latestPositionInWindow = await this.database.perpPositionEvent.findFirst({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      select: { occurredAt: true },
      where: { occurredAt: range, walletAddressId },
    });
    const boundaryPosition = latestPositionInWindow
      ? null
      : await this.database.perpPositionEvent.findFirst({
          orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
          select: { occurredAt: true },
          where: { occurredAt: { lt: calculationFrom }, walletAddressId },
        });
    const positionTimestamp = latestPositionInWindow?.occurredAt ?? boundaryPosition?.occurredAt;
    const positions = positionTimestamp
      ? await this.database.perpPositionEvent.findMany({
          orderBy: [{ coin: "asc" }, { fingerprint: "asc" }],
          select: {
            coin: true,
            fingerprint: true,
            occurredAt: true,
            positionValue: true,
          },
          take: maximumPositionSnapshotSize + 1,
          where: { occurredAt: positionTimestamp, walletAddressId },
        })
      : [];
    if (positions.length > maximumPositionSnapshotSize) {
      throw new RangeError(
        `Position snapshot exceeds the supported ${maximumPositionSnapshotSize} rows.`,
      );
    }
    const [cursors, issues] = await Promise.all([
      this.database.syncCursor.findMany({
        select: { status: true },
        where: { walletAddressId },
      }),
      this.database.dataQualityIssue.findMany({
        select: { issueType: true },
        where: { status: "OPEN", walletAddressId },
      }),
    ]);

    return {
      accountSnapshots: snapshots
        .filter(
          (
            snapshot,
          ): snapshot is typeof snapshot & {
            accountValue: NonNullable<typeof snapshot.accountValue>;
            totalNotionalPosition: NonNullable<typeof snapshot.totalNotionalPosition>;
          } => snapshot.accountValue !== null && snapshot.totalNotionalPosition !== null,
        )
        .map((snapshot) => ({
          equity: snapshot.accountValue.toString(),
          externalId: snapshot.fingerprint,
          grossNotional: snapshot.totalNotionalPosition.toString(),
          occurredAt: snapshot.capturedAt.toISOString(),
        })),
      cashFlows,
      fills,
      funding,
      navSnapshots: snapshots
        .filter(
          (
            snapshot,
          ): snapshot is typeof snapshot & {
            accountValue: NonNullable<typeof snapshot.accountValue>;
          } => snapshot.accountValue !== null,
        )
        .map((snapshot) => ({
          externalId: snapshot.fingerprint,
          nav: snapshot.accountValue.toString(),
          occurredAt: snapshot.capturedAt.toISOString(),
          scope: "PERP" as const,
        })),
      openIssueTypes: issues.map((issue) => issue.issueType),
      positionSnapshots: positions.map((position) => ({
        coin: position.coin,
        externalId: position.fingerprint,
        notional: position.positionValue.toString(),
        occurredAt: position.occurredAt.toISOString(),
      })),
      syncCursorStatuses: cursors.map((cursor) => cursor.status),
      walletAddress: wallet.address,
      walletAddressId: wallet.id,
    };
  }

  public async findReusableRun(
    walletAddressId: string,
    calculationVersion: string,
    inputFingerprint: string,
  ): Promise<PerformanceRunRecord | null> {
    return this.database.metricCalculationRun.findFirst({
      orderBy: { completedAt: "desc" },
      select: runSelection,
      where: {
        calculationVersion,
        inputFingerprint,
        status: "SUCCEEDED",
        walletAddressId,
      },
    });
  }

  public createOrResumeRun(input: CreateRunInput): Promise<PerformanceRunRecord> {
    return this.database.metricCalculationRun.upsert({
      create: {
        calculationFrom: input.calculationFrom,
        calculationTo: input.calculationTo,
        calculationVersion: input.calculationVersion,
        deduplicationKey: input.deduplicationKey,
        historyCompleteness: input.historyCompleteness,
        inputFingerprint: input.inputFingerprint,
        requestedAt: input.requestedAt,
        requestedBy: input.requestedBy,
        status: "PENDING",
        walletAddressId: input.walletAddressId,
      },
      select: runSelection,
      update: {},
      where: { deduplicationKey: input.deduplicationKey },
    });
  }

  public async markRunning(runId: string): Promise<void> {
    const updated = await this.database.metricCalculationRun.updateMany({
      data: {
        completedAt: null,
        errorCode: null,
        errorMessage: null,
        startedAt: new Date(),
        status: "RUNNING",
      },
      where: {
        id: runId,
        status: { in: ["PENDING", "RUNNING"] },
      },
    });
    if (updated.count !== 1) {
      throw new Error(`Calculation run ${runId} cannot transition to RUNNING.`);
    }
  }

  public async markInsufficient(
    run: PerformanceRunRecord,
    errorCode: string,
    errorMessage: string,
    warningCodes: readonly string[],
  ): Promise<void> {
    await this.finishWithoutResults(
      run,
      "INSUFFICIENT_DATA",
      errorCode,
      errorMessage,
      warningCodes,
    );
  }

  public async markFailed(
    run: PerformanceRunRecord,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    await this.finishWithoutResults(run, "FAILED", errorCode, errorMessage, []);
  }

  public async saveSuccessful(
    run: PerformanceRunRecord,
    historyCompleteness: PerformanceHistoryCompleteness,
    result: SuccessfulPerformanceResult,
    calculationFrom: Date,
    calculationTo: Date,
  ): Promise<void> {
    const warningCodes = unique(result.warnings.map((item) => item.code));
    await this.database.$transaction(async (transaction) => {
      if (result.dailyNavs.length > 0) {
        await transaction.dailyNav.createMany({
          data: result.dailyNavs.map((item) => ({
            calculationRunId: run.id,
            cashBalance: null,
            date: item.date,
            externalCashFlow: item.externalCashFlow,
            fees: item.fees,
            funding: item.funding,
            historyCompleteness,
            nav: item.nav,
            precision: result.precision,
            realizedPnl: item.realizedPnl,
            unrealizedPnl: item.unrealizedPnl,
            walletAddressId: run.walletAddressId,
          })),
        });
      }
      if (result.cycles.length > 0) {
        for (let start = 0; start < result.cycles.length; start += resultWriteBatchSize) {
          const data = [];
          const end = Math.min(start + resultWriteBatchSize, result.cycles.length);
          for (let index = start; index < end; index += 1) {
            const cycle = result.cycles[index];
            if (cycle) {
              data.push({
                ...cycle,
                calculationRunId: run.id,
                walletAddressId: run.walletAddressId,
              });
            }
          }
          await transaction.positionCycle.createMany({ data });
        }
      }
      if (result.metrics.length > 0) {
        await transaction.addressPerformanceMetric.createMany({
          data: result.metrics.map((metric) => ({
            calculationFrom: metric.calculationFrom ?? calculationFrom,
            calculationRunId: run.id,
            calculationTo: metric.calculationTo ?? calculationTo,
            metricKey: metric.metricKey,
            metricValue: metric.metricValue,
            metricVersion: run.calculationVersion,
            precision: result.precision,
            status: metric.status,
            warningCodes: [...metric.warningCodes],
            walletAddressId: run.walletAddressId,
          })),
        });
      }
      const completed = await transaction.metricCalculationRun.updateMany({
        data: {
          completedAt: new Date(),
          errorCode: null,
          errorMessage: null,
          precision: result.precision,
          status: "SUCCEEDED",
          warningCodes,
          warningCount: warningCodes.length,
        },
        where: { id: run.id, status: "RUNNING" },
      });
      if (completed.count !== 1) {
        throw new Error(`Calculation run ${run.id} was not RUNNING at commit time.`);
      }
    });
  }

  private async finishWithoutResults(
    run: PerformanceRunRecord,
    status: Extract<MetricCalculationStatus, "INSUFFICIENT_DATA" | "FAILED">,
    errorCode: string,
    errorMessage: string,
    warningCodes: readonly string[],
  ): Promise<void> {
    await this.database.metricCalculationRun.update({
      data: {
        completedAt: new Date(),
        deduplicationKey: `${run.deduplicationKey}:${status.toLowerCase()}:${run.id}`,
        errorCode,
        errorMessage,
        status,
        warningCodes: [...unique(warningCodes)],
        warningCount: unique(warningCodes).length,
      },
      where: { id: run.id },
    });
  }
}

const runSelection = {
  calculationVersion: true,
  deduplicationKey: true,
  id: true,
  inputFingerprint: true,
  status: true,
  walletAddressId: true,
} as const;

function unique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
