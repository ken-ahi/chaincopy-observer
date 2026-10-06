import { isDeepStrictEqual } from "node:util";
import {
  aggregateBehaviorBucket,
  aggregationHash,
  aggregationScope,
  AGGREGATION_BUCKET_MS,
  AGGREGATION_MAX_EVENTS,
  AGGREGATION_VERSION,
  BEHAVIOR_VERSION,
  utcBucketStart,
  SignalInputError,
  type AggregationEvent,
  type AggregationMember,
} from "@chaincopy/analytics";
import { Prisma, type PrismaClient } from "@chaincopy/database";

import {
  assertPerformanceRunTrustConsistency,
  performanceRunTrustSelect,
} from "./performance-run-trust.js";
import { PrismaWalletSelectionService } from "./wallet-selection-service.js";

type Transaction = Prisma.TransactionClient;
const Exact = Prisma.Decimal.clone({ precision: 80 });
const MAX_BUCKETS = 2_000;

export class PrismaBehaviorAggregationService {
  public constructor(private readonly database: PrismaClient) {}

  // Downstream consumers share their transaction snapshot with all upstream gates.
  public async verifiedInTransaction(tx: Transaction, coin: string, start: string) {
    if (utcBucketStart(start) !== start) throw new RangeError("Unaligned bucket.");
    const members = await this.members(tx);
    if (!members.length) return null;
    const result = await this.calculate(tx, coin, start, members);
    const bucket = await tx.behaviorAggregationBucket.findUnique({
      where: { id: result.bucketId },
      include: { currentRevision: true },
    });
    const revision = bucket?.currentRevision;
    if (
      !revision ||
      revision.bucketId !== result.bucketId ||
      revision.id !== aggregationHash([result.bucketId, result.inputFingerprint]) ||
      revision.inputFingerprint !== result.inputFingerprint ||
      revision.status !== result.status ||
      !isDeepStrictEqual(revision.inputSnapshot, result.snapshot) ||
      !isDeepStrictEqual(revision.totals, result.totals) ||
      revision.eventCount !== (result.totals?.eventCount ?? null) ||
      revision.uniqueWalletCount !== (result.totals?.uniqueWalletCount ?? null) ||
      (revision.notionalUsd?.toFixed() ?? null) !== (result.totals?.notionalUsd ?? null)
    )
      throw new SignalInputError("AGGREGATION_STALE_OR_MISSING");
    if (result.status === "BLOCKED") throw new SignalInputError("AGGREGATION_BLOCKED");
    return result;
  }

  private async members(tx: Transaction): Promise<readonly AggregationMember[]> {
    // Avoid the Selection service's infrastructure initialization on an unconfigured DB.
    const settings = await tx.walletSelectionSettings.findFirst({
      where: { source: { key: "hyperliquid-mainnet" } },
      select: { currentSelectionRunId: true },
    });
    if (!settings?.currentSelectionRunId) return [];
    return new PrismaWalletSelectionService(tx as PrismaClient).listEffectiveSelectedWallets();
  }

  private async calculate(
    tx: Transaction,
    coin: string,
    start: string,
    members: readonly AggregationMember[],
  ) {
    aggregationScope(members); // Enforce the cohort bound before any input read.
    const bucketStart = new Date(start);
    const bucketEnd = new Date(bucketStart.getTime() + AGGREGATION_BUCKET_MS);
    const walletAddressId = { in: members.map((m) => m.walletAddressId) };
    const range = { gte: bucketStart, lt: bucketEnd };
    const events = await tx.selectedWalletBehaviorEvent.findMany({
      where: { walletAddressId, coin, occurredAt: range, behaviorVersion: BEHAVIOR_VERSION },
      take: AGGREGATION_MAX_EVENTS + 1,
      orderBy: { id: "asc" },
      include: {
        normalizationRun: {
          include: {
            selectionScopes: {
              take: 201,
              orderBy: { id: "asc" },
              include: {
                performanceRun: {
                  select: {
                    id: true,
                    walletAddressId: true,
                    status: true,
                    calculationVersion: true,
                    ...performanceRunTrustSelect,
                  },
                },
                selectionRun: { select: { sourceId: true } },
              },
            },
          },
        },
      },
    });
    if (events.length > AGGREGATION_MAX_EVENTS)
      throw new RangeError("Aggregation event bound exceeded.");
    const fills = await tx.normalizedTrade.findMany({
      where: { walletAddressId, coin, occurredAt: range },
      take: AGGREGATION_MAX_EVENTS + 1,
      orderBy: { id: "asc" },
    });
    if (fills.length > AGGREGATION_MAX_EVENTS)
      throw new RangeError("Aggregation Fill bound exceeded.");
    const issues: string[] = [];
    if (bucketEnd.getTime() > Date.now()) issues.push("BUCKET_NOT_ENDED");
    const source = await tx.dataSource.findUniqueOrThrow({ where: { key: "hyperliquid-mainnet" } });
    for (const member of members) {
      const [behaviorIssue, sourceIssue, gap, cursor, sync] = await Promise.all([
        tx.behaviorDataQualityIssue.findFirst({
          where: {
            walletAddressId: member.walletAddressId,
            coin,
            behaviorVersion: BEHAVIOR_VERSION,
            status: "OPEN",
            OR: [{ sourceGroupAt: null }, { sourceGroupAt: { lt: bucketEnd } }],
          },
          orderBy: { id: "asc" },
        }),
        tx.dataQualityIssue.findFirst({
          where: { walletAddressId: member.walletAddressId, status: "OPEN" },
          orderBy: { id: "asc" },
        }),
        tx.syncCursor.findFirst({
          where: { walletAddressId: member.walletAddressId, status: "GAP_DETECTED" },
        }),
        tx.behaviorNormalizationCursor.findUnique({
          where: {
            walletAddressId_coin_behaviorVersion: {
              walletAddressId: member.walletAddressId,
              coin,
              behaviorVersion: BEHAVIOR_VERSION,
            },
          },
        }),
        tx.syncCursor.findFirst({
          where: {
            walletAddressId: member.walletAddressId,
            sourceId: source.id,
            scope: "fills",
            cursorType: "timestamp",
          },
        }),
      ]);
      if (behaviorIssue) issues.push(`BEHAVIOR_DQ:${behaviorIssue.reason}:${behaviorIssue.id}`);
      if (sourceIssue) issues.push(`SOURCE_DQ:${sourceIssue.issueType}:${sourceIssue.id}`);
      if (gap) issues.push(`SOURCE_GAP:${member.walletAddressId}`);
      if (
        !sync ||
        sync.status !== "SUCCEEDED" ||
        !sync.lastSuccessfulAt ||
        sync.lastSuccessfulAt < bucketEnd
      )
        issues.push(`SOURCE_NOT_OBSERVED:${member.walletAddressId}`);
      const times = [...events, ...fills]
        .filter((e) => e.walletAddressId === member.walletAddressId)
        .map((e) => e.occurredAt.getTime());
      if (!cursor?.lastCompletedTimestamp || cursor.boundaryAfterPosition === null)
        issues.push(`MISSING_BOUNDARY:${member.walletAddressId}`);
      else if (times.some((time) => time > cursor.lastCompletedTimestamp!.getTime()))
        issues.push(`NORMALIZATION_LAG:${member.walletAddressId}`);
    }
    const fillsById = new Map(fills.map((fill) => [fill.id, fill]));
    const legsByFill = new Map<string, typeof events>();
    for (const event of events) {
      const legs = legsByFill.get(event.sourceEventId) ?? [];
      legs.push(event);
      legsByFill.set(event.sourceEventId, legs);
    }
    for (const fill of fills) {
      const legs = (legsByFill.get(fill.id) ?? []).sort(
        (a, b) => a.sourceOrdinal - b.sourceOrdinal,
      );
      const before = new Exact(fill.startPosition.toString());
      const size = new Exact(fill.size.toString());
      const after = before.plus(fill.side === "BUY" ? size : size.negated());
      // Decimal preserves negative zero: -position * 0 is not a reversal.
      const flip =
        !before.isZero() && !after.isZero() && before.isNegative() !== after.isNegative();
      if (
        fill.sourceId !== source.id ||
        size.lte(0) ||
        legs.length !== (flip ? 2 : 1) ||
        legs.some((leg, ordinal) => leg.sourceOrdinal !== ordinal) ||
        !legs
          .reduce(
            (sum, leg) => sum.plus(new Exact(leg.quantityDelta.toString()).abs()),
            new Exact(0),
          )
          .eq(size) ||
        !legs[0]?.beforePosition.eq(fill.startPosition) ||
        !legs.at(-1)?.afterPosition.eq(after.toFixed())
      )
        issues.push(`SOURCE_LEGS_INCOMPLETE:${fill.id}`);
    }
    const inputs: AggregationEvent[] = events.map((event) => {
      const run = event.normalizationRun;
      if (run.selectionScopes.length > 200)
        throw new RangeError("Generation provenance bound exceeded.");
      const scope = run.selectionScopes.find(
        (s) =>
          s.walletAddressId === event.walletAddressId && s.performanceRunId && s.performanceRun,
      );
      const performance = scope?.performanceRun;
      if (performance) assertPerformanceRunTrustConsistency(performance.id, performance);
      if (
        !scope ||
        scope.selectionRun.sourceId !== source.id ||
        !performance ||
        performance.trustState !== "TRUSTED" ||
        performance.walletAddressId !== event.walletAddressId ||
        performance.status !== "SUCCEEDED" ||
        performance.calculationVersion !== "performance-v3" ||
        run.walletAddressId !== event.walletAddressId ||
        run.coin !== coin ||
        run.sourceId !== source.id ||
        run.behaviorVersion !== BEHAVIOR_VERSION
      )
        issues.push(`GENERATION_PROVENANCE:${event.id}`);
      const fill = fillsById.get(event.sourceEventId);
      if (
        !fill ||
        fill.walletAddressId !== event.walletAddressId ||
        fill.sourceId !== event.sourceId ||
        event.sourceId !== source.id ||
        fill.occurredAt.getTime() !== event.occurredAt.getTime() ||
        !fill.price.eq(event.sourcePrice) ||
        !fill.size.eq(event.sourceQuantity) ||
        event.sourceType !== "NORMALIZED_TRADE" ||
        !new Exact(event.quantityDelta.toString())
          .abs()
          .times(event.sourcePrice.toString())
          .eq(event.notionalDeltaUsd.toString())
      )
        issues.push(`SOURCE_IDENTITY:${event.id}`);
      return {
        id: event.id,
        fingerprint: event.fingerprint,
        behaviorVersion: event.behaviorVersion,
        walletAddressId: event.walletAddressId,
        coin: event.coin,
        occurredAt: event.occurredAt.toISOString(),
        eventType: event.eventType,
        direction: event.direction,
        notionalDeltaUsd: event.notionalDeltaUsd.toString(),
        sourceEventId: event.sourceEventId,
        sourceOrdinal: event.sourceOrdinal,
        normalizationRunId: event.normalizationRunId,
        generationSelectionRunId: scope?.selectionRunId ?? null,
        generationPerformanceRunId: scope?.performanceRunId ?? null,
      };
    });
    return aggregateBehaviorBucket({ coin, bucketStart: start, members, events: inputs, issues });
  }

  public async processBucket(coin: string, start: string, execute = false, expectedScope?: string) {
    if (utcBucketStart(start) !== start) throw new RangeError("Unaligned bucket.");
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.database.$transaction(
          async (tx) => {
            const members = await this.members(tx);
            if (!members.length) return { status: "NO_SELECTED_WALLETS" as const };
            if (expectedScope && aggregationScope(members).fingerprint !== expectedScope)
              throw new Error("Selected cohort changed; refusing scope expansion.");
            const result = await this.calculate(tx, coin, start, members);
            const revisionId = aggregationHash([result.bucketId, result.inputFingerprint]);
            if (execute) {
              await tx.behaviorAggregationBucket.upsert({
                where: { id: result.bucketId },
                update: {},
                create: {
                  id: result.bucketId,
                  aggregationVersion: AGGREGATION_VERSION,
                  behaviorVersion: BEHAVIOR_VERSION,
                  selectionRunId: result.selectionRunId,
                  scopeFingerprint: result.scopeFingerprint,
                  coin,
                  bucketStart: new Date(result.bucketStart),
                  bucketEnd: new Date(result.bucketEnd),
                },
              });
              await tx.behaviorAggregationRevision.createMany({
                skipDuplicates: true,
                data: [
                  {
                    id: revisionId,
                    bucketId: result.bucketId,
                    inputFingerprint: result.inputFingerprint,
                    status: result.status,
                    inputSnapshot: JSON.parse(
                      JSON.stringify(result.snapshot),
                    ) as Prisma.InputJsonValue,
                    totals: result.totals
                      ? (JSON.parse(JSON.stringify(result.totals)) as Prisma.InputJsonValue)
                      : Prisma.DbNull,
                    eventCount: result.totals?.eventCount ?? null,
                    uniqueWalletCount: result.totals?.uniqueWalletCount ?? null,
                    notionalUsd: result.totals?.notionalUsd ?? null,
                  },
                ],
              });
              await tx.behaviorAggregationBucket.updateMany({
                where: {
                  id: result.bucketId,
                  OR: [{ currentRevisionId: null }, { currentRevisionId: { not: revisionId } }],
                },
                data: { currentRevisionId: revisionId },
              });
            }
            return { ...result, revisionId };
          },
          { isolationLevel: "Serializable", timeout: 30_000, maxWait: 10_000 },
        );
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2034" ||
          attempt >= 2
        )
          throw error;
      }
    }
  }

  public async plan(coin: string, from: string, to: string) {
    validateRange(coin, from, to, 730);
    return this.database.$transaction(
      async (tx) => {
        const members = await this.members(tx);
        if (!members.length) return [];
        const scope = aggregationScope(members);
        const rows = await tx.$queryRaw<{ start: Date }[]>(Prisma.sql`
        SELECT DISTINCT date_bin('15 minutes', occurred_at, timestamp '1970-01-01') AS start
        FROM selected_wallet_behavior_events WHERE wallet_address_id IN (${Prisma.join(members.map((m) => m.walletAddressId))})
          AND coin = ${coin} AND behavior_version = ${BEHAVIOR_VERSION} AND occurred_at >= ${new Date(from)} AND occurred_at < ${new Date(to)}
        UNION SELECT bucket_start AS start FROM behavior_aggregation_buckets WHERE selection_run_id = ${scope.selectionRunId}
          AND scope_fingerprint = ${scope.fingerprint} AND coin = ${coin} AND aggregation_version = ${AGGREGATION_VERSION}
          AND bucket_start >= ${new Date(from)} AND bucket_start < ${new Date(to)}
        ORDER BY start LIMIT ${MAX_BUCKETS + 1}`);
        if (rows.length > MAX_BUCKETS)
          throw new RangeError("Too many buckets; narrow the explicit range.");
        return rows.map((row) => row.start.toISOString());
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000 },
    );
  }

  public async read(coin: string, from: string, to: string, limit = 100) {
    validateRange(coin, from, to, 31);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new RangeError("Invalid limit.");
    return this.database.$transaction(
      async (tx) => {
        const members = await this.members(tx);
        if (!members.length) return { status: "NO_SELECTED_WALLETS", items: [] };
        const scope = aggregationScope(members);
        const buckets = await tx.behaviorAggregationBucket.findMany({
          where: {
            coin,
            selectionRunId: scope.selectionRunId,
            scopeFingerprint: scope.fingerprint,
            aggregationVersion: AGGREGATION_VERSION,
            behaviorVersion: BEHAVIOR_VERSION,
            bucketStart: { gte: new Date(from), lt: new Date(to) },
          },
          include: { currentRevision: true },
          orderBy: { bucketStart: "asc" },
          take: limit,
        });
        const items = [];
        for (const bucket of buckets) {
          const current = await this.calculate(tx, coin, bucket.bucketStart.toISOString(), members);
          const revision = bucket.currentRevision;
          const fresh =
            revision?.bucketId === bucket.id &&
            revision.inputFingerprint === current.inputFingerprint;
          items.push({
            coin,
            bucketStart: bucket.bucketStart.toISOString(),
            bucketEnd: bucket.bucketEnd.toISOString(),
            aggregationVersion: AGGREGATION_VERSION,
            behaviorVersion: BEHAVIOR_VERSION,
            selectionRunId: scope.selectionRunId,
            scopeFingerprint: scope.fingerprint,
            inputFingerprint: revision?.inputFingerprint ?? null,
            status: fresh ? current.status : "STALE",
            issues: current.snapshot.issues,
            totals: fresh ? current.totals : null,
          });
        }
        return { status: items.length ? "OBSERVED" : "NOT_COMPUTED", items };
      },
      { isolationLevel: "RepeatableRead", timeout: 30_000 },
    );
  }
}

function validateRange(coin: string, from: string, to: string, days: number) {
  if (
    !coin ||
    coin.length > 100 ||
    utcBucketStart(from) !== from ||
    utcBucketStart(to) !== to ||
    Date.parse(to) <= Date.parse(from) ||
    Date.parse(to) - Date.parse(from) > days * 86_400_000
  )
    throw new RangeError("An aligned bounded UTC range and coin are required.");
}
