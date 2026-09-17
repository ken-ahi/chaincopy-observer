import { describe, expect, it } from "vitest";

import {
  createFreeCandidateManifest,
  hasContinuousUtcDateCoverage,
  type FreeCandidateManifestRow,
} from "./hyperliquid-free-candidate-policy.js";

const row = (overrides: Partial<FreeCandidateManifestRow> = {}): FreeCandidateManifestRow => ({
  address: "0x1111111111111111111111111111111111111111",
  availableFrom: "2024-01-01T00:00:00.000Z",
  availableTo: "2026-09-01T00:00:00.000Z",
  candidateId: "candidate-1",
  dataQualityScore: 100,
  discoveryRetrievedFillCount: 100,
  earliestPortfolioAt: "2024-01-01T00:00:00.000Z",
  earliestSourceAt: "2024-01-01T00:00:00.000Z",
  initialPositionBoundaries: [
    {
      coin: "BTC",
      occurredAt: "2024-01-01T00:00:00.000Z",
      sourceTradeId: "1",
      startPosition: "0",
    },
  ],
  verifiedFillCount: 100,
  verifiedNavDayCount: 100,
  ...overrides,
});

describe("continuous UTC NAV coverage", () => {
  const day = (value: string) => Date.parse(`${value}T12:00:00.000Z`);

  it("accepts an inclusive contiguous range", () => {
    expect(
      hasContinuousUtcDateCoverage(
        [day("2026-01-01"), day("2026-01-02"), day("2026-01-03")],
        day("2026-01-01"),
        day("2026-01-03"),
        2,
      ),
    ).toBe(true);
  });

  it("rejects a missing UTC day", () => {
    expect(
      hasContinuousUtcDateCoverage(
        [day("2026-01-01"), day("2026-01-03")],
        day("2026-01-01"),
        day("2026-01-03"),
        2,
      ),
    ).toBe(false);
  });
});

describe("free candidate promotion manifest policy", () => {
  it("is deterministic across input order", () => {
    const second = row({
      address: "0x2222222222222222222222222222222222222222",
      candidateId: "candidate-2",
    });
    expect(createFreeCandidateManifest([second, row()])).toEqual(
      createFreeCandidateManifest([row(), second]),
    );
  });

  it("fails closed on incomplete quality evidence", () => {
    expect(() => createFreeCandidateManifest([row({ dataQualityScore: 99 })])).toThrow(
      "does not meet the free-data quality gate",
    );
  });

  it("fails closed without a verified full-fill result", () => {
    expect(() => createFreeCandidateManifest([row({ verifiedFillCount: 0 })])).toThrow(
      "does not meet the free-data quality gate",
    );
  });

  it("fails closed when the first fill does not prove a flat boundary", () => {
    expect(() =>
      createFreeCandidateManifest([
        row({
          initialPositionBoundaries: [
            {
              coin: "BTC",
              occurredAt: "2024-01-01T00:00:00.000Z",
              sourceTradeId: "1",
              startPosition: "0.1",
            },
          ],
        }),
      ]),
    ).toThrow("does not have a trusted flat boundary");
  });

  it("fails closed when a coin boundary is duplicated", () => {
    const boundary = row().initialPositionBoundaries[0]!;
    expect(() =>
      createFreeCandidateManifest([
        row({ initialPositionBoundaries: [boundary, { ...boundary, sourceTradeId: "2" }] }),
      ]),
    ).toThrow("does not have a trusted flat boundary");
  });

  it("fails closed when portfolio history starts after the fill boundary", () => {
    expect(() =>
      createFreeCandidateManifest([row({ earliestPortfolioAt: "2024-01-02T00:00:00.000Z" })]),
    ).toThrow("does not have a trusted NAV boundary");
  });

  it("fails closed on duplicate addresses", () => {
    expect(() => createFreeCandidateManifest([row(), row({ candidateId: "candidate-2" })])).toThrow(
      "duplicate identity",
    );
  });
});
