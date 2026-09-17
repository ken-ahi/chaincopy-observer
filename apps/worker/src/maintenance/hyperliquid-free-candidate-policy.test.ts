import { describe, expect, it } from "vitest";

import {
  createFreeCandidateManifest,
  type FreeCandidateManifestRow,
} from "./hyperliquid-free-candidate-policy.js";

const row = (overrides: Partial<FreeCandidateManifestRow> = {}): FreeCandidateManifestRow => ({
  address: "0x1111111111111111111111111111111111111111",
  availableFrom: "2024-01-01T00:00:00.000Z",
  availableTo: "2026-09-01T00:00:00.000Z",
  candidateId: "candidate-1",
  dataQualityScore: 100,
  earliestPortfolioAt: "2024-01-01T00:00:00.000Z",
  initialFillOccurredAt: "2024-01-01T00:00:00.000Z",
  initialSourceTradeId: "1",
  initialStartPosition: "0",
  retrievedFillCount: 100,
  ...overrides,
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

  it("fails closed when the first fill does not prove a flat boundary", () => {
    expect(() => createFreeCandidateManifest([row({ initialStartPosition: "0.1" })])).toThrow(
      "does not have a trusted flat boundary",
    );
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
