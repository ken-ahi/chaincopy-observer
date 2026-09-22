import { createHash } from "node:crypto";

import { Prisma } from "@chaincopy/database";

const FinancialDecimal = Prisma.Decimal.clone({ precision: 80 });

export const freeCandidateManifestVersion = "hyperliquid-free-candidate-manifest-v7";

export interface FreeCandidateInitialPositionBoundary {
  readonly coin: string;
  readonly occurredAt: string;
  readonly sourceTradeId: string;
  readonly startPosition: string;
}

export interface FreeCandidateManifestRow {
  readonly address: string;
  readonly availableFrom: string;
  readonly availableTo: string;
  readonly candidateId: string;
  readonly dataQualityScore: number;
  readonly discoveryRetrievedFillCount: number;
  readonly earliestPortfolioAt: string;
  readonly earliestSourceAt: string;
  readonly initialPositionBoundaries: ReadonlyArray<FreeCandidateInitialPositionBoundary>;
  readonly verifiedFillCount: number;
  readonly verifiedNavDayCount: number;
}

export interface FreeCandidateManifest {
  readonly count: number;
  readonly rows: ReadonlyArray<FreeCandidateManifestRow>;
  readonly sha256: string;
  readonly version: typeof freeCandidateManifestVersion;
}

export function createFreeCandidateManifest(
  rowsInput: ReadonlyArray<FreeCandidateManifestRow>,
): FreeCandidateManifest {
  const candidateIds = new Set<string>();
  const addresses = new Set<string>();
  const rows = rowsInput.map((row) => {
    if (candidateIds.has(row.candidateId) || addresses.has(row.address)) {
      throw new Error(`Candidate ${row.candidateId} has a duplicate identity.`);
    }
    if (
      row.dataQualityScore !== 100 ||
      row.discoveryRetrievedFillCount <= 0 ||
      row.verifiedFillCount <= 0 ||
      row.verifiedNavDayCount <= 0
    ) {
      throw new Error(`Candidate ${row.candidateId} does not meet the free-data quality gate.`);
    }
    const coins = new Set<string>();
    if (
      row.initialPositionBoundaries.length === 0 ||
      row.initialPositionBoundaries.some((boundary) => {
        const invalid =
          !boundary.coin ||
          coins.has(boundary.coin) ||
          !boundary.sourceTradeId ||
          !Number.isFinite(new Date(boundary.occurredAt).getTime()) ||
          !new FinancialDecimal(boundary.startPosition).isZero();
        coins.add(boundary.coin);
        return invalid;
      })
    ) {
      throw new Error(`Candidate ${row.candidateId} does not have a trusted flat boundary.`);
    }
    const portfolioAt = new Date(row.earliestPortfolioAt);
    const earliestSourceAt = new Date(row.earliestSourceAt);
    if (
      !Number.isFinite(portfolioAt.getTime()) ||
      !Number.isFinite(earliestSourceAt.getTime()) ||
      portfolioAt.toISOString().slice(0, 10) > earliestSourceAt.toISOString().slice(0, 10)
    ) {
      throw new Error(`Candidate ${row.candidateId} does not have a trusted NAV boundary.`);
    }
    candidateIds.add(row.candidateId);
    addresses.add(row.address);
    return {
      ...row,
      initialPositionBoundaries: [...row.initialPositionBoundaries].sort((left, right) =>
        left.coin.localeCompare(right.coin),
      ),
    };
  });
  rows.sort((left, right) => left.candidateId.localeCompare(right.candidateId));
  const canonical = JSON.stringify({ rows, version: freeCandidateManifestVersion });
  return {
    count: rows.length,
    rows,
    sha256: createHash("sha256").update(canonical).digest("hex"),
    version: freeCandidateManifestVersion,
  };
}

export function hasContinuousUtcDateCoverage(
  timestamps: ReadonlyArray<number>,
  requiredFrom: number,
  requiredTo: number,
  minimumDays: number,
): boolean {
  if (
    !Number.isFinite(requiredFrom) ||
    !Number.isFinite(requiredTo) ||
    !Number.isSafeInteger(minimumDays) ||
    minimumDays < 1
  ) {
    return false;
  }
  const dates = [
    ...new Set(
      timestamps
        .filter(Number.isFinite)
        .map((timestamp) => new Date(timestamp).toISOString().slice(0, 10)),
    ),
  ].sort();
  const fromDate = new Date(requiredFrom).toISOString().slice(0, 10);
  const toDate = new Date(requiredTo).toISOString().slice(0, 10);
  const coveredDates = dates.filter((date) => date >= fromDate && date <= toDate);
  if (coveredDates[0] !== fromDate || coveredDates.at(-1) !== toDate) return false;
  if (coveredDates.length < minimumDays + 1) return false;
  return coveredDates.every((date, index) => {
    const previous = coveredDates[index - 1];
    return (
      !previous ||
      Date.parse(`${date}T00:00:00.000Z`) - Date.parse(`${previous}T00:00:00.000Z`) === 86_400_000
    );
  });
}
