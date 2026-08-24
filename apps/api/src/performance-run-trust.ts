import type { PerformanceRunTrustState, Prisma, PrismaClient } from "@chaincopy/database";

export const performanceRunTrustSelect = {
  trustRevision: true,
  trustState: true,
  trustTransitions: {
    orderBy: { revision: "desc" as const },
    select: {
      actor: true,
      createdAt: true,
      fromState: true,
      incidentRef: true,
      reasonCode: true,
      reasonDetail: true,
      revision: true,
      toState: true,
    },
    take: 1,
  },
} satisfies Prisma.MetricCalculationRunSelect;

export interface PerformanceRunTrustSnapshot {
  readonly trustRevision: number;
  readonly trustState: PerformanceRunTrustState;
  readonly trustTransitions: readonly {
    readonly revision: number;
    readonly toState: PerformanceRunTrustState;
  }[];
}

export class PerformanceRunTrustInconsistentError extends Error {
  public constructor(runId: string) {
    super(`Performance run ${runId} has an inconsistent trust state.`);
    this.name = "PerformanceRunTrustInconsistentError";
  }
}

export class PerformanceRunTrustConflictError extends Error {
  public constructor(runId: string) {
    super(`Performance run ${runId} trust state changed concurrently.`);
    this.name = "PerformanceRunTrustConflictError";
  }
}

export function trustedPerformanceRunWhere(input: {
  readonly calculationVersion: string;
  readonly walletAddressId?: string;
}): Prisma.MetricCalculationRunWhereInput {
  return {
    calculationVersion: input.calculationVersion,
    status: "SUCCEEDED",
    trustState: "TRUSTED",
    ...(input.walletAddressId ? { walletAddressId: input.walletAddressId } : {}),
  };
}

export function assertPerformanceRunTrustConsistency(
  runId: string,
  snapshot: PerformanceRunTrustSnapshot,
): void {
  const latest = snapshot.trustTransitions[0];
  const legacyTrusted = snapshot.trustRevision === 0 && snapshot.trustState === "TRUSTED";
  const currentTransition =
    latest?.revision === snapshot.trustRevision && latest.toState === snapshot.trustState;
  if (!legacyTrusted && !currentTransition) {
    throw new PerformanceRunTrustInconsistentError(runId);
  }
}

export interface PerformanceRunTrustChange {
  readonly actor: string;
  readonly incidentRef?: string;
  readonly operationKey: string;
  readonly reasonCode: string;
  readonly reasonDetail?: string;
}

export interface PerformanceRunTrustChangeResult {
  readonly changed: boolean;
  readonly runId: string;
  readonly trustRevision: number;
  readonly trustState: PerformanceRunTrustState;
}

export class PerformanceRunTrustService {
  public constructor(private readonly database: PrismaClient) {}

  public quarantine(
    runId: string,
    change: PerformanceRunTrustChange,
  ): Promise<PerformanceRunTrustChangeResult> {
    return this.changeState(runId, "QUARANTINED", change);
  }

  public restoreTrusted(
    runId: string,
    change: PerformanceRunTrustChange,
  ): Promise<PerformanceRunTrustChangeResult> {
    return this.changeState(runId, "TRUSTED", change);
  }

  private async changeState(
    runId: string,
    toState: PerformanceRunTrustState,
    change: PerformanceRunTrustChange,
  ): Promise<PerformanceRunTrustChangeResult> {
    validateChange(change);
    return this.database.$transaction(async (transaction) => {
      const priorOperation = await transaction.performanceRunTrustTransition.findUnique({
        select: { performanceRunId: true, revision: true, toState: true },
        where: { operationKey: change.operationKey },
      });
      if (priorOperation) {
        if (priorOperation.performanceRunId !== runId || priorOperation.toState !== toState) {
          throw new PerformanceRunTrustConflictError(runId);
        }
        return {
          changed: false,
          runId,
          trustRevision: priorOperation.revision,
          trustState: priorOperation.toState,
        };
      }

      const current = await transaction.metricCalculationRun.findUniqueOrThrow({
        select: { id: true, ...performanceRunTrustSelect },
        where: { id: runId },
      });
      assertPerformanceRunTrustConsistency(runId, current);
      if (current.trustState === toState) {
        return {
          changed: false,
          runId,
          trustRevision: current.trustRevision,
          trustState: current.trustState,
        };
      }

      const revision = current.trustRevision + 1;
      const updated = await transaction.metricCalculationRun.updateMany({
        data: { trustRevision: revision, trustState: toState },
        where: {
          id: runId,
          trustRevision: current.trustRevision,
          trustState: current.trustState,
        },
      });
      if (updated.count !== 1) throw new PerformanceRunTrustConflictError(runId);
      await transaction.performanceRunTrustTransition.create({
        data: {
          actor: change.actor,
          fromState: current.trustState,
          ...(change.incidentRef !== undefined ? { incidentRef: change.incidentRef } : {}),
          operationKey: change.operationKey,
          performanceRunId: runId,
          reasonCode: change.reasonCode,
          ...(change.reasonDetail !== undefined ? { reasonDetail: change.reasonDetail } : {}),
          revision,
          toState,
        },
      });
      return { changed: true, runId, trustRevision: revision, trustState: toState };
    });
  }
}

function validateChange(change: PerformanceRunTrustChange): void {
  if (!change.actor.trim() || !change.operationKey.trim() || !change.reasonCode.trim()) {
    throw new TypeError("actor, operationKey, and reasonCode are required.");
  }
}
