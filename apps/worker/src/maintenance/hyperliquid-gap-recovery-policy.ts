import { createHash } from "node:crypto";

import { hyperliquidJobNames } from "@chaincopy/domain";

export const gapRecoveryManifestVersion = "hyperliquid-gap-recovery-manifest-v1";

export interface GapRecoveryManifestInput {
  readonly boundaryRawEventId: string | null;
  readonly dataQualityIssueId: string;
  readonly endTime: Date | null;
  readonly fingerprint: string;
  readonly startTime: Date;
  readonly walletAddress: string;
  readonly walletAddressId: string;
}

export interface GapRecoveryManifestRow {
  readonly boundaryRawEventId: string;
  readonly dataQualityIssueId: string;
  readonly endTime: string;
  readonly fingerprint: string;
  readonly startTime: string;
  readonly walletAddress: string;
  readonly walletAddressId: string;
}

export interface GapRecoveryManifest {
  readonly count: number;
  readonly rows: ReadonlyArray<GapRecoveryManifestRow>;
  readonly sha256: string;
  readonly version: typeof gapRecoveryManifestVersion;
  readonly walletCount: number;
}

export function createGapRecoveryManifest(
  inputs: ReadonlyArray<GapRecoveryManifestInput>,
): GapRecoveryManifest {
  const issueIds = new Set<string>();
  const fingerprints = new Set<string>();
  const rows = inputs.map((input) => {
    if (!input.boundaryRawEventId || !input.endTime) {
      throw new Error(`Gap ${input.dataQualityIssueId} has no trusted WebSocket end boundary.`);
    }
    if (input.endTime <= input.startTime) {
      throw new Error(`Gap ${input.dataQualityIssueId} has an invalid time range.`);
    }
    if (issueIds.has(input.dataQualityIssueId) || fingerprints.has(input.fingerprint)) {
      throw new Error(`Gap ${input.dataQualityIssueId} has a duplicate identity.`);
    }
    issueIds.add(input.dataQualityIssueId);
    fingerprints.add(input.fingerprint);
    return {
      boundaryRawEventId: input.boundaryRawEventId,
      dataQualityIssueId: input.dataQualityIssueId,
      endTime: input.endTime.toISOString(),
      fingerprint: input.fingerprint,
      startTime: input.startTime.toISOString(),
      walletAddress: input.walletAddress,
      walletAddressId: input.walletAddressId,
    };
  });
  rows.sort((left, right) =>
    [left.walletAddressId, left.startTime, left.fingerprint]
      .join("\u0000")
      .localeCompare([right.walletAddressId, right.startTime, right.fingerprint].join("\u0000")),
  );
  const canonical = JSON.stringify({ rows, version: gapRecoveryManifestVersion });
  return {
    count: rows.length,
    rows,
    sha256: createHash("sha256").update(canonical).digest("hex"),
    version: gapRecoveryManifestVersion,
    walletCount: new Set(rows.map((row) => row.walletAddressId)).size,
  };
}

export function gapRecoveryJobId(row: GapRecoveryManifestRow): string {
  const requestedAt = new Date(row.endTime).getTime();
  const startTime = new Date(row.startTime).getTime();
  const endTime = requestedAt;
  return `${hyperliquidJobNames.gapRecovery}-${row.walletAddressId}-${requestedAt}-gap-${startTime}-${endTime}`;
}
