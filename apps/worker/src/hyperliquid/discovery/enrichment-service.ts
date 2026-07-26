import { HyperliquidHttpError, type HyperliquidClient } from "@chaincopy/blockchain-adapters";
import { errorDetails } from "@chaincopy/config";
import { type Prisma } from "@chaincopy/database";
import { type Logger } from "pino";

import { countPositionRelatedFills, evaluateEnrichedCandidate } from "./filter.js";
import { type HyperliquidDiscoveryRepository } from "./repository.js";

export class CandidateEnrichmentService {
  public constructor(
    private readonly client: HyperliquidClient,
    private readonly repository: HyperliquidDiscoveryRepository,
    private readonly logger: Logger,
  ) {}

  public async enrich(
    candidateId: string,
    requestedFrom: Date,
    requestedTo: Date,
  ): Promise<Readonly<Record<string, unknown>>> {
    const start = await this.repository.beginEnrichment(candidateId, requestedFrom, requestedTo);
    if (!start) {
      return { cadenceSuppressed: true };
    }
    this.logger.info(
      {
        address: start.address,
        candidateId,
        requestedFrom: requestedFrom.toISOString(),
        requestedTo: requestedTo.toISOString(),
      },
      "Candidate enrichment started",
    );

    try {
      const recentFills = await this.client.userFills(start.address);
      const fillsByTime = await this.client.allUserFillsByTime(
        start.address,
        requestedFrom.getTime(),
        requestedTo.getTime(),
      );
      const [
        clearinghouseState,
        portfolio,
        funding,
        ledger,
        historicalOrders,
        openOrders,
        userRateLimit,
      ] = await Promise.all([
        this.client.clearinghouseState(start.address),
        this.client.portfolio(start.address),
        this.client.allUserFunding(start.address, requestedFrom.getTime(), requestedTo.getTime()),
        this.client.allUserLedgerUpdates(
          start.address,
          requestedFrom.getTime(),
          requestedTo.getTime(),
        ),
        this.client.historicalOrders(start.address),
        this.client.openOrders(start.address),
        this.client.userRateLimit(start.address),
      ]);
      const analysis = evaluateEnrichedCandidate(
        fillsByTime.items,
        fillsByTime.reachedHistoryLimit ||
          funding.reachedHistoryLimit ||
          ledger.reachedHistoryLimit,
        start.settings,
        requestedTo,
      );
      const positionRelations = countPositionRelatedFills(fillsByTime.items);
      const truncationReasons = [
        ...(fillsByTime.reachedHistoryLimit ? ["USER_FILLS_10000_LIMIT"] : []),
        ...(funding.reachedHistoryLimit ? ["USER_FUNDING_10000_LIMIT"] : []),
        ...(ledger.reachedHistoryLimit ? ["USER_LEDGER_10000_LIMIT"] : []),
      ];
      const historyTruncated = truncationReasons.length > 0;
      const truncationReason = historyTruncated ? truncationReasons.join(",") : null;
      const endpointResults = {
        analysis: serializeAnalysis(analysis),
        clearinghousePositionCount: clearinghouseState.data.assetPositions.length,
        endpointFailures: 0,
        fundingCount: funding.items.length,
        historicalOrderCount: historicalOrders.data.length,
        ledgerUpdateCount: ledger.items.length,
        openOrderCount: openOrders.data.length,
        portfolioPeriodCount: portfolio.data.length,
        recentFillCount: recentFills.data.length,
        userRateLimit: {
          cumulativeVolume: userRateLimit.data.cumVlm,
          requestCap: userRateLimit.data.nRequestsCap,
          requestsUsed: userRateLimit.data.nRequestsUsed,
        },
      } satisfies Prisma.InputJsonValue;

      await this.repository.completeEnrichment(start, {
        availableFrom: analysis.availableFrom,
        availableTo: analysis.availableTo,
        endpointResults,
        historyCompleteness: analysis.completeness,
        historyTruncated,
        longRelatedCount: positionRelations.longRelatedCount,
        retrievedFillCount: fillsByTime.items.length,
        shortRelatedCount: positionRelations.shortRelatedCount,
        truncationReason,
      });
      this.logger.info(
        {
          address: start.address,
          candidateId,
          historyCompleteness: analysis.completeness,
          historyTruncated,
          retrievedFillCount: fillsByTime.items.length,
        },
        "Candidate enrichment completed",
      );
      return {
        candidateId,
        historyCompleteness: analysis.completeness,
        historyTruncated,
        retrievedFillCount: fillsByTime.items.length,
      };
    } catch (error) {
      const details = errorDetails(error);
      const rateLimited = error instanceof HyperliquidHttpError && error.status === 429;
      await this.repository.failEnrichment(
        candidateId,
        start.attemptId,
        details.message,
        rateLimited,
      );
      this.logger.error(
        {
          address: start.address,
          candidateId,
          error: details,
          rateLimited,
        },
        "Candidate enrichment failed",
      );
      throw error;
    }
  }
}

function serializeAnalysis(
  analysis: ReturnType<typeof evaluateEnrichedCandidate>,
): Prisma.InputJsonValue {
  return {
    activeDays: analysis.activeDays,
    activeMonths: analysis.activeMonths,
    availableFrom: analysis.availableFrom?.toISOString() ?? null,
    availableTo: analysis.availableTo?.toISOString() ?? null,
    completeness: analysis.completeness,
    cumulativeNotionalUsd: analysis.cumulativeNotionalUsd,
    dataQualityScore: analysis.dataQualityScore,
    reasons: [...analysis.reasons],
    status: analysis.status,
  };
}
