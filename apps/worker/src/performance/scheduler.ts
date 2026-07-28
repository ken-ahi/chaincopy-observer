import { type PrismaClient } from "@chaincopy/database";
import { performanceCalculationVersion, type PerformanceJobData } from "@chaincopy/domain";
import { type Queue } from "bullmq";

import { enqueuePerformanceJob } from "./queue.js";

export interface PerformanceSchedulingResult {
  readonly calculationFrom: string;
  readonly calculationTo: string;
  readonly jobId: string;
}

export class PerformanceJobScheduler {
  public constructor(
    private readonly database: PrismaClient,
    private readonly queue: Queue<PerformanceJobData>,
  ) {}

  public async enqueue(
    walletAddressId: string,
    requestedAt: Date,
    requestedBy: string,
    force = false,
  ): Promise<PerformanceSchedulingResult> {
    const range = await resolvePerformanceCalculationRange(this.database, walletAddressId);
    const data: PerformanceJobData = {
      calculationFrom: range.calculationFrom.toISOString(),
      calculationTo: range.calculationTo.toISOString(),
      calculationVersion: performanceCalculationVersion,
      force,
      requestedAt: requestedAt.toISOString(),
      requestedBy,
      walletAddressId,
    };
    return {
      calculationFrom: data.calculationFrom,
      calculationTo: data.calculationTo,
      jobId: await enqueuePerformanceJob(this.queue, data),
    };
  }
}

export async function resolvePerformanceCalculationRange(
  database: PrismaClient,
  walletAddressId: string,
): Promise<{ readonly calculationFrom: Date; readonly calculationTo: Date }> {
  const [wallet, fills, funding, cashFlows, snapshots, positions, cursors] = await Promise.all([
    database.walletAddress.findUnique({
      select: { createdAt: true },
      where: { id: walletAddressId },
    }),
    database.normalizedTrade.aggregate({
      _max: { occurredAt: true },
      _min: { occurredAt: true },
      where: { walletAddressId },
    }),
    database.fundingPayment.aggregate({
      _max: { occurredAt: true },
      _min: { occurredAt: true },
      where: { walletAddressId },
    }),
    database.cashFlow.aggregate({
      _max: { occurredAt: true },
      _min: { occurredAt: true },
      where: { walletAddressId },
    }),
    database.portfolioSnapshot.aggregate({
      _max: { capturedAt: true },
      _min: { capturedAt: true },
      where: { walletAddressId },
    }),
    database.perpPositionEvent.aggregate({
      _max: { occurredAt: true },
      _min: { occurredAt: true },
      where: { walletAddressId },
    }),
    database.syncCursor.aggregate({
      _max: { lastSuccessfulAt: true, lastTimestamp: true },
      where: { walletAddressId },
    }),
  ]);
  if (!wallet) {
    throw new Error(`Wallet address ${walletAddressId} was not found.`);
  }

  const earliestInput = minimumDate([
    fills._min.occurredAt,
    funding._min.occurredAt,
    cashFlows._min.occurredAt,
    snapshots._min.capturedAt,
    positions._min.occurredAt,
  ]);
  const latestInput = maximumDate([
    fills._max.occurredAt,
    funding._max.occurredAt,
    cashFlows._max.occurredAt,
    snapshots._max.capturedAt,
    positions._max.occurredAt,
  ]);
  const calculationFrom = earliestInput ?? wallet.createdAt;
  const fallbackTo =
    maximumDate([cursors._max.lastTimestamp, cursors._max.lastSuccessfulAt]) ?? calculationFrom;
  const calculationTo = latestInput ?? fallbackTo;
  return {
    calculationFrom,
    calculationTo: calculationTo < calculationFrom ? calculationFrom : calculationTo,
  };
}

function minimumDate(values: ReadonlyArray<Date | null>): Date | null {
  return values.reduce<Date | null>(
    (current, value) => (!value || (current && current <= value) ? current : value),
    null,
  );
}

function maximumDate(values: ReadonlyArray<Date | null>): Date | null {
  return values.reduce<Date | null>(
    (current, value) => (!value || (current && current >= value) ? current : value),
    null,
  );
}
