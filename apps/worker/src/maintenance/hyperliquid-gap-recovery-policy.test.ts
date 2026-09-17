import { describe, expect, it } from "vitest";

import {
  createGapRecoveryManifest,
  gapRecoveryJobId,
  isDeterministicGapCoverageFailure,
  type GapRecoveryManifestInput,
} from "./hyperliquid-gap-recovery-policy.js";

const row = (overrides: Partial<GapRecoveryManifestInput> = {}): GapRecoveryManifestInput => ({
  boundaryRawEventId: "raw-1",
  dataQualityIssueId: "issue-1",
  endTime: new Date("2026-07-01T00:00:02.000Z"),
  fingerprint: "fingerprint-1",
  startTime: new Date("2026-07-01T00:00:01.000Z"),
  walletAddress: "0x1111111111111111111111111111111111111111",
  walletAddressId: "wallet-1",
  ...overrides,
});

describe("Hyperliquid gap recovery manifest policy", () => {
  it("produces a deterministic sorted manifest and queue identity", () => {
    const later = row({
      boundaryRawEventId: "raw-2",
      dataQualityIssueId: "issue-2",
      endTime: new Date("2026-07-01T00:00:04.000Z"),
      fingerprint: "fingerprint-2",
      startTime: new Date("2026-07-01T00:00:03.000Z"),
    });
    const first = createGapRecoveryManifest([later, row()]);
    const second = createGapRecoveryManifest([row(), later]);

    expect(first).toEqual(second);
    expect(first.count).toBe(2);
    expect(first.walletCount).toBe(1);
    expect(gapRecoveryJobId(first.rows[0]!)).toBe(
      "hyperliquid-gap-recovery-wallet-1-1782864002000-gap-1782864001000-1782864002000",
    );
  });

  it("fails closed without a trusted end boundary", () => {
    expect(() => createGapRecoveryManifest([row({ endTime: null })])).toThrow(
      "no trusted WebSocket end boundary",
    );
  });

  it("fails closed on duplicate source identities", () => {
    expect(() => createGapRecoveryManifest([row(), row()])).toThrow("duplicate identity");
  });

  it("distinguishes deterministic coverage failures from retryable infrastructure failures", () => {
    expect(
      isDeterministicGapCoverageFailure(
        "Hyperliquid gap recovery did not prove complete source coverage. The range remains OPEN and deterministic retries are suppressed.",
      ),
    ).toBe(true);
    expect(
      isDeterministicGapCoverageFailure(
        "A sync job already holds lock. Immediate BullMQ retries are suppressed; a later scheduler tick may enqueue fresh work.",
      ),
    ).toBe(false);
  });
});
