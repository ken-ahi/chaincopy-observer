import { createHash } from "node:crypto";

export const freeCandidateManifestVersion = "hyperliquid-free-candidate-manifest-v1";

export interface FreeCandidateManifestRow {
  readonly address: string;
  readonly availableFrom: string;
  readonly availableTo: string;
  readonly candidateId: string;
  readonly dataQualityScore: number;
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
