import { createHash } from "node:crypto";

import { Prisma } from "@chaincopy/database";

const FinancialDecimal = Prisma.Decimal.clone({ precision: 80 });

export const freeCandidateManifestVersion = "hyperliquid-free-candidate-manifest-v4";

export interface FreeCandidateManifestRow {
  readonly address: string;
  readonly availableFrom: string;
  readonly availableTo: string;
  readonly candidateId: string;
  readonly dataQualityScore: number;
  readonly earliestPortfolioAt: string;
  readonly earliestSourceAt: string;
  readonly initialFillOccurredAt: string;
  readonly initialSourceTradeId: string;
  readonly initialStartPosition: string;
  readonly retrievedFillCount: number;
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
    if (row.dataQualityScore !== 100 || row.retrievedFillCount <= 0) {
      throw new Error(`Candidate ${row.candidateId} does not meet the free-data quality gate.`);
    }
    if (
      !row.initialSourceTradeId ||
      !Number.isFinite(new Date(row.initialFillOccurredAt).getTime()) ||
      !new FinancialDecimal(row.initialStartPosition).isZero()
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
    return { ...row };
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
